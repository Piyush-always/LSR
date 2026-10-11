"""Minimal read-only Firestore REST client (standard library only).

It uses the website's public Web API key, the same key every visitor's browser
already receives. That key can only do what the security rules allow the public
to do, which for this monitor means reading orders, meta/counter and system/*.
Nothing secret lives in this app.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from datetime import datetime

PROJECT = "laser-keychain-official"
API_KEY = "AIzaSyCSeM1HYc52r103T-KVd9oq9nFn1cy7xSU"      # public web config key (ships in the website)
_ROOT = f"projects/{PROJECT}/databases/(default)/documents"
_BASE = f"https://firestore.googleapis.com/v1/{_ROOT}"
TIMEOUT_S = 15

_FRACTION = re.compile(r"\.(\d{6})\d+")                 # Python parses at most microseconds


class FirestoreError(Exception):
    """kind is "network" (no connection), "permission" (rules refused) or "server"."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind


def _timestamp(s: str) -> datetime:
    return datetime.fromisoformat(_FRACTION.sub(r".\1", s).replace("Z", "+00:00"))


def decode(value: dict):
    (kind, x), = value.items()
    if kind == "stringValue":
        return x
    if kind == "integerValue":
        return int(x)
    if kind == "doubleValue":
        return float(x)
    if kind == "booleanValue":
        return x
    if kind == "nullValue":
        return None
    if kind == "timestampValue":
        return _timestamp(x)
    if kind == "mapValue":
        return {k: decode(v) for k, v in x.get("fields", {}).items()}
    if kind == "arrayValue":
        return [decode(v) for v in x.get("values", [])]
    return x                                            # reference / geo / bytes: passed through raw


def _doc(d: dict) -> dict:
    return {"id": d["name"].rsplit("/", 1)[-1], **{k: decode(v) for k, v in d.get("fields", {}).items()}}


def _call(method: str, url: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:                 # must come before URLError (its parent)
        if e.code == 404:
            return None
        try:
            detail = json.loads(e.read()).get("error", {}).get("message", "")
        except (ValueError, OSError):
            detail = ""
        if e.code in (401, 403):
            raise FirestoreError("permission", detail or f"HTTP {e.code}") from e
        raise FirestoreError("server", f"HTTP {e.code} {detail}".strip()) from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise FirestoreError("network", str(getattr(e, "reason", e))) from e


def get(path: str) -> dict | None:
    d = _call("GET", f"{_BASE}/{path}?key={API_KEY}")
    return _doc(d) if d else None


def query(structured: dict) -> list[dict]:
    rows = _call("POST", f"{_BASE}:runQuery?key={API_KEY}", {"structuredQuery": structured}) or []
    return [_doc(r["document"]) for r in rows if "document" in r]


def batch_get(ids: list[str], collection: str = "orders") -> dict[str, dict | None]:
    """Returns {id: document, or None if it no longer exists}."""
    if not ids:
        return {}
    body = {"documents": [f"{_ROOT}/{collection}/{i}" for i in ids]}
    out: dict[str, dict | None] = {}
    for r in _call("POST", f"{_BASE}:batchGet?key={API_KEY}", body) or []:
        if "found" in r:
            d = _doc(r["found"])
            out[d["id"]] = d
        elif "missing" in r:
            out[r["missing"].rsplit("/", 1)[-1]] = None
    return out


# -- queries -------------------------------------------------------------------------
def q_all_orders() -> dict:
    return {"from": [{"collectionId": "orders"}]}


def q_active_orders() -> dict:
    values = [{"stringValue": s} for s in ("queued", "printing")]
    return {"from": [{"collectionId": "orders"}],
            "where": {"fieldFilter": {"field": {"fieldPath": "status"}, "op": "IN",
                                      "value": {"arrayValue": {"values": values}}}}}


def q_orders_created_after(t: datetime) -> dict:
    stamp = t.isoformat().replace("+00:00", "Z")
    return {"from": [{"collectionId": "orders"}],
            "where": {"fieldFilter": {"field": {"fieldPath": "created_at"}, "op": "GREATER_THAN",
                                      "value": {"timestampValue": stamp}}},
            "orderBy": [{"field": {"fieldPath": "created_at"}}]}
