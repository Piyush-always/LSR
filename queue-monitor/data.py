"""Domain logic: polling Firestore in the background, and turning raw order and
printer documents into what the UI shows. No widgets in here."""
from __future__ import annotations

import queue
import re
import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone

from PySide6.QtCore import QObject, Signal

import firestore as fs
import tokens as T

GRBL_HINTS = {"error:20": "unsupported G-code command"}


# -- snapshot + poller -----------------------------------------------------------------
@dataclass(frozen=True)
class Snapshot:
    orders: dict                    # id -> order document
    printer: dict | None            # system/printer, None if it has never reported
    counter: int | None             # meta/counter.last_position
    ports: list                     # serial ports on this PC
    ports_error: str | None
    fetched_at: datetime | None     # last *successful* Firestore read; None = never
    error: fs.FirestoreError | None  # set when this refresh failed (older data is kept)


class Poller(QObject):
    """Runs every Firestore read on a daemon thread and hands results to the UI
    thread through a queued signal. Requests that pile up while a refresh is in
    flight collapse into one."""

    ready = Signal(object)
    busy = Signal(bool)

    def __init__(self) -> None:
        super().__init__()
        self._requests: queue.Queue[bool] = queue.Queue()
        self._orders: dict = {}
        self._active: set[str] = set()
        self._newest: datetime | None = None
        self._last_full = 0.0
        self._printer: dict | None = None
        self._counter: int | None = None
        self._fetched_at: datetime | None = None
        threading.Thread(target=self._run, name="firestore-poller", daemon=True).start()

    def request(self, full: bool = False) -> None:
        self._requests.put(full)

    def _run(self) -> None:
        while True:
            full = self._requests.get()
            try:
                while True:
                    full = self._requests.get_nowait() or full
            except queue.Empty:
                pass
            self.busy.emit(True)
            snap = self._refresh(full)
            self.busy.emit(False)
            self.ready.emit(snap)

    def _refresh(self, full: bool) -> Snapshot:
        error = None
        try:
            printer = fs.get("system/printer")
            try:
                counter_doc = fs.get("meta/counter")
            except fs.FirestoreError as e:
                if e.kind != "permission":
                    raise
                counter_doc = None          # some projects keep the counter private; it is informational only
            stale = time.monotonic() - self._last_full > T.FULL_RELOAD_EVERY_S
            if full or stale or not self._orders:
                orders = {o["id"]: o for o in fs.query(fs.q_all_orders())}
                self._last_full = time.monotonic()
            else:
                # Cheap path: re-read only what can change (active orders and anything new),
                # then look up orders that left the active set to learn where they went.
                orders = dict(self._orders)
                active = fs.query(fs.q_active_orders())
                orders.update({o["id"]: o for o in active})
                if self._newest:
                    orders.update({o["id"]: o for o in fs.query(fs.q_orders_created_after(self._newest))})
                gone = self._active - {o["id"] for o in active}
                for oid, doc in fs.batch_get(sorted(gone)).items():
                    if doc is None:
                        orders.pop(oid, None)
                    else:
                        orders[oid] = doc
            # Commit only once every read succeeded, so a half-failed refresh never mixes states.
            self._orders = orders
            self._printer = printer
            self._counter = (counter_doc or {}).get("last_position")
            self._active = {i for i, o in orders.items() if o.get("status") in ("queued", "printing")}
            created = [o["created_at"] for o in orders.values() if isinstance(o.get("created_at"), datetime)]
            self._newest = max(created, default=None)
            self._fetched_at = datetime.now(timezone.utc)
        except fs.FirestoreError as e:
            error = e
        ports, ports_error = list_ports()
        return Snapshot(dict(self._orders), self._printer, self._counter, ports, ports_error,
                        self._fetched_at, error)


