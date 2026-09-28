# Invengic Studio — Recraft Plan

The UI is not the first problem. From the code, a paid order probably does not carry the customer's design to the laser, there are security and payment problems to fix (section 0), and the laser starts the next job on a 5-second timer. Fix those this week (section 0). Then rebuild around one idea: **the customer gets exactly what they saw, and always knows when it will be ready.**

Evidence labels: **Verified** means seen in a screenshot, measured, or confirmed in code during this pass. **Derived** means it follows from code or calculation but was not seen on a live order or the machine. **Assumed** means it needs confirming.

---

## 0. Fix first (security & money)

Kept out of this repository on purpose: the repo is public and Firebase Hosting serves `docs/`. The owner has the full list locally (`docs/SECURITY-PRIVATE.md`, git-excluded). Do those items before the next event; none of them needs the redesign.

---

## 1. What is wrong today

| # | Problem | Evidence |
|---|---|---|
| 1 | Paid orders probably lose the design: every checkout becomes "KEYCHAIN" on a rectangle for ₹1, and a cart of 5 makes 1 piece | js/app.js:1597-1605, 1636-1648; functions/index.js:49, 552-561 (Derived) |
| 2 | Security and payment-verification problems (details kept out of this public repo, see section 0) | private |
| 3 | The preview is not the product: flat cream outline, "INVENGIC" as default text in an 8-bit font, and "Actual size" at a different scale per shape. The laser ignores dragged text position. Photos burn as hard black and white, but the landing page shows greyscale portraits | m_11b_create_open_full, m_14_name_typed, sheet_create; js/app.js:984; keychain-layout.js:224; functions/index.js:66-67; printer-agent/index.js:306; image-processor.js:431-450 |
| 4 | Login wall (name, phone, SMS OTP) before any design; X closes it anyway; "+91" shows as "1"; raw Firebase errors | index.html:100; js/app.js:601-603, 304-312; sheet_mobile, m_09_after_pay_click |
| 5 | On phones the preview is hidden while typing, price and CTA are about 2.5 screens down, "Buy Now" does the same as "Add to Cart" and wipes the design, and the header overflows ("Sign In" wraps, "Home" cut off) | m_11_create_open, m_14_name_typed; js/app.js:1597-1605, 2509-2511 |
| 6 | The page after payment claims things it doesn't know ("Verified & Paid", "#14", "3-6 min", "Keychain for is in line"). "Notify me" is an unstyled button that fails on Android Chrome | m_10_success_design; index.html:669-756; js/app.js:2046-2082 |
| 7 | Payment leaves the site, shows another brand ("Laser Keychain", #00e5ff), offers "Generate Fresh QR" (a new order on every click) and fails with alert() boxes | js/app.js:1695-1709, 1746, 1756, 2100-2116; index.html:615-622 |
| 8 | Staff side: the laser starts itself after 5 s, failed jobs re-run, the dashboard draws everything as a rectangle and photos as "UNKNOWN", there is no Ready, Collected or Refund, the machine ID is never saved, and the start point is reset wherever the head stopped after a reconnect | printer-agent/index.js:26, 219-247; dashboard/app.js:74-100; functions/index.js:572-581; laser-sender.js:179-180 |
| 9 | The brand fights the product: raster chrome-and-neon star in a white box, indigo-cyan gradient, AI renders of things the machine can't make, contradictory claims (oak/walnut/birch, "Oval, or Shield", "delivery"), an anonymous testimonial, four domains | assets/logo.png; m_01_welcome_fold; index.html:256, 285-287, 896, 949 |
| 10 | Too heavy for venue networks: about 5.3 MB landing page (4.9 MB of PNG renders, two files identical), 7 font families, 9 blocking scripts, `no-store` on all code, about 4.6 s to load | assets/keychains/; index.html:12, 964-984; firebase.json:18-21 |

---

## 2. The recrafted experience

### Principles
1. **Design first, pay once, no account.** The phone number is asked once, on the pay step, for the WhatsApp update. The UPI payment is the verification.
2. **What you see is what burns.** The preview, proof, share image and G-code all come from one shared engine and one shape file. If the machine can't do something (drag, greyscale, Hindi today), the UI doesn't offer it.
3. **Time is the product.** After payment, every screen answers four things: my token, how many ahead, ready by when, what to do now.
4. **Only true things.** Every number is live or not shown. No placeholder queue numbers, no renders, no anonymous reviews.
5. **The laser is the show.** The one moment worth bringing people back to the counter for is their piece under the beam.
6. **Built for a stall.** It must cope with crowded 4G, glare, one-thumb use, QR-scanner in-app browsers, borrowed phones and no phone at all. Staff can finish any journey for a customer.
7. **Every customer status has a staff action.** Paid, burning, ready, collected and refunded are each one tap somewhere.

### Decisions where the specialist reports disagreed
- **Accounts:** none. No OTP anywhere in the order flow.
- **Updates:** WhatsApp utility messages, with SMS as fallback. Browser notifications are dropped: Android needs a service worker for them, and iOS only allows them in an installed app.
- **Pickup check:** token (A07) plus first name. Staff confirm with the design thumbnail or the last 4 digits of the phone. No separate pickup code.
- **Cart:** removed. "Add one for someone else" sits on the proof step and adds line items to the same order.
- **Text position:** no free drag. Text is fitted and centred automatically, which is what the laser burns.
- **Autofocus:** none on load. The first screen shows the wood, and the keyboard opens on tap.
- **Entry:** an event QR opens the designer directly. The landing page is for other visitors.
- **Domain:** lsr.invengic.in is the only host on QRs and links. All others redirect to it.
- **Name:** "Invengic Studio" in text everywhere (site, Razorpay, WhatsApp, TV board). The logo is the mark plus "invengic".
- **Look:** the Birch / Char / Ember palette in section 4 (contrast checked).

### New end-to-end flow (event mode)

| Step | Customer sees / does | Change vs today |
|---|---|---|
| **0 Booth** | Standee with real engraved blanks fixed to it: "Your name, burnt into real wood. Ready in about 15 min. ₹99." A big QR: "No app. No login." A TV next to the laser: "Now burning A12 · Ready A09 A10 · Wait ~15 min". | Today price and time are unknown until deep in the designer, and there is no public queue. |
| **1 Scan** | `lsr.invengic.in/e/<event>` opens straight into the designer. The wood preview cycles ghost names (PRIYA, KABIR, BRUNO). Header chip: "4 ahead · ~12 min". If the laser is offline: "Short break. Design now, we'll queue you when we're back." | Today: generic landing page, then the login modal. |
| **2 Design** | The name appears live on photographed wood as they type, fitted to size, with a legibility meter. Shape chips (sold-out shapes greyed), style chips showing their own name, optional symbols. Secondary link: "Use a photo or logo instead" (honest black-and-white preview plus its own wait time). Sticky bar: "₹99 · ready ~2:40 PM · Next". | No login, no cart, no "INVENGIC", no drag. |
| **3 Proof** | "This is exactly what the laser will burn." The proof comes from the same engine and is checked by the server. Offers: "Add one for someone else +₹79", "Gift pouch + card +₹29". | New. |
| **4 Pay** | One field: WhatsApp number (+91 fixed, number keypad). Button: "Pay ₹99 with UPI", which opens Razorpay Checkout with UPI apps first and returns to the page. Secondary: "Pay at the counter (cash or stall QR)". | Today: full-page redirect, "Laser Keychain" branding, fallback QR buttons. |
| **5 Confirming** | "Finish in your UPI app… Confirming with your bank." If pending: "Still confirming. Don't pay again." If failed: "Didn't go through. No money taken. [Try again]", with the design kept. The server's Razorpay webhook decides. | Today: "Verified & Paid" before any check. |
| **6 Token** | A giant A07, their design on wood, "3 ahead · ready around 2:49 PM", and "Walk around. We'll WhatsApp you when you're next." The page lives at `/o/<id>`, the same link sent on WhatsApp, so closing the tab is safe. | Today: a global #N that keeps growing, a fixed "3-6 min", and the tab must stay open. |
| **7 Wait** | When one job is ahead of theirs, WhatsApp: "You're next. Come watch yours being burnt." While it burns: live progress and "Under the laser now". | New. |
| **8 Pickup** | Staff wipe the piece, fit the ring and tap Ready. WhatsApp: "A07 is ready at the counter." The customer shows the token and staff tap Collected. Handed over on a kraft card with the stamp mark and a QR back to `/o/<id>`. | Today: no ready message and no handover step. |
| **9 After** | `/o/<id>` becomes the after page: a 1080×1920 story card of their design on wood with the event name, "Make one for someone", a referral code "AARAV20: ₹20 off for a friend today", and a one-tap rating. One WhatsApp 30 min after pickup: "How did it turn out?" | Today: "Create Another", which triggers the login again. |

**Side paths**
- **Group or family:** one payer, N line items each with a recipient name. Sub-tokens A07·1 to A07·3 appear together on the board.
- **Long queue:** when the wait passes a per-event cap (e.g. 45 min), new photo orders switch to "collect after 5:30 PM". Near closing time, intake stops with a message.
- **No phone, cash, or kids:** kiosk mode on the stall tablet (`/e/<event>?kiosk=1`). No phone field, large type, reset after 60 s idle, "Pay at counter". The token is shown on the board or written on a slip.
- **In-app browsers** (Google Lens, PhonePe, Paytm, WhatsApp scanner): the design autosaves locally and the order is held on the server. Coming back from the UPI app in a different browser still lands on `/o/<id>`.

---

## 3. Screens

### 3.1 Landing page (non-event visits)
**Purpose:** answer price, time and "does it look good" within 5 seconds, then one tap to design.

**Layout, top to bottom:**
- Header, 52 px: mark and a live chip ("Laser live · 3 in line" or "Paused, back soon").
- Hero, top ~55% of the screen: one real photo of a burnt name on birch (AVIF, ≤60 KB). A 6 s muted loop loads after the first paint.
- H1: "Your name, burnt into real wood."
- Sub: "Design it on your phone. Watch our laser make it."
- Price row: "Name ₹99 · Photo ₹199 · 3 shapes".
- CTA "Start my keychain": a real `<a>` link, so it works before JS loads; becomes sticky after scrolling.
- Three real shape photos; tapping one opens the designer with that shape.
- Three steps (Type · Pay by UPI · Watch it burn) drawn in the toolpath-line style.
- Wall "Burnt at <last event>": real photos, with consent and first names.
- Three FAQs: How long? What wood and size? Can I use a photo?
- Footer: WhatsApp help, refund policy, privacy.

**Remove:** the glass card, floating renders, parallax, the "Customer Experience" pill, the anonymous testimonial, and the dead help button (index.html:43-50).

### 3.2 Studio (the design screen)
**Purpose:** see your own name on real wood within 10 seconds, using one thumb.

```
┌────────────────────────────────────┐
│ <  invengic         ● 4 ahead ~12m │  52 px
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │   photo of birch rectangle     │ │  sticky preview, ~40% of screen
│ │   o      A A R A V             │ │  burn-brown, auto-fit, centred
│ │                                │ │  shrinks to a 128 px strip
│ └────────────────────────────────┘ │  when the keyboard is open
│  Actual size (next to a ₹10 coin)  │
├────────────────────────────────────┤
│ [Rect 72x35] [Circle 50] [Heart]   │  photo chips, sold-out greyed
│ ( Name )  ( Photo )                │  segmented control
│ ┌────────────────────────────────┐ │
│ │ AARAV                     5/14 │ │  56 px input, no autofocus
│ └────────────────────────────────┘ │
│ Crisp ■■■■□                        │  legibility meter
│ Style [Classic][Poster][Script]... │  each chip shows AARAV
│ Symbol  heart star infinity moon . │  engravable glyphs only
├────────────────────────────────────┤
│ ₹99 · ready ~2:40 PM   [  Next  ]  │  sticky, 72 px + safe area
└────────────────────────────────────┘
```

**Key interactions**
- **Preview:** drawn with the Burn colour (#3A2317) and a slight char blur on a top-down photo of that exact blank, at the same px/mm for every shape. The "Actual size" toggle shows a ₹10 coin (27 mm) for scale.
- **Legibility meter:** based on the letter height the engine computes. It reads "Crisp", "Getting small: fewer letters burn sharper" or "Too small to burn clearly". The thresholds come from test burns.
- **Unsupported characters** are blocked as they are typed, with a reason ("This style can't burn Hindi letters yet").
- **Style chips** are named by feel and rendered with the customer's own text: Classic, Poster, Script, Marker, Pixel.
- **Symbols:** about 12, each checked against the engraving font: heart, star, infinity, sparkle, music note, sun, moon, paw, crown, flower, lightning, plus cricket bat only if the glyph exists. This replaces 64 colour emoji that burn as "?" when unsupported.
- **Photo mode:**
  - One "Add photo" button using the phone's own picker (`<input type=file accept=image/*>`), which offers both camera and gallery. The photo is processed automatically.
  - Controls: one "Lighter / Darker" slider; "Swap light/dark" under More; pinch and drag on the masked preview.
  - Tip: "Close-ups of faces or pets on a plain background burn best." Wait note: "Photos take about 6 min on the laser."
- **Disabled Next** says what's missing: "Type a name to continue".

**Microcopy:** placeholder "Type a name". Empty-state hint "Try PRIYA, KABIR or BULLET 350".

### 3.3 Proof & Pay (bottom sheet, 92% of screen height)
**Proof**
- Large proof under "This is exactly what the laser will burn."
- Spec line "Heart · Classic · AARAV", with an Edit link.
- "+ Add one for someone else (₹79)" opens the studio with shape and style prefilled and an empty name. Each item is listed with its thumbnail.
- Toggle: "Gift pouch + care card +₹29".

**Pay**
- "WhatsApp number" field: +91 fixed, `inputmode=numeric`, `autocomplete=tel`. Helper: "Only to tell you when it's ready. No OTP, no spam."
- Optional "Name for pickup", prefilled from the engraving text.
- Primary 56 px button: **"Pay ₹99 with UPI"**. Secondary link: "Pay at the counter instead".
- Small print: "Misprint? We remake it free, on the spot."
- Razorpay Checkout settings: name "Invengic Studio", the new logo, theme colour Char, contact prefilled, description "AARAV · Heart · Name keychain".

### 3.4 Confirming (full-screen state)
- "Finish paying in your UPI app", then "Confirming with your bank…" (spinner up to about 10 s), then the token.
- Pending: "Your bank is still confirming. Don't pay again. This screen updates by itself. Ref pay_xxx."
- Failed: "Payment didn't go through. No money was taken. [Try again]".

### 3.5 Live status / token (`/o/<id>`)
**Purpose:** let the customer walk away, and bring them back at the right moment.

```
┌────────────────────────────────────┐
│ invengic                   ● Live  │
│                                    │
│                A07                 │  Bricolage 800, ~40vw
│             for AARAV              │
│   ┌──────────────────────────┐     │
│   │  their design on wood    │     │  rendered from the saved job
│   └──────────────────────────┘     │
│ ● Paid ─ ● In line ─ ○ Burning ─ ○ Ready
│   3 ahead · ready around 2:49 PM   │
│                                    │
│   Walk around. We'll WhatsApp      │
│   +91 98xxx xx210 when you're next.│
│                                    │
│   [ Show this at the counter ]     │  full-screen token for staff
│   Share my keychain  ·  Help       │
└────────────────────────────────────┘
While burning: Beam-blue bar "Under the laser now · 64%"
Ready: card turns Leaf green, "Ready! Show A07 at the counter."
```

**Status lines**
- "Confirming your payment…"
- "Paid ₹99 · 3 ahead · ready around 2:49 PM"
- "You're next. Come watch yours being burnt."
- "Under the laser now · 64%"
- "Ready! Show A07 at the counter."
- "Enjoy it. Share it?"

**Problem messages**
- "The laser is taking a short break. You keep your place."
- "We're redoing yours for a cleaner burn (+3 min)."
- "This photo can't be engraved. ₹199 refunded to your UPI (ref …). [Design again]"

**Interactions**
- Screen-reader updates via aria-live.
- Vibration and sound at "You're next" and "Ready" while the page is open.
- The token flips like a departure board when it changes.
- Share button uses the Web Share API with the card image.
- "Help: WhatsApp the stall".

### 3.6 Counter board (TV, `/board/<event>`)
- **Left 60%:** "Now burning A05 PRIYA", with the proof shown large and a progress bar.
- **Right:** "Up next" (6 rows: token, first name, ~minutes) and "Ready to collect" tokens.
- **Bottom band:** QR and "₹99 · scan to make yours · wait ~15 min".
- Dark (Char) theme. Tokens and first names only; customers who opt out show as token only.

### 3.7 Staff console
See section 5.

---

## 4. Brand & logo

**Positioning:** "Your name, burnt into real wood, while you watch." For young people and families at fests, malls and melas who want a souvenir that is actually theirs.

**Personality:** the proud craftsman at the fest. Warm (wood, hands, smoke), a little cheeky, proud of the machine, honest. Not gamer neon, not SaaS glass, not a luxury gift box, not handicraft-emporium kitsch.

**Voice:**
- "Start my keychain"
- "You're A07. 3 ahead. Grab a chai, we'll ping you."
- "Burning now. Come watch!"
- "Ready! Show A07 at the counter."
- "The laser's taking a breather. Your spot's safe."

**Name:** "Invengic Studio" in all text. Retire "Laser Keychain" (Razorpay) and "LASER" (dashboard).

### Logo concepts
All three are flat, one colour and vector, built as closed paths so the CV-01 Pro can burn them.

- **A. "Tag-i" (recommended primary)**
  - The 72×35 blank stood upright as a 35:72 rounded rectangle (corner radius about 11% of its width), with the ring hole (about 14% of the width) near the top.
  - The tag reads as a lowercase "i": the hole is the dot, the body is the stem.
  - A hang-tag variant adds a 1.25-turn split ring drawn as an open two-stroke circle.
  - Wordmark: lowercase "invengic" in Bricolage Grotesque 800, custom-kerned. Optionally, both i's are replaced by the tag glyph.
  - Live state: the hole fills with Ember while the laser is firing (board, token screen).
  - Uses: favicon, app icon, rubber stamp for card and pouch, standee, back-of-tag hallmark test.
- **B. "Spark i"**
  - A lowercase wordmark where the dot of the "i" is a solid Ember laser point with a short 45° burn trail: the laser caught mid-burn.
  - It must be hand-drawn, or it becomes a generic signature logo.
  - Use it as the motion and "live" accent (loader, live chip), not as the main mark.
- **C. "Raster heart"**
  - The 55×50 heart blank built from 6 horizontal raster lines of different lengths (this is how image-to-gcode burns, and it looks like wood grain). The last line is unfinished, with an Ember tip.
  - Use it as a pattern on pouches and the standee, and as the loading animation (lines fill top to bottom).
  - Secondary only, because a heart reads as romantic.

**System:** A is the logo, B's ember dot is the live accent, C is the pattern and loader.

**Pass criteria:**
- Readable at 16 px.
- Still reads when burnt at 10 mm on your blank (test burn).
- Works in Char on Birch or Kraft, reversed in Birch on Char, and in Ember only.

**Deliverables:**
- SVG mark, wordmark, and horizontal and stacked lockups, plus transparent PNGs.
- favicon.svg; 32, 180, 192 and 512 px icons.
- 1200×630 OG image.
- Clear space: two hole-diameters.

**Interim (Phase 0):** remove the chrome star from header and footer. It shows as a white box on tinted headers, and the footer's invert filter turns its cyan glow red (style.css:221-225). Set "invengic" as live text until the new mark is ready.

### Palette (WCAG contrast computed for this plan)

| Role | Name | Hex | Rule / contrast |
|---|---|---|---|
| Page | Birch | #F7F0E3 | Background |
| Surface | Kraft | #E8D5B5 | Cards, packaging |
| Text, icons, focus ring | Char | #1F1410 | 15.9:1 on Birch |
| Secondary text | Walnut | #6B4226 | 7.6:1 on Birch |
| Muted text | Smoke | #6F645B | 5.1:1 on Birch; large text only on Kraft (4.0:1) |
| Engraving in previews | Burn | #3A2317 | 10.2:1 on Kraft |
| Primary button fill | Ember | #FF5B1F | Char label 5.8:1. Never a white label (3.1:1). Never text on Birch (2.7:1) |
| Ember text and links on light | Ember Deep | #C2410C | 4.6:1 on Birch |
| Laser firing only | Beam | #3346FF | 5.4:1 on Birch |
| Ready | Leaf | #25683F | 5.9:1 on Birch |

**Dark set** (TV board, night events): background Char, surface #2B1D16, text Birch (14.4:1), Ember unchanged (5.8:1 on Char), Beam Light #7C8BFF (6.0:1).

**Rules:**
- About 60% Birch/Kraft, 30% Char/Walnut, at most 10% Ember.
- No gradients, glows, glass or grid backgrounds.
- Colours only through tokens. Today #6366f1 alone is hard-coded 46 times.

### Type (all free)
- **Display:** Bricolage Grotesque 700-800, for headlines, prices and tokens. Check it has tabular figures for tokens; if not, set each digit in a fixed-width cell.
- **UI and body:** Anek Latin 400/500/600, from an Indian foundry. Anek Devanagari shares its metrics for the Hindi toggle later.
- Self-hosted woff2, subset to Latin plus ₹, 60 KB or less in total. Sentence case, no tracked ALL CAPS labels.
- **Engraving fonts are product, not UI**, and load only in the studio:
  - Classic (Montserrat Bold): the new default, if it passes the legibility test burn.
  - Poster (Bebas Neue), Script (Pacifico), Marker (Permanent Marker).
  - Pixel: kept, but not the default.
- **Add later, only after test burns:** a Serif (Fraunces or Playfair) and a single-line "Pen" style (Relief SingleLine or Hershey).
- **Hindi engraving** (Anek Devanagari or Kalam): only after a test shows opentype.js shapes conjuncts correctly (Assumed risk).

### Photography, graphics, motion
- **Photos:**
  - Only real pieces burnt on this CV-01 Pro with the live pipeline, captioned "Actual burn · 72 × 35 mm".
  - Lighting: one warm hard light at 30-45° so the burn depth shows, a soft fill, about 4500-5000 K. Same table and kraft backdrop, camera about 60° from above.
  - Shot list (12):
    - 3 shape close-ups
    - 2 in hand
    - 2 on real keys (scooter key, bike key, hostel key, college lanyard)
    - the machine burning with the dot visible through the shield
    - a smoke close-up
    - friends holding their tags (with consent)
    - a 3×3 flat lay
    - the pouch
  - Sample names: PRIYA, KABIR, RIYA + ARJUN, BULLET 350, BRUNO.
- **Illustration:** "toolpath line" style: 1.5 px Char line with round caps and an Ember dot at the end of each path.
- **Icons:**
  - Lucide at a 1.75 px stroke on a 24 px grid, plus 5 custom icons (the 3 blanks, burn, token).
  - Emoji appear only as engravable content, never as UI. About 20 are used as icons today.
- **Motion:**
  - Signature burn-in: when the customer taps "Looks good" (and after a 600 ms pause in typing), an Ember dot traces the real toolpath and leaves Burn-coloured lines, taking 1.2-1.8 s, followed by a 400 ms smoke wisp. It is instant when the phone's reduced-motion setting is on.
  - The token flips when it changes. Beam blue pulses while their piece burns. Buttons press down 1 px like a stamp.
  - Remove the hover scaling, float effects and the 16 looping animations.

### Booth and packaging
1. **Roll-up standee** (80×200 cm, matte vinyl, because gloss glares):
   - Logo and tagline at the top, one real close-up in the middle.
   - A QR at least 20 cm square, placed 110-150 cm from the floor (the rule of thumb is 10:1 scan distance to QR size), error correction Q, 4-module quiet zone.
   - The price next to it in 12 cm numerals, and the 4 toolpath step icons below.
2. **A5 table tents:** 8 cm QR, the URL written out, price, "No app. No login."
3. **A wooden QR plaque** burnt on your own machine, as proof of craft. Test-scan it with 3 phones under event lighting first.
4. **Burn stage:**
   - The machine on a 20-30 cm riser at the front edge.
   - A ledge at phone height so people can film.
   - The TV board beside it.
   - Keep the shield on, because people will lean in.
5. **Handover card** (89×51 mm kraft, stamped with Tag-i in Char ink):
   - Front: "Real wood, burnt for you at <event>".
   - Back: "Keep it dry. If it fades, rub in a drop of food-safe oil.", the Instagram handle, and a QR to `/o/<id>`.
6. **Pouch** (the ₹29 add-on): 8×12 cm kraft, stamped, sealed with a round sticker "burnt for ____ · A07" filled in by hand.
7. **Staff:** canvas aprons with the mark. Staff name tags are the product itself.
8. **Back-of-tag hallmark:** experiment only. Time the extra flip plus an Assumed 10-20 s per piece before adopting it.

---

## 5. Operator system

### Target architecture
```
 Customer phone                    Cloud (Firebase + Razorpay)                   Stall
 ──────────────                    ───────────────────────────                   ─────
 /e/<event> studio ─createCheckout─▶ validate design (engrave-core), price,
                                     make proof + G-code + estSec,
 Razorpay Checkout (UPI) ─webhook──▶ razorpayWebhook: paid → jobs → machine+token
 /o/<id> status ◀──publicStatus──── reconcile (2 min) · sweep (1 min)
 WhatsApp / SMS ◀─────────────────── notify (template, SMS fallback)
                                     Firestore: events, machines, orders,  ◀──actions── Staff console /staff
                                     jobs, payments, publicStatus, audit   ───────────▶ TV board /board
                                                                          ◀──lease──── Printer agent (service,
                                                                                       one per laser)
                                                                                         │ USB, GRBL
                                                                                       CV-01 Pro
```

**Rules:**
- The server owns every state.
- A person starts every burn.
- Every failure has a named state, an owner and a money outcome.
- Public screens show tokens and first names only.

### Data model (Firestore)
- **`events/{id}`:** name, token prefix, state (open / paused / closed) plus message, price table, enabled shapes and blanks left, photo mode (on / off / collect-later), maximum wait, languages.
- **`machines/{id}`:** event, state, heartbeat, current job, average run time per shape and mode, calibration offsets.
- **`orders/{id}`** (private): event, customer {firstName, phone, consent}, line items, amount (computed by the server), Razorpay order and payment IDs, state, idempotency key.
- **`jobs/{id}`** (private): order, machine, token (A07·1), shape, mode, design spec (versioned), proof SVG, G-code path, estimated seconds, state, attempt, lease, and a timestamp for every state.
- **`payments/{paymentId}`:** created in the same transaction that marks the order paid, so one payment can never be used twice.
- **`publicStatus/{unguessableId}`:** token, first name, state, number ahead, ETA, progress, event message. Readable by ID only.
- **`audit/{id}`:** every staff action, with who did it and why.

**Access rules:**
- Nothing is public except `publicStatus` by ID and the board data.
- Staff (login with role=operator for their event) act through callable functions.
- The agent (role=agent, its own machine ID) can only claim its own machine's jobs.
- Clients never write to the database directly: all writes go through callable functions protected by App Check.

### Order lifecycle
- **Order:** `awaiting_payment` → `paid` (set by the webhook) or `expired` (unpaid after 30 min). A paid order fans out into N jobs and ends as `completed`, `partially_refunded` or `refunded`.
- **Job:** `needs_approval` (photos only) → `queued` → `loading` (staff told which blank) → `engraving` → `check` → `ready` (shelf slot; customer messaged) → `collected`.
- **Side states:**
  - `redo` (attempt +1, with a reason)
  - `failed_needs_operator`
  - `on_hold`
  - `moved` (to another machine)
  - `cancelled` → `refund_pending` → `refunded`
  - `rejected_image` → `refunded`
  - `payment_unconfirmed` (counter payment waiting for staff)
- **What the customer sees:**

  | State | Customer label |
  |---|---|
  | awaiting_payment | "Confirming payment" |
  | queued | "In line" |
  | loading (theirs is next) | "You're next" |
  | engraving | "Under the laser" |
  | check | "Finishing" |
  | ready | "Ready" |
  | collected | "Collected" |

### Failure handling

| Failure | Detected by | Customer sees | Action |
|---|---|---|---|
| Paid, but never came back from the UPI app | Webhook, plus a reconcile job every 2 min | WhatsApp with the `/o/` link | Queued automatically |
| Payment still pending | Razorpay status | "Still confirming. Don't pay again." | Reconciled; expires after 30 min |
| Paid twice | `payments/{id}` plus the order's idempotency key | "Already paid. The duplicate is being refunded." | Automatic refund |
| Laptop asleep or agent crashed | Heartbeat older than 45 s | "Short break. You keep your place." Checkout shows a break notice | Event pauses intake; owner gets a WhatsApp alert |
| USB drop or GRBL alarm during a job | Agent | "Short pause on your piece" | `M5`, `failed_needs_operator`, reset the start point, Redo |
| Bad burn or cracked blank | Staff at the Check step | "Redoing yours for a cleaner burn (+N min)" | Redo with a reason; wasted blank counted |
| Unsuitable photo | Automated image check (SafeSearch) plus staff approval | "Can't engrave this photo. ₹199 refunded. [Design again]" | Reject triggers the refund |
| A shape runs out of blanks | Blank count reaches 0 | Shape greyed: "Sold out today" | Staff edit the count |
| Queue too long | ETA above the event cap | Photos: "collect after 5:30 PM"; intake closes near the end | Event settings |
| Customer doesn't collect | Ready for more than 20 min | Reminder on WhatsApp | Highlighted "CALL" in the console |
| Message not delivered | Provider delivery status | — | "Not delivered → call" in the console |

Two further gaps this closes:
- Today, image moderation never runs, because the browser always sends base64 and the server marks base64 images safe (functions/index.js:79-92). Photos will be uploaded to private storage, checked, and approved by staff.
- Today, the only fix for a stuck order is editing it in the Firebase console (OPERATOR-GUIDE.md:257-258). The console actions and job leases replace that.

### Staff console (`/staff/<event>`)
PIN plus staff login. Runs on the laptop at the laser or on a tablet, with touch and keyboard.

```
┌ Invengic Studio · <Event> ─ L1 ● Engraving 64% · 1:10 left ─ Wait ~15 min ─ Blanks ▭32 ○9 ♡4 ─ [Pause intake] ┐
│ NEEDS YOU: 1 failed job · 2 photos to approve · 0 paid-not-queued · 1 message not delivered → call        │
├──────── UP NEXT ──────────────┬──────────── MACHINE L1 ─────────────┬────────── READY / PICKUP ───────────┤
│ A08 PRIYA  ♡ heart · text ~1m │ LOAD: ♡ HEART blank (slot 3)        │ A03 KABIR  shelf 2 · 12 min · sent  │
│ [proof on wood]               │ ┌─────────────────────────────┐     │ A04 RIYA   shelf 3 ·  4 min · sent  │
│ A09 BRUNO  ▭ rect · photo ~6m │ │   exact proof on wood        │     │ A06 ANU    shelf 1 · 22 min · CALL  │
│ [b/w preview] [Approve][Reject]│ └─────────────────────────────┘     │                                     │
│ A10·1 ANU  ○ circle · text    │ [ Frame ]      [ START  (Space) ]   │ [Collected]  (tap, or scan their QR)│
│ swipe: Hold · Move · Refund   │ engraving: 64%   [Pause] [Stop]     │                                     │
│ [+ Walk-in order] [Cash paid] │ done: [Looks good → shelf 4] [Redo ▾]│                                    │
└───────────────────────────────┴─────────────────────────────────────┴─────────────────────────────────────┘
```

- No typing anywhere in the main loop.
- A chime for a new paid job and a different chime when a job finishes.
- Start with Space or a USB foot pedal (it sends a key press).
- Stop sends `M5` and asks for confirmation. Refunds need a reason. Every action is logged.
- **Owner view (phone):**
  - Today's figures: orders, revenue, median time from payment to ready, redo rate, refunds, blanks per order, uptime.
  - WhatsApp alerts when a machine is offline for over 2 min during open hours, when a paid order is not queued, or when 3 jobs fail in a row.

### Printer agent changes
- **Always running:** it runs as a Windows service (NSSM or pm2) that restarts itself, with a version number.
- **Limited login:** it uses a limited, revocable login per laptop instead of the full admin key (printer-agent/index.js:23-34).
- **Leases:** it claims jobs with a 90 s lease renewed by the heartbeat. A sweeper moves expired leases to `failed_needs_operator`.
- **Start gate:** it waits for Start, and offers Frame (traces the outline at zero or low power) before burning.
- **Failure behaviour:** on an alarm, USB drop or lost lease it sends `M5`, reports the failure, and never re-queues the job itself.
- **Start point safety:** it never declares the current head position as the start point after a reconnect (`G92` at laser-sender.js:179-180, Derived risk). Use `$H` homing if limit switches are confirmed on your unit. Otherwise, require "set origin at fixture mark" after every reconnect. Hardware check required.
- **Streaming:** it sends G-code with GRBL character counting instead of waiting for "ok" after every line (laser-sender.js:233-254; one name produced 14,071 lines). Curves are split by an error tolerance (0.05 mm) instead of a fixed 10 segments, and progress comes from GRBL status reports. The effect on burn darkness and time is Assumed until measured.
- **Shared engine:** it runs the G-code produced at checkout by engrave-core. No more hand-copied "KEEP IN SYNC" constants.
- **Later:**
  - A multi-slot fixture plate on the roughly 170×200 mm bed (for example 2 rectangles, 1 circle, 1 heart), so blanks don't need swapping between shapes.
  - A calibration wizard: burn a test cross, nudge ±0.5 mm, save the offsets.

---

## 6. Growth

### Pricing (launch hypothesis; test across 2 events)

| Item | Price | Rationale |
|---|---|---|
| Name/text keychain, any shape | ₹99 | Impulse price |
| Photo, pet or logo | ₹199 | About 6 min of laser time vs about 1 (Derived), and a higher-value gift |
| Each extra piece in the same order | ₹79 | Couples, siblings, friends |
| Gift pouch + care card | ₹29 | Uses no laser time |
| Bulk, 10+ (clubs, fest organisers, Diwali corporate) | ₹79/piece, pre-order | Taken through a WhatsApp form, burnt off-peak, never in the live queue |

**Capacity math.** Motion times are Derived from the 43 G-code files: text 0.1-1 min, photo 4.9-6.7 min. Handling is Assumed at about 1 min per job. Real times will be longer while G-code is sent line by line, so measure at the first event.
- **Text:** about 2 min per slot, so about 30 per hour, about ₹3,000 per laser-hour.
- **Photo:** about 7 min per slot, so about 8 per hour, about ₹1,600 per laser-hour even at ₹199.
- **So:** photos are what to throttle at peak ("collect later"). Extra pieces and pouches are where margin grows.
- **Owner to fill in:** blank plus ring cost, pouch cost.
- **Known per-order costs:** Razorpay about 2%. WhatsApp utility message about ₹0.12 + GST each (Assumed; check Meta's current India rate). The OTP SMS cost disappears.

### Upsells
Only on the proof sheet, at most two, no pop-ups:
- "Add one for someone else (+₹79)"
- "Gift pouch + card (+₹29)"

Seasonal presets in the studio: Rakhi (sibling pair), Friendship Day (friends pair), Valentine's (couple hearts), Diwali (family or corporate set).

### Sharing and referral
- **Story card** (1080×1920) on `/o/<id>` after pickup: their design on wood with "Burnt live at <event> · Invengic Studio".
- **Share page** `/k/<id>`: a server-made 1200×630 preview image of their design, 300 KB or less (WhatsApp drops larger previews), with no personal data.
- **Link previews and icon:** OG tags and a favicon on the site. There are none today (index.html:4-15).
- **Referral code** from the first name: "AARAV20: ₹20 off for a friend, today at this stall". Track redemptions per order.
- **Rating:** one WhatsApp 30 min after pickup, with a Google review link.
- **Next events:** an explicit opt-in, unticked by default, for "next event near you" and festival offers.

### Attribution and analytics
- **QR per placement:** `/e/<event>?m=<machine>&src=standee|table|board|card`. Save event, source and machine on every order.
- **Tools:** PostHog (free tier) for client events. Firestore stays the source of truth for money.
- **Events tracked:**
  - Design: `studio_view`, `shape_selected`, `mode_selected`, `text_entered`, `photo_added`, `photo_processed_ok/fail`, `design_complete`, `upsell_shown/accepted`.
  - Payment: `pay_tap`, `checkout_opened`, `payment_success`, `payment_failed` (with error code), `payment_dismissed`, `counter_pay_selected`.
  - Queue: `order_queued`, `engraving_started`, `ready`, `collected`.
  - After: `share_tap`, `referral_redeemed`, `review_click`, `bulk_lead`.

### Funnel targets
These are targets, not benchmarks. Take a baseline at the first event, because nothing is measured today.

| Stage | Target |
|---|---|
| Stall visitors who scan (count by hand) | ≥30% |
| Scan → studio usable | <2.5 s on 4G (today ~4.6 s, Verified) |
| Studio → design complete | ≥65% text, ≥50% photo |
| Design complete → pay tap | ≥70% |
| Pay tap → paid | ≥88% |
| Scan → paid | ≥30% |
| Median scan → paid | ≤90 s text, ≤3 min photo |
| Average order value / items per order | ≥₹140 / ≥1.25 |
| Pouch take-up / extra-piece take-up | ≥25% / ≥12% |
| Wait time: median / 90th percentile | ≤15 min / ≤35 min |
| Ready by the promised time | ≥90% |
| Paid → collected | ≥98% |
| Redo + refund rate | ≤2% |
| Share taps / referral redemptions / reviews | ≥20% of pickups / ≥8% of orders / ≥5 per event |
| Laser busy during open hours | ≥75%; track ₹ per laser-hour per event |

---

## 7. Tech approach & performance budgets

**Rebuild rather than patch.** js/app.js is 2,599 lines with 23 `window.*` globals. There are three ways into the designer (index.html:100, app.js:601, the `#create` hash at 2583), and one click can fire two code paths.

**Stack:**
- **Frontend:** SvelteKit with TypeScript and Vite, built as static files. The landing page is pre-built; `/e`, `/o`, `/k`, `/board` and `/staff` are client routes with explicit rewrites. Svelte compiles to small JavaScript, escapes text by default, and is closest to the plain HTML/CSS/JS the team already writes. No server rendering is needed.
- **Firebase stays:** Hosting (serving only the build folder), Cloud Functions v2, Firestore, and private Storage for photos. The modular Firebase SDK (v10+) loads only on `/o`, `/staff` and `/board`.
- **Payment:** Razorpay Standard Checkout with a server-created order ID and a client idempotency key, so retries reuse the same order. `checkout.js` loads only when the pay sheet opens. The webhook is the source of truth. Payment links remain only as a hidden fallback.

**engrave-core (shared TypeScript package):**
- `shapes.json` in mm: outline, hole, text box, image box.
- Glyph outlines generated at build time from the same TTF files the agent uses: A-Z, 0-9, punctuation, allowed symbols, kerning.
- Functions: `layoutText` (returns paths in mm), `processImage` (the exact bitmap the laser gets), `toSvg`, `toGcode`, `estimateSeconds`.
- Used by the studio preview, by `createCheckout` (validation, proof, G-code, time estimate) and by the agent.
- Golden tests check that preview paths equal the agent's toolpath for 3 shapes × 2 modes × every font.

**Messaging:**
- WhatsApp Cloud API or a WhatsApp provider, with 3 utility templates: "paid + link", "you're next", "ready".
- A DLT-registered SMS template as fallback. The current Fast2SMS "without DLT" route (functions/index.js:623) risks being blocked by carriers.
- Start WhatsApp template approval and DLT registration in Phase 0; both take days.

**Caching, offline and images:**
- **Caching:** hashed assets get `public, max-age=31536000, immutable`; HTML gets `no-cache`.
- **Rewrites:** remove the `**` catch-all. Today `/favicon.ico` returns the HTML page.
- **Offline:** a service worker precaches the studio shell, default glyphs and wood textures. The design autosaves in IndexedDB, not as base64 in localStorage (js/cart.js:35).
- **Images:**
  - AVIF/WebP through `<picture>` with width and height set, high fetch priority on the first image, lazy loading on the rest.
  - The performance review measured the 4.9 MB of PNG renders at about 180 KB as WebP.
  - Photos come in through the phone's own file input and are decoded with `createImageBitmap`. Drop Cropper and the custom camera modal.

**Accessibility:**
- Native radio buttons for shape, style and mode, and native `<dialog>` for overlays.
- A global visible focus ring and a global reduced-motion rule.
- aria-live for status updates.
- No `alert()` or `confirm()`.

**Security:**
- Callable functions protected by App Check, an origin allow-list, and per-device rate limits.
- Secrets kept in Secret Manager.

**CI:**
- Lighthouse CI and size-limit budgets, axe accessibility checks, golden engraving tests.
- Playwright flow tests on Android Chrome and iOS Safari profiles.

**Budgets (enforced in CI):**

| Surface | Budget |
|---|---|
| Landing | ≤150 KB transfer; JS ≤15 KB; hero image ≤60 KB; ≤2 font files totalling ≤60 KB; LCP ≤1.5 s on Fast 4G and ≤2.5 s on Slow 4G; CLS ≤0.05; TBT ≤150 ms |
| Studio (`/e/`) | Initial JS ≤90 KB compressed; ≤15 KB glyph data per extra engraving font, loaded on demand; wood texture ≤40 KB per shape; keystroke to updated preview ≤16 ms; INP ≤200 ms |
| Status (`/o/`) | ≤70 KB JS including the Firestore listener; works after a reload with no local state |
| Hero video | ≤1.5 MB, loaded after the main image, landing page only |
| Repeat visits | 0 KB of app code re-downloaded |
| Accessibility | 0 axe violations; text contrast ≥4.5:1; tap targets ≥44×44 px; 16 px base text, 12 px minimum; TalkBack pass on Android |

---

## 8. Roadmap

### Phase 0: this week (on the current code, no redesign)
Deliverables:
1. All of section 0 (items 1-10).
2. Quick fixes on the live site:
   - Remove the login gate (the `onclick` at index.html:100 and `handleStartCreating`). Ask for the phone only at payment.
   - Show a ghost "YOUR NAME" instead of "INVENGIC" (js/app.js:808, 827, 984).
   - Drop "Sign In" and "Home" from the phone header.
   - Razorpay name "Invengic Studio", theme colour Char.
   - Remove false copy (index.html:256, 276-279, 285-287, 295, 896, 949).
   - Drive the "Online" pill from the age of the `system/printer` heartbeat.
   - Reset the queue number daily (`meta/counter` keyed by date).
   - Remove the broken Notify button and add the status link to the SMS.
3. Performance:
   - Convert the renders to WebP and delete the duplicate file.
   - Add `defer` to scripts, and load Razorpay and Cropper only when needed.
   - Fix the cache headers, and deploy from a dedicated `public/` folder instead of the repo root.
4. Burn and photograph 10 real pieces, and replace the AI renders.
5. Time 10 jobs on the machine with a stopwatch, handling included (5 text across fonts and shapes, 5 photos). These become the wait-time constants.
6. Start WhatsApp Business verification, template approval and SMS DLT registration.

Verify:
- 6 real orders end to end, and each piece matches its design.
- Every check in the private security list passes.
- The laser does not start without Enter.
- The landing page is under 1 MB and loads in under 3 s on a throttled phone.

### Phase 1: 2-3 weeks (the new core)
Deliverables:
- **Engine:** engrave-core with golden tests. Photo image areas per shape, which re-enables photos on circle and heart.
- **App:** SvelteKit app with landing page, studio, proof and pay sheet, confirming state, `/o/` status page and TV board.
- **Backend:**
  - Functions: `createCheckout`, `razorpayWebhook`, `reconcile`, `sweep`, `notify`.
  - The order/job model and per-event tokens.
  - Wait times from job estimates plus measured handling time.
  - `publicStatus`, and locked database rules.
- **Staff side:**
  - Staff console v1: Start gate, Frame, Ready (sends the message), Collected, Mark cash paid, Pause intake, Redo, photo approval.
  - Agent: runs as a service, uses leases, never retries by itself, handles the start point safely.
- **Brand v1:**
  - Tag-i mark and wordmark; palette and type tokens; icon set; OG image.
  - Print files for the standee, table tents and kraft card; the QR set per placement.
- **Other:** analytics and event QRs, legal pages live.

Verify:
- Golden tests pass.
- A full rehearsal event with 20 orders on an Android phone and an iPhone, through 4 scanner in-app browsers. Include:
  - a tab killed after the UPI app opens
  - a failed payment
  - the agent unplugged mid-job
  - the laptop asleep
- Budgets pass in Lighthouse CI.
- On hardware: all 3 shapes burn in position with the new start-point flow.

### Phase 2: after the first event on the new system
- **Orders and pricing:** group orders with sub-tokens and extra-piece pricing; the pouch add-on; seasonal presets.
- **Sharing:** share card, `/k/` share pages, referral codes, review request, opt-in list.
- **Walk-ups:** kiosk mode, and walk-in orders created from the console.
- **Engraving quality:** a dithered "Sketch" photo style, filled text, and a single-line "Pen" font, each only after test pieces on your birch.
- **Hindi:** a Hindi UI toggle, then Hindi engraving after the conjunct test.
- **Scale:** multi-machine routing, the fixture plate and calibration wizard, character-counting streaming.
- **Owner and bulk:** owner dashboard and alerts, the bulk-order funnel, and the back-of-tag hallmark experiment.

Verify:
- The funnel dashboard shows every target against the baseline.
- Redo + refund rate is ≤2%.
- Per-machine wait estimates land within ±20% of actual.

### Must be settled on the hardware, not in code
- Real job times at the new streaming rate.
- Legibility of outline vs filled vs single-line text at 4-8 mm letter height.
- Dithering settings for each batch of wood.
- Limit switches and `$H` homing on your CV-01 Pro.
- Fixture slot accuracy.
- A 10 mm logo burn.
- Scan rate of the wooden QR plaque.
- Burn darkness after the streaming change.

---
Evidence: file:line references point at the live code (the Ayush branch as of e324fa1, 2026-09-26). Critical items in section 0 were re-checked in code during the review: the "KEYCHAIN" default and fixed 100 paise, the payment-replay fallback, the missing Razorpay webhook, public order reads, the 5-second laser auto-start, the fixed 56x27 mm image area, and the hard-coded status text.