def list_ports() -> tuple[list[dict], str | None]:
    """Serial ports on this PC. Only lists them; never opens one, so it can't
    interfere with the printer agent."""
    try:
        from serial.tools import list_ports as lp
        ports = sorted(lp.comports(), key=lambda p: int(re.sub(r"\D", "", p.device) or 0))
        return [{"device": p.device, "description": p.description or "",
                 "manufacturer": p.manufacturer or ""} for p in ports], None
    except Exception as e:                              # pyserial raises assorted OS errors
        return [], str(e)


# -- printer state ----------------------------------------------------------------------
@dataclass(frozen=True)
class Context:
    now: datetime
    printer: str               # "online" | "stalled" | "offline" | "never" | "unknown"
    current_id: str | None     # order the agent says it is printing


def printer_state(doc: dict | None, now: datetime) -> tuple[str, float | None]:
    t = (doc or {}).get("updatedAt")
    if not isinstance(t, datetime):
        return "never", None
    age = (now - t).total_seconds()
    if age <= T.ONLINE_WITHIN_S:
        return "online", age
    if age <= T.OFFLINE_AFTER_S:
        return "stalled", age
    return "offline", age


def context(snap: Snapshot, now: datetime) -> Context:
    if snap.fetched_at is None:
        return Context(now, "unknown", None)
    state, _ = printer_state(snap.printer, now)
    current = (snap.printer or {}).get("current")
    return Context(now, state, current.get("orderId") if isinstance(current, dict) else None)


# -- orders ------------------------------------------------------------------------------
_STATUS = {
    "queued": ("Waiting", "neutral"),
    "done": ("Printed", "success"),
    "created": ("Unpaid", "muted"),
    "cancelled": ("Cancelled", "muted"),
    "failed": ("Failed", "danger"),
}
_STATUS_ORDER = {"printing": 0, "queued": 1, "done": 2, "created": 3, "cancelled": 4, "failed": 5}


def status(o: dict, ctx: Context) -> tuple[str, str]:
    """(label, tone). A 'printing' order is only really printing if the agent is
    online and says it is working on that exact order; otherwise it is stuck."""
    s = o.get("status") or ""
    if s == "printing":
        live = ctx.printer == "online" and ctx.current_id == o["id"]
        return ("Printing", "accent") if live else ("Stuck", "warning")
    return _STATUS.get(s, (s.title() or "Unknown", "muted"))


def engraving(o: dict) -> str:
    if o.get("mode") == "image":
        return "Image upload"
    return o.get("name") or "—"


def _digits(o: dict) -> str:
    return re.sub(r"\D", "", str(o.get("phone_e164") or o.get("phone_number") or ""))


def phone(o: dict) -> str:
    """Who ordered: the phone number is the only reliable customer identity on an order."""
    d = _digits(o)
    if len(d) == 10:
        d = "91" + d
    if len(d) == 12 and d.startswith("91"):
        return f"+91 {d[2:7]} {d[7:]}"
    return d or "—"


def phone_e164(o: dict) -> str:
    return phone(o).replace(" ", "")


def placed_at(o: dict) -> datetime | None:
    t = o.get("paid_at") or o.get("created_at")
    return t if isinstance(t, datetime) else None


def haystack(o: dict) -> str:
    keys = ("name", "displayName", "phone_number", "phone_e164", "id", "razorpay_order_id",
            "razorpay_payment_id", "queue_position", "fontId")
    return " ".join([str(o.get(k) or "") for k in keys] + [phone(o)]).lower()


def sort_key(o: dict, column: int, ctx: Context):
    if column == 0:
        qp = o.get("queue_position")
        return qp if isinstance(qp, int) else 10 ** 9
    if column == 1:
        return _STATUS_ORDER.get(o.get("status"), 9)
    if column == 2:
        return engraving(o).lower()
    if column == 3:
        return phone(o)
    t = placed_at(o)
    return t.timestamp() if t else 0.0


def lifecycle(o: dict, ctx: Context) -> tuple[int, int | None, str]:
    """For the Created -> Paid -> Printing -> Printed stepper:
    (steps completed, index of the active step or None, tone)."""
    s = o.get("status")
    if s == "done":
        return 4, None, "accent"
    if s == "printing":
        return 2, 2, "accent" if status(o, ctx)[0] == "Printing" else "warning"
    if s == "queued":
        return 2, None, "accent"
    if s in ("cancelled", "failed"):
        reached = 2 if o.get("paid_at") else 1
        return reached, reached, "danger"
    return 1, None, "accent"


def stats(orders: dict, ctx: Context, counter: int | None) -> dict[str, tuple[int, str, str]]:
    """Per filter card: (count, sub-line, sub-line tone)."""
    by = defaultdict(list)
    for o in orders.values():
        by[o.get("status")].append(o)
    waiting, printing, done, unpaid = by["queued"], by["printing"], by["done"], by["created"]

    nxt = min((o["queue_position"] for o in waiting if isinstance(o.get("queue_position"), int)), default=None)
    stuck = sum(1 for o in printing if status(o, ctx)[0] == "Stuck")
    if stuck:
        printing_sub = "Stuck — printer offline" if ctx.printer != "online" else f"{stuck} stuck, not printing"
    else:
        printing_sub = "Printing now" if printing else "Nothing printing"
    last = max((o["printed_at"] for o in done if isinstance(o.get("printed_at"), datetime)), default=None)
    return {
        "waiting": (len(waiting), f"Next up: #{nxt}" if nxt is not None else "Queue is clear", "secondary"),
        "printing": (len(printing), printing_sub, "warning" if stuck else "secondary"),
        "printed": (len(done), f"Last: {short_date(last)}" if last else "None yet", "secondary"),
        "unpaid": (len(unpaid), "Checkout not completed", "secondary"),
        "all": (len(orders), f"Queue counter at #{counter}" if counter is not None
                else (f"{len(by['cancelled'])} cancelled" if by["cancelled"] else "—"), "secondary"),
    }


def order_rows(o: dict) -> list[tuple[str, str, str, bool]]:
    """(label, value, tone, monospace) rows for the inspector."""
    rows = [("Phone", phone(o), "primary", False)]
    checkout_label = o.get("displayName")          # set by the website at checkout, not a person's name
    if checkout_label and checkout_label != o.get("name"):
        rows.append(("Checkout label", checkout_label, "secondary", False))
    image = o.get("mode") == "image"
    rows.append(("Type", "Image upload" if image else "Text", "primary", False))
    if not image:
        rows.append(("Font", o.get("fontId") or "—", "primary", False))
    if o.get("shape"):
        rows.append(("Shape", str(o["shape"]).capitalize(), "primary", False))
    if isinstance(o.get("amount"), (int, float)):
        rows.append(("Amount", f"₹{o['amount']:g}", "primary", False))
    rows.append(("Created", abs_time(o.get("created_at")), "primary", False))
    paid = o.get("paid_at")
    if paid:
        rows.append(("Paid", abs_time(paid), "primary", False))
    elif o.get("razorpay_payment_id") or o.get("status") in ("queued", "printing", "done"):
        rows.append(("Paid", "Yes (time not recorded)", "secondary", False))   # older orders
    else:
        rows.append(("Paid", "Not paid", "tertiary", False))
    if o.get("printed_at"):
        rows.append(("Printed", abs_time(o["printed_at"]), "primary", False))
    if "sms_sent" in o:
        sms = f"Sent {abs_time(o.get('sms_sent_at'))}" if o.get("sms_sent") else "Not sent"
        rows.append(("SMS", sms, "primary", False))
    if o.get("machineId"):
        rows.append(("Machine", o["machineId"], "primary", False))
    if o.get("printImagePath"):
        rows.append(("Image file", o["printImagePath"], "secondary", True))
    for key, label in (("razorpay_payment_id", "Payment ID"), ("razorpay_order_id", "Razorpay order"),
                       ("razorpay_payment_link_id", "Payment link")):
        if o.get(key):
            rows.append((label, o[key], "secondary", True))
    rows.append(("Document", o["id"], "secondary", True))
    return rows


# -- printer panel -----------------------------------------------------------------------
def ms_time(ms) -> datetime | None:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc) if isinstance(ms, (int, float)) and ms > 0 else None


def printer_rows(pr: dict, now: datetime) -> list[tuple[str, str, str, bool]]:
    connected = bool(pr.get("connected"))
    rows = [("Laser", "Connected" if connected else "Not connected", "success" if connected else "danger", False)]
    if pr.get("port"):
        rows.append(("Port", pr["port"], "primary", True))
    if pr.get("deviceLabel"):
        rows.append(("Device", pr["deviceLabel"], "primary", False))
    cur = pr.get("current")
    if isinstance(cur, dict):
        pos = f"#{cur['position']} " if cur.get("position") is not None else ""
        pct = f" · {cur['progress']}%" if cur.get("progress") is not None else ""
        rows.append(("Current job", f"{pos}{cur.get('name') or cur.get('mode') or 'order'}{pct}", "primary", False))
    else:
        rows.append(("Current job", "None", "primary", False))
    if pr.get("lastError"):
        err = str(pr["lastError"])
        hint = next((h for k, h in GRBL_HINTS.items() if k in err), None)
        rows.append(("Last error", f"{err} ({hint})" if hint else err, "warning", False))
    ard = pr.get("arduino")
    if isinstance(ard, dict):
        x, y = ard.get("xLimit"), ard.get("yLimit")
        seen = ms_time(ard.get("lastHeartbeat"))
        if x or y:
            fmt = lambda v: "triggered" if v == "TRIGGERED" else (v or "?")
            stale = seen is None or (now - seen).total_seconds() > T.OFFLINE_AFTER_S
            # An old reading shouldn't alarm: say how old it is and drop the warning colour.
            tone = "secondary" if stale else ("warning" if "TRIGGERED" in (x, y) else "primary")
            when = f" (as of {rel_time(seen, now)})" if stale and seen else ""
            rows.append(("Limit switches", f"X {fmt(x)} · Y {fmt(y)}{when}", tone, False))
        text = f"{ard.get('port') or '?'} · {'connected' if ard.get('connected') else 'disconnected'}"
        rows.append(("Arduino", text + (f" · reported {rel_time(seen, now)}" if seen else ""), "primary", False))
    es = pr.get("emergencyStop")
    if isinstance(es, dict):
        active = bool(es.get("active"))
        rows.append(("Emergency stop", "ACTIVE" if active else "Off", "danger" if active else "primary", False))
    if pr.get("machineId"):
        rows.append(("Machine", pr["machineId"], "primary", False))
    return rows


# -- time ---------------------------------------------------------------------------------
def rel_time(t: datetime | None, now: datetime) -> str:
    if not isinstance(t, datetime):
        return "—"
    s = max(0.0, (now - t).total_seconds())
    if s < 45:
        return "just now"
    if s < 3600:
        return f"{max(1, round(s / 60))} min ago"
    if s < 86400:
        return f"{int(s // 3600)} h ago"
    days = int(s // 86400)
    return f"{days} d ago" if days < 60 else short_date(t)


def short_date(t: datetime | None) -> str:
    if not isinstance(t, datetime):
        return "—"
    t = t.astimezone()
    return f"{t.day} {t.strftime('%b')}"


def abs_time(t: datetime | None) -> str:
    if not isinstance(t, datetime):
        return "—"
    t = t.astimezone()
    return f"{t.day} {t.strftime('%b %Y, %H:%M')}"


def short_time(t: datetime | None) -> str:
    if not isinstance(t, datetime):
        return "—"
    t = t.astimezone()
    return f"{t.day} {t.strftime('%b %H:%M')}"


def clock(t: datetime | None) -> str:
    return t.astimezone().strftime("%H:%M:%S") if isinstance(t, datetime) else "—"
