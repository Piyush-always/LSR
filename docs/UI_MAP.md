# UI map & DOM contract

Source: this repo, branch `visual-restructure`, read on 2026-09-26. Line numbers refer to `index.html` (986 lines), `css/style.css` (3815 lines, 88 KB) and `js/app.js` (2599 lines). No files were modified. Claims are labelled **Derived** when they come from reading code and **Assumed** when they are not verified. Unlabelled structural facts were read directly from the files and re-checked while merging the four reader maps.

**Merge notes (corrections to the input maps, verified by reading the files)**
1. **Image drag speed.** The image moves slower than the pointer: about 65% of pointer travel on the rectangle, 72% on the circle and 74% on the heart. It does not move 1.5x faster. Offsets are in processor-canvas px (`image-processor.js:22-23`) and are scaled by `processor.width / stage width` (`app.js:1541-1542`), but the canvas covers only `imageArea.width / viewBoxW` of the stage (56/86, 46/64, 51/69). Derived.
2. **Missing screens.** Only `#screen-welcome` is a hard crash if missing. A missing `#screen-create`, `#screen-payment` or `#screen-success` silently routes to welcome (`app.js:513`).
3. **`firebase.json` hosting config.** `"public": "."` serves the repo root, so anything not in the ignore list is deployed. Review the ignore list before deploying (details were reported to the owner, not kept here).
4. **Caching.** html, js and css are served with `Cache-Control: no-cache, no-store, must-revalidate`. The `?v=` bumps are therefore a secondary safeguard.
5. **Hidden elements.** 20 elements start with `hidden` in the markup. JS writes `.hidden` on 23 elements (full list in 3.1).
6. **Cart "Shape: undefined".** Confirmed: `app.js:2298` reads `shapeObj.title`, but the registry field is `name`.
7. **Editing an image cart item.** JS assigns to the getter-only `imageProcessor.width/height`, which is silently ignored, and never restores `source`. "Update Item" therefore works only if an image is still loaded (Derived).

Legend used in section 3:
- **U**: dereferenced without a null check at load or boot. A missing element throws a TypeError that stops everything after that line in app.js.
- **F**: unguarded, but only on one flow. That flow throws.
- **G**: null-checked. A missing element silently disables only that feature.

---

## 1. Screens and overlays

| Name | Element | How it is shown / hidden | What is inside |
|---|---|---|---|
| Header (always) | `header.app-header` (index.html:20-71) | Always visible, `position:fixed`, 72 px (64 px ≤768). Home and Cart are hidden on welcome and Help is hidden off welcome by `body[data-screen]` CSS (style.css:442-449). Sign In vs profile badge uses `hidden` (app.js:147-159). Cart badge uses `hidden` (2241-2252). | Logo link `#nav-brand`, auth bar, How-it-works button (unwired), cart button + badge, Home button |
| Welcome | `section#screen-welcome.screen.active` (74-327) | `.active` set by `showScreenInternal` (app.js:512-542). Route `#welcome`. Active in the initial markup. | Hero (decor, headline, `#btn-start`, scroll hint, 8 floating samples), testimonial, footer. The footer lives **inside** this screen. |
| Create (configurator) | `section#screen-create.screen` (330-605) | `.active`. Routes `#create #shape #choose #name #image` all map here (app.js:22-31). Inside it, `setDesignMode` toggles `hidden` on the text/image panel pair and preview pair (477-499). | 2-column grid: preview column (text SVG or image stage) + controls (shape cards, mode tabs, text panel or image panel) |
| Payment | `section#screen-payment.screen` (608-625) | `.active`, route `#payment`. Entered by `initiatePayment` (1623). The normal path then does a full-page redirect to a Razorpay payment link (1695-1709); the fallback opens the Razorpay modal (1743). | Spinner, `#payment-title`, `#payment-sub`, 2 fallback buttons |
| Success / tracking | `section#screen-success.screen` (628-773) | `.active`, route `#success`. Also forced by payment-return query params (2136-2177) and localStorage recovery (1901-1932). | Banner + queue number, live queue, 4-step timeline, verify banner, notify button, order info card, "Create Another" |
| Auth (phone OTP) modal | `div#auth-modal.phone-modal[hidden]` (817-878) | `hidden`: `openAuthModal` (161-176) / `closeAuthModal` (180). Closes on ×, on backdrop click, and on success. Steps switch via `hidden` (185-201). Opened from header Sign In, `#btn-start`, Create Another and cart Checkout (while the drawer is open). | Step 1 name + phone + Send; step 2 OTP + Verify + Change + Resend |
| How-it-works modal | `div#help-modal.phone-modal[hidden]` (881-919) | **Never shown.** No JS opens or closes it. `#btn-help-start` calls the undefined `closeHelpModal()`. | 3 step cards + Start button |
| Camera modal | `div#camera-modal[hidden]` (776-792) | `hidden=false` only after `getUserMedia` succeeds (1130-1152). `stopCamera` (1154) hides it on Cancel, ×, backdrop click, or a click on the modal root. | Live `<video>`, Capture / Cancel. `#camera-canvas` (793) sits outside the modal. |
| Crop modal | `div#crop-modal[hidden]` (796-811) | `hidden=false` + class `crop-shape-{id}` in `openCropEditor` (1167-1216). Closes on `#crop-close`, a click on the root itself (1234-1244), or confirm. | Cropper.js on `#crop-image`, rotate L/R, "Use Image" |
| Cart overlay | `div#cart-overlay[hidden]` (925) | `hidden=false` + `.active` in the same tick (2218-2228). Close removes `.active`, then sets `hidden` after 350 ms (2230-2239). Click closes. | Dim layer |
| Cart drawer | `aside#cart-drawer[hidden]` (926-961) | Same as overlay. Slides by `transform` on `.active`. | Header + count, limit banner, generated items, subtotal, Checkout, Continue |
| Toasts | `div#toast-container` (922) | Container always present. `showToast` appends `div.toast.toast-{type}` and removes it at 4000 ms (2200-2215). | Icon span + message span |
| Emoji panel (inline) | `div#emoji-panel[hidden]` (499) | `hidden` flipped by `#emoji-toggle`, which also flips `aria-expanded` (881-885) | 8 generated categories × 8 buttons |
| Debug panel | `#dbg-btn`, `#dbg-panel` (injected by debug-panel.js) | Only with `?debug=1` (remembered in localStorage `laserDebug`; `?debug=0` clears it) and the global `db`. Panel shows via `.open`. | Now printing / queue / agent log / backend probe |
| Third-party layers | Razorpay page / modal, reCAPTCHA badge (in `#recaptcha-container`, 814), native `confirm()` / `alert()` | Not styleable from style.css. Razorpay theme `'#00e5ff'` and name `'Laser Keychain'` are set in JS (1746, 1756). | n/a |

---

## 2. Components inventory (grouped by screen)

### Global chrome (header)
- **Brand link**: `a.brand-logo#nav-brand[href="#"]` > `img.brand-full-logo-img` (`assets/logo.png?v=20260916_v4`; 56 px, 44 px ≤768; `mix-blend-mode:multiply` because the PNG has no alpha). No JS. `href="#"` makes a fragment navigation, which fires popstate and shows welcome **without** the Home discard-confirm or state reset (Derived; verify in a browser).
- **Auth bar** `#user-auth-bar`:
  - `button.header-auth-btn#btn-header-auth` (person svg + `span#auth-btn-label` "Sign In") opens the auth modal.
  - `div.user-profile-badge#user-profile-badge[hidden]` holds `span.user-phone-tag#user-phone-tag`. JS writes "[person emoji] {name}" or "[phone emoji] +91 {phone}" into it.
  - `button.user-logout-btn#btn-logout` logs out and shows the toast "Logged out successfully" (type `info`).
- **How It Works**: `button.header-help-btn#btn-header-help` (svg + span, which is hidden ≤768). **No listener.** Shown only on welcome.
- **Cart**: `button.cart-nav-btn#cart-btn` (svg + "Cart" + `span.cart-badge#cart-badge[hidden]`) opens the drawer. The badge holds the total quantity and is hidden at 0 (`badgePop` animation). Hidden on welcome.
- **Home**: `button.home-btn#home-btn` (svg + "Home"). It confirms if on success with an active order, or if text or an image is entered. It then resets text, image and shape (back to rectangle) and routes to welcome. Hidden on welcome.

### Welcome (`#screen-welcome`)
- **Decor**: `.canvas-grid-bg[aria-hidden]` > `.canvas-ruler-h`, `.canvas-ruler-v`; `.hero-canvas::before` glow; `body::before` mesh + 40 px grid (style.css:60-74). No JS.
- **Editorial block**: `.welcome-container` > `.welcome-label` (`.welcome-label-dot` + text), `h1.welcome-title` ("MAKE IT" / `span.title-accent` "YOURS."), `p.welcome-sub`. No JS.
- **CTA**: `.welcome-actions` > `button.btn.btn-primary#btn-start[onclick="handleStartCreating()"]` + `svg.btn-arrow`. Two handlers fire:
  - The inline handler opens auth (with callback `showScreen('create')`) when logged out.
  - The listener at app.js:601 always calls `showScreen('create')`.
  - Net effect when logged out: the create screen opens with the auth modal on top (Derived).
- **Scroll hint**: `a.hero-scroll-hint[href="#testimonial-section"]` with inline `scrollIntoView(...); return false;`. The `return false` stops the hash router.
- **Floating samples**: `.hero-samples-composition` holds 8 × `div.hero-sample-item.sample-pos-{tl,tr,bl,br,ml,mr,tl-bg,br-bg}.depth-{foreground,midground,background}[data-shape][role=button][tabindex=0][title]`. Each contains `.sample-image-wrap` > `img.sample-png.sample-wood` + `.sample-glow`, then `.sample-badge`. Shapes in order: rectangle, circle, heart, rectangle, heart, circle, circle, heart.
  - JS: window mousemove (welcome only) writes `--px/--py` with speed 35/20/10 by depth class. Hover dims the others with `.sample-dimmed`. Click or Enter/Space runs `selectShape(data-shape)` then `showScreen('create')`, with **no auth gate**.
  - CSS: ≤1439 hides the `-bg` items. ≤899 becomes a 4-column grid (2-column ≤599) and hides ml, mr and `-bg`.
- **Testimonial**: `section.testimonial-section#testimonial-section` > `.testimonial-container` > `.testimonial-ambient-glow` + `.testimonial-card`, containing:
  - quote marks `.testimonial-quote-mark.quote-mark-open/.quote-mark-close`
  - `.testimonial-rating` with 5 × `span.star-icon`
  - `blockquote.testimonial-quote` with `span.testimonial-accent` × 2 and `br.desktop-br`
  - `.testimonial-author` (`svg.author-avatar-icon` defining `#avatar-grad`; `.author-name`, `.author-brand`)
  - JS: an IntersectionObserver adds `.in-view` once. It changes nothing visible today.
- **Footer** `footer.app-footer#app-footer` > `.footer-container` > `.footer-grid`:
  - `.footer-brand-col`: `a.brand-logo.footer-logo[href="#"]` (logo inverted by CSS), `p.footer-desc`, and `.footer-status-pill` with `.status-dot-pulse` and the static text "Live Laser Engine: Online".
  - 3 × `.footer-links-col` with `h4.footer-col-title`:
    - `ul.footer-links` with `a.footer-link-shape[data-shape]` × 3
    - `ul.footer-links` with `a.footer-link-mode[data-mode]` × 3 (text, image, text)
    - `.footer-trust-badges` with `.trust-badge-item` × 3
  - `.footer-bottom` with `.footer-bottom-meta` and `.meta-dot`.
  - JS: shape links run preventDefault → selectShape → create → smooth scroll. Mode links run create → `#type-image.click()` or `#type-name.click()`. No auth gate.

### Create (`#screen-create`)
- **Layout**: `div.container.create-container` (max 1080) > `div.configurator-grid` (1 column; `1.18fr 1fr` at ≥900). It holds `div.preview-column` (sticky top 88 px; static ≤899) and `div.controls-column` (white card).
- **Text preview**: `div.preview-box.view-product#keychain-preview-box[data-material="wood"]` > `.preview-top-bar` > `span.preview-badge` "PREVIEW"; then `div.keychain-preview#keychain-preview` (max 400 px) > `svg.keychain-svg#keychain-svg[viewBox="-7 -7 86 49"]`, followed by `p.preview-hint` "Actual size · 72 × 35 mm".
  - The static SVG contents (the rectangle twin) are: 6 dimension `<line>`s, 2 label `<text>`s, the outline `<rect x=2 y=2 w=68 h=31 rx=4>`, the hole `<circle cx=8 cy=17.5 r=2.5>`, and `<text id="keychain-text">INVENGIC</text>`.
  - On every shape change, JS rebuilds the SVG and rewrites the hint. The text supports drag-to-position (`.dragging`).
- **Image preview**: `div#img-preview-box.preview-box.view-product[data-material="wood"][hidden]` > `.preview-top-bar` ("IMAGE PREVIEW"); then `div.img-keychain#img-keychain`, which contains:
  - `canvas.img-canvas#img-canvas`
  - `svg.img-overlay[viewBox="0 0 72 35"][preserveAspectRatio=none]`
  - `label.img-dropzone#img-dropzone[for=img-file]` (upload svg, `.img-dropzone-title`, `.img-dropzone-hint`)

  followed by `p.preview-hint#img-adjust-hint`. States: `.has-image` and `.dragging`. Supports pointer drag and wheel zoom.
- **Shape picker**: `.create-section` > `label.create-section-label` (`span.step-num` "①") + `div.shape-grid#shape-grid` > 3 × `button.shape-card[type=button][data-shape-id]` (`.shape-card-icon` svg, `.shape-card-title`, `.shape-card-desc`). Rectangle starts `.selected`.
- **Mode tabs**: `.create-section` > label "②" + `.mode-segmented-control` > `button.mode-tab.active#type-name[data-mode=text]` and `button.mode-tab#type-image[data-mode=image]`, each with svg + `.mode-tab-text` (`.mode-tab-title`, `.mode-tab-sub`).
- **Text panel** `div#mode-panel-text.mode-panel`:
  - `.input-group`:
    - `.input-label-row`: `label[for=name-input]` + `button.btn-center-text#btn-center-text`
    - `input#name-input[type=text]` (no maxlength)
    - `.input-sub-row`: `span.drag-text-hint`, `span.char-count` > `span#char-current` + "/20"
  - `.emoji-section`: `button.emoji-toggle#emoji-toggle[aria-expanded=false]` (`.emoji-toggle-icon`, `.emoji-toggle-label`) + `div.emoji-panel#emoji-panel[hidden]` (generated)
  - `.font-picker`: `label.font-picker-label` + `div.font-chips#font-chips` (generated)
  - `.price-tag` (static ₹1)
  - `.configurator-actions`:
    - `button.btn.btn-secondary.btn-add-cart#btn-add-cart-text[disabled]`
    - `button.btn.btn-primary#btn-pay[disabled]` "Buy Now" + arrow. It only adds to the cart and opens the drawer; it does not start payment.
- **Image panel** `div#mode-panel-image.mode-panel[hidden]`:
  - `input#img-file[type=file][accept=image/png,image/jpeg,image/webp][hidden]`
  - `.image-action-row`: `button#camera-open` "Take Photo", `button#remove-image[hidden]` "Remove"
  - `p.img-error#img-error[hidden]`
  - `div.img-controls#img-controls[hidden]`, with these rows:
    - `.control-row` + `.mode-chips-row`: `button.mode-chip.active#chip-mode-auto`, `#chip-mode-logo`, `#chip-mode-photo`
    - zoom `input#img-zoom[range 0.5..2.5 step .05]` + `span#zoom-value`
    - threshold `input#img-threshold[range 1..254]` + `span#threshold-value`
    - `.control-row.control-row-inline`: `input#img-invert[checkbox]`
    - `button.btn.btn-secondary.btn-sm#btn-reset-img-adjust` (inline styles)
    - `p.img-coverage#img-coverage[hidden]`
  - `.price-tag`
  - `.configurator-actions` with `#btn-add-cart-image[disabled]` and `#btn-pay-image[disabled]`
- **Legacy**: `button#btn-shape-continue[style=display:none]`. Its lookup is guarded, so it can be removed.

### Payment (`#screen-payment`)
- `div.container` > `.loader-ring`, `h2.section-title#payment-title`, `p.payment-sub#payment-sub`, then an inline-styled flex column with:
  - `button.btn.btn-secondary#btn-reopen-modal`, which re-runs `initiatePayment`
  - `button.btn.btn-primary#btn-open-direct-link`, which saves its textContent, shows "Generating Direct Page Link...", then restores the text as plain text
- `.section-title` and `.payment-sub` have no CSS.

### Success (`#screen-success`)
- **Banner** `.success-dashboard-wrapper` > `.success-banner-card`:
  - `.banner-left` (`.success-icon-ring` > `svg.checkmark-svg` with `.checkmark-circle`, `.checkmark-tick`; `.banner-headings` > `h2.success-title`, `p.success-sub`)
  - `.banner-right` > `.queue-badge-box` (`.queue-badge-title`, `div.queue-position-val#queue-number` "#…")
- **Tracker card** `.success-dashboard-grid` > `.dashboard-card.tracker-card`:
  - `.card-header-bar` (h3, `.live-status-pill` > `.pulse-dot`)
  - `div.live-queue#live-queue` > `.live-queue-row` > `span.live-queue-text#live-queue-text` ("… `strong#now-printing` #14"), then `p.live-queue-sub#live-queue-sub` ("Keychain `span#success-for` for `strong#success-name` is in line.")
  - `div.order-progress#order-progress`: 4 × `div.progress-step` (`#step-payment.completed`, `#step-queue.active` whose icon is an empty `span.spinner`, `#step-printing`, `#step-done`), each with `.progress-icon` and `.progress-content` (`.progress-title`, `.progress-sub`), separated by 3 × `.progress-line`
  - `div.verify-banner#verify-banner[hidden]`
  - `.tracker-action-row` > `button.btn-notify#btn-notify` > `<span>` label
- **Info card** `.dashboard-card.info-card`:
  - `.card-header-bar` (h3, `span.info-badge`)
  - `.info-preview-box` (`.info-wood-chip`, `h4.info-item-title`, `p.success-footer-text#success-footer-text`)
  - `.info-details-table` with 4 × `.info-row` (`.info-label` / `.info-val`, `.highlight-badge`, `.status-green`). All static, including "~3 to 6 Minutes" and "Verified & Paid".
  - `.studio-pickup-note` (`.note-icon`, `.note-content`)
  - `button.btn.btn-secondary.btn-block` "Create Another", with inline style and an inline onclick
- No CSS for: `.verify-banner`, `.tracker-action-row`, `.btn-notify`, `.enabled`, `.your-turn`, `.spinner`, `.progress-content`, `.banner-right`, `.info-card`, `.note-icon`, `.note-content`, `.btn-block`.

### Global overlays
- **Auth modal**: `.phone-modal` > `.phone-modal-backdrop#auth-modal-backdrop` + `.phone-modal-box.auth-modal-box` containing:
  - `.phone-modal-header` (`.phone-modal-icon`, `h3#auth-modal-title`, `p.phone-modal-sub#auth-modal-sub`, `button.phone-modal-close-btn#auth-modal-close`)
  - `.phone-modal-body` (no CSS), holding two steps:
    - `#auth-step-phone.auth-step-panel`: `.phone-input-group#auth-name-group` (`label.phone-label`, `.phone-input-wrapper` > `span.country-code` + `input.phone-field#auth-name-input[maxlength=50][autocomplete=name]`) and `.phone-input-group#auth-phone-group` (`span.country-code` "+91" + `input.phone-field#auth-phone-input[type=tel][maxlength=10][pattern="[6-9][0-9]{9}"][autocomplete=tel]`, `span.phone-hint#auth-phone-hint`), then `button.btn.btn-primary.btn-block#btn-send-otp` (span + arrow)
    - `#auth-step-otp.auth-step-panel[hidden]`: `.otp-sent-info` (`strong#auth-otp-target`, `button.btn-change-phone#btn-change-phone`), `.phone-input-group#auth-otp-group` (`input.phone-field.otp-field#auth-otp-input[maxlength=6][pattern="[0-9]{6}"][autocomplete=one-time-code]`, not inside a `.phone-input-wrapper`; `span.phone-hint#auth-otp-hint`), `button#btn-verify-otp` (span), `.resend-otp-row` > `button.btn-resend-otp#btn-resend-otp`
  - The hints are the only inline error surface and receive long Firebase error strings.
- **Help modal**: same shell + `.help-modal-box`, `.help-modal-body` > `.help-steps-list` > 3 × `.help-step-card` (`.help-step-num`, `.help-step-content` h4/p). Also `button#btn-help-start[onclick="closeHelpModal(); handleStartCreating();"]`, which throws a ReferenceError. The copy mentions Oval and Shield shapes, which do not exist.
- **Camera**: `.camera-modal` > `.camera-backdrop#camera-backdrop` + `.camera-box` containing:
  - `.camera-header` (h3, `button.camera-close-btn#camera-close-x`)
  - `.camera-container` > `video#camera-video[autoplay][playsinline][muted]`
  - `.camera-actions` (`#camera-capture` primary, `#camera-cancel` secondary)

  `canvas#camera-canvas[hidden]` sits outside the modal. Only `.camera-box` has an entrance animation (`modalPop`).
- **Crop**: `.crop-modal` (it is its own backdrop) > `.crop-box` containing:
  - `.crop-header` (h3, `button.crop-close-btn#crop-close`, no type and no aria-label)
  - `.crop-container` (max-height 340 px) > `img#crop-image`
  - `.crop-actions` (`#rotate-left`, `#rotate-right`, `#crop-confirm`)
- **reCAPTCHA**: `div#recaptcha-container` (814), used as an invisible verifier on the first OTP send.
- **Toasts**: `#toast-container[aria-live=polite]`, bottom-right 24 px (full width, bottom 16 px ≤600). Types used: success, info (no CSS), warning, error.
- **Cart drawer shell**:
  - `.cart-header` (`.cart-title-wrap` > `span.cart-icon`, h3, `span.cart-header-count#cart-drawer-count`; `button.cart-close-btn#cart-close-btn`)
  - `div.cart-limit-banner#cart-limit-banner[hidden]`
  - `div.cart-body#cart-items-container`
  - `div.cart-footer#cart-footer`: `.cart-subtotal-row` (`span#cart-total-qty`, `.cart-subtotal-price` > `span#cart-subtotal-amount`), `p.cart-shipping-note`, `button.btn.btn-primary.btn-block#cart-checkout-btn` ("Checkout Now · ₹" + `span#cart-checkout-amount` + arrow), `button.cart-continue-link#cart-continue-btn`
- **Cart items** (generated by `renderCartDrawer`, 2261-2397):
  - Empty state: `.cart-empty-state` > `.cart-empty-icon`, h4, p, `button.btn.btn-primary[onclick="closeCartDrawer(); showScreen('create');"]`
  - Item: `div.cart-item-card[data-id]` > `.cart-item-thumb-wrap`, holding either `img.cart-item-thumb` or an inline `svg.cart-item-thumb[viewBox="0 0 72 35"]`. The svg is always a rectangle with stroke `#6366f1`, text fill `#0f172a`, bold, first 7 characters.
  - Then `.cart-item-info` > `.cart-item-top` (`.cart-item-title`, `.cart-item-details` with "Shape: undefined" (bug), "Font: …", `.cart-item-badge`; `.cart-item-price`) and `.cart-item-bottom` (`.cart-qty-control` > `button.cart-qty-btn.btn-qty-minus[data-id]`, `span.cart-qty-num`, `button.cart-qty-btn.btn-qty-plus[data-id]` (disabled at ≥20); `.cart-item-actions` > `button.cart-action-btn.btn-edit-item[data-id]`, `button.cart-action-btn.btn-remove.btn-remove-item[data-id]`).
  - `item.name` is injected unescaped.
- **Debug panel** (`?debug=1`): `button#dbg-btn` (`.dot.on/.warn/.off`), `div#dbg-panel(.open)` > `.hd` (b, `button#dbg-x`) + `.body#dbg-body`. The generic inner classes are `.sec .sec-h .status .dot .muted .row .pos .pill(.img) .now .err .log .ev .t .empty .bar>i`. Its own `<style>` is scoped by id, at z-index 99999.

---

## 3. DOM contract: MUST PRESERVE

### 3.1 Global, routing, loading

| Selector / attribute | Used in (file:line) | Purpose | What breaks if changed |
|---|---|---|---|
| `[hidden]{display:none !important}` | style.css:8-10; `.hidden` written on `#btn-header-auth #user-profile-badge #auth-modal #auth-step-phone #auth-step-otp #mode-panel-text #mode-panel-image #keychain-preview-box #img-preview-box #emoji-panel #camera-modal #crop-modal #img-error #img-controls #img-coverage #remove-image #live-queue #verify-banner #success-for #cart-drawer #cart-overlay #cart-badge #cart-limit-banner` | The only show/hide mechanism for panels, modals, drawer and badges. 20 elements start hidden in the markup (37, 59, 366, 499, 534, 535, 539, 542, 544, 571, 718, 776, 793, 796, 817, 855, 881, 925, 926, 936). | If it is dropped, loses specificity, or a component rule uses `display:… !important`, these class rules take over and every modal, panel, drawer and badge shows at load: `.phone-modal`, `.camera-modal`, `.crop-modal`, `.cart-drawer`, `.mode-panel`, `.user-profile-badge`, `.img-controls` and others |
| `.screen` / `.screen.active` | index.html:74, 330, 608, 628; app.js:514-517; style.css:452-465 | Screen visibility (`display:none !important` / `display:flex !important`) | Keying visibility on anything else means screens stack or never show |
| `#screen-welcome` | app.js:20-21, fallback 513 | Welcome and the fallback route | **U**: TypeError on routing |
| `#screen-create`, `#screen-payment`, `#screen-success` | app.js:19, 28-29 | Route targets | If missing, those routes silently show welcome |
| `body[data-screen]` | index.html:17; written app.js:518; read 585, 635, 1892, 2086; style.css:442-449 | Route name (`welcome create shape choose name image payment success`); header button visibility; parallax gate; leave-confirm on success | If removed, Home and Cart show on welcome, Help shows everywhere, the parallax stops, and the success leave-guards fail. The create screen can report `create`, `name`, `image`, `shape` or `choose`, so key create CSS on `#screen-create.active` |
| URL hashes `#welcome #create #shape #choose #name #image #payment #success` | app.js:502-509, 563-573, 2580-2588 | Back button and deep links | Any `<a href="#anything">` click fires popstate. The router then shows welcome and resets scroll (Derived; verify in a browser). Every in-page anchor needs `preventDefault` or `return false` |
| Query params `payment`, `razorpay_payment_id`, `payment_id`, `razorpay_payment_link_id`, `razorpay_payment_link_status` (+ `firestoreId`, `razorpay_signature`); `m`/`machineId`; `debug` | app.js:2136-2177, 1614; debug-panel.js:15-18 | Payment return goes to success; machine id; debug | Not a markup contract. Note that testing with payment params calls the real verify endpoint |
| localStorage `invengic_user_phone`, `invengic_user_name`, `invengic_cart_v1`, `pending_order_payload`, `pendingVerify`, `activeOrder`, `laserDebug` | app.js, cart.js:7, debug-panel.js | Persisted login, cart, order recovery, debug | Renaming loses user state |
| Script order, all classic, end of `<body>` | index.html:964-984 | Firebase SDKs → firebase-config.js (global `db functions storage auth`) → Razorpay → keychain-layout.js → image-processor.js → Cropper → cart.js → app.js → debug-panel.js | `app.js:17` `new window.KeychainImageProcessor()` throws if the processor is missing or late. A module, or `defer` on only some scripts, breaks globals and inline handlers |
| Globals `window.showScreen`, `window.handleStartCreating`, global function `closeCartDrawer` | app.js:510, 2546, 2230; used by index.html:100, 767 and generated markup 2286 | Inline onclick targets | Renaming or wrapping these breaks the Start, Create Another and empty-cart buttons |
| Inline handlers | index.html:100 (`#btn-start`), 108 (scroll hint + `return false`), 767 (Create Another), 914 (help, broken) | See rows above | Removing the one at 100 drops the login prompt. Removing `return false` at 108 makes the router snap back to welcome |
| Engraving fonts in the Google Fonts URL | index.html:11-13 | Bebas Neue, Montserrat 700, Noto Emoji, Pacifico, Permanent Marker, Press Start 2P drive the SVG preview, font chips and `getBBox` fit | The preview renders in fallback fonts and auto-fit sizes against the wrong metrics. Only Inter is UI-only |
| `cropper.min.css` 1.6.2 | index.html:14 | Cropper UI and the `.cropper-view-box` / `.cropper-face` targets | The crop editor renders broken |
| `#recaptcha-container` | index.html:814; app.js:225-246 (string id) | Invisible reCAPTCHA host | **F**: OTP send fails. Keep it in the DOM and do not `display:none` it (Assumed risk) |

### 3.2 Header

| Selector / attribute | Used in | Purpose | What breaks |
|---|---|---|---|
| `#home-btn` | app.js:40, 584-598 | Confirm + reset + welcome | **U**: missing stops app.js from line 584 (no Start, shapes, fonts, cart or boot) |
| `#btn-header-auth` | app.js:98, 151, 156, 395 | Sign In; `hidden` when logged in | G: no header login |
| `#user-profile-badge` | app.js:99, 152, 157 | Logged-in wrapper; `hidden` when logged out | G |
| `#user-phone-tag` | app.js:100, 153-154 | JS-owned text (emoji + name/phone) | G. Inner markup is overwritten. Removing the emoji is a JS string change |
| `#btn-logout` | app.js:101, 396 | Logout | G |
| `#cart-btn` | app.js:61, 2517 | Opens the drawer | G |
| `#cart-badge` | app.js:62, 2241-2252 | textContent = count; `hidden` at 0 | G. Must be its own element; never put the "Cart" label inside it |
| `.home-btn`, `.cart-nav-btn`, `.header-help-btn` | style.css:442-449 | `body[data-screen]` visibility rules | CSS-only. Keep or re-create the rule: Home and Cart hidden on welcome, Help only on welcome |

### 3.3 Welcome

| Selector / attribute | Used in | Purpose | What breaks |
|---|---|---|---|
| `#btn-start` + inline `onclick="handleStartCreating()"` | index.html:100; app.js:33, 601-603, 2546-2554 | Start creating | **U** (601). Removing the inline handler silently drops the login prompt |
| `#hero-canvas` | app.js:626-629 | Gates all hero-sample JS | G: samples stop being clickable |
| `.hero-sample-item` (static at load) | app.js:627, 650-701 | Clickable samples → selectShape + create | Samples rendered later get no listeners |
| `[data-shape]` on samples (`rectangle` / `circle` / `heart`) | app.js:687 | Shape to preselect | Bad value: selectShape is a no-op, navigation still happens |
| `role="button"` + `tabindex="0"` | index.html:121-199; app.js:695-700 | Keyboard Enter/Space | Keyboard access lost |
| `.depth-foreground` / `.depth-midground` / `.depth-background` | app.js:654-656 | Parallax speed 35/20/10 | Only the parallax (harmless if dropped) |
| inline `--px` / `--py` | app.js:661-662; style.css:936-1060 | Parallax offsets | Harmless if the new CSS ignores them |
| `.sample-dimmed` | app.js:677, 682; style.css:~905-933 | Hover state | Free styling hook |
| `.hero-scroll-hint` + `return false` | index.html:108 | Smooth scroll to the testimonial | See 3.1 |
| `#testimonial-section` + `.in-view` | index.html:108, 213; app.js:2179-2197 | Scroll target + reveal hook | G. A hidden base state needs `.in-view` to undo it and a reduced-motion override |
| `.footer-link-shape[data-shape]` (static) | app.js:704-713 | Shape shortcut → create | Class or value change: link dead or no preselect |
| `.footer-link-mode[data-mode]` (`text` / `image`) | app.js:714-724 | Mode shortcut → create | Same |
| `.footer-logo[href="#"]`, `#nav-brand[href="#"]` | index.html:21, 270 | Implicit home via popstate | Changing `href` changes navigation behaviour |
| `#avatar-grad` | index.html:245-251 | SVG gradient id | Must stay unique in the document |

### 3.4 Create: previews

| Selector / attribute | Used in | Purpose | What breaks |
|---|---|---|---|
| `#keychain-preview-box` | app.js:486, 491, 768, 789, 926 | Text preview card; `hidden` by mode | G: no preview toggling or hint |
| `#img-preview-box` | app.js:487, 492, 769, 790, 949 | Image preview card; `hidden` by mode | G |
| `.preview-box` + `.view-product` + `[data-material="wood"]` | index.html:336, 366; style.css:1646-1693, 2772-2793 | `.view-product` hides the dimension lines and labels (1689-1693). Wood sets blank fill `#fcf8f2`, outline `#1e293b`, ink `#0f172a` | Removing `view-product` shows the mm dimension lines. Removing `data-material` changes the preview colours |
| First `.preview-hint` inside each preview box | app.js:926, 949 | JS writes "Actual size · X × Y" / "Engraves inside marked area · X × Y" | The hint stops updating if moved out of the box. Content is JS-owned |
| `#keychain-svg` | app.js:906-921, 1033, 1045 | `viewBox` + `innerHTML` rebuilt on every shape change; `getScreenCTM` for drag | G. Anything placed inside it is wiped on the first shape change |
| `#keychain-text` | app.js:981-1028, 1032-1093; style.css:1577-1595, 2785-2788 | Engraving text; JS sets text, `font-family`, `font-size`, `x`, `y`, `text-anchor`, `dominant-baseline`; `.dragging` | CSS typography on it or its ancestors changes preview size and fit (see section 5) |
| Static SVG twin | index.html:342-361 | What users see until the first shape selection | Must stay geometrically identical to `KEYCHAIN_SHAPES.rectangle` |
| `#img-keychain` + `.has-image` + `.dragging` + inline `aspect-ratio` | app.js:431, 935, 1319, 1490, 1511-1574, 2442; style.css:2111-2130 | Image stage; pointer drag and wheel zoom target | **U** (boot 1490). See section 4 for geometry |
| `#img-canvas` + inline `left/top/width/height` % | app.js:433, 1278-1305 | Display copy of the print bitmap | **U** (boot 1291) |
| `.img-overlay` (first match in the document) | app.js:938-946 | `viewBox` + `innerHTML` rebuilt | Must be unique. A second `.img-overlay` earlier in the DOM would receive the geometry |
| `#img-dropzone` (label `for=img-file`) | app.js:434, 1349; style.css:2183-2208 | Upload activator; hidden under `.has-image` | **U** |

### 3.5 Create: controls

| Selector / attribute | Used in | Purpose | What breaks |
|---|---|---|---|
| `.shape-card[data-shape-id]` + `.selected` (static) | app.js:34, 579, 608-610, 728-732, 2409-2410 | Shape select; `editCartItem` clicks `querySelector('.shape-card[data-shape-id="…"]')` | Values must be `rectangle` / `circle` / `heart`. The first match per id must be the configurator card. Must remain clickable. Exactly one card (rectangle) selected at start |
| `.shape-pill[data-shape-id]` | app.js:611-613, 736-740 | Supported alternative hook; no markup today | Optional, for new shape chips with no JS change (static markup only) |
| `#type-name`, `#type-image` + `.active` | app.js:36-37, 481-482, 719-720, 749-759, 2414, 2429 | Mode switch; also clicked programmatically | G. Must remain clickable elements |
| `#mode-panel-text`, `#mode-panel-image` | app.js:484-490 | Mode panels via `hidden` | G. Each panel must keep its own price + action buttons, or both pairs show |
| `#name-input` | app.js:42, 887-896, 983, 1106-1127, 2416-2419, 2469 | Text input; 20 code-point cap in JS | **U**. Must stay a text input. Do **not** add `maxlength`: it counts UTF-16 units, so emoji would hit the cap early (Derived) |
| `#char-current` | app.js:43, 1102-1104 | Count text; "/20" is static and must match `MAX_CODEPOINTS` (5) | **U** (boot) |
| `#btn-center-text` | app.js:1096-1099 | Reset text position | G |
| `#emoji-toggle[aria-expanded]` | app.js:55, 881-885 | Disclosure toggle | **U**. The initial `aria-expanded="false"` is required |
| `#emoji-panel` | app.js:56, 856-879 | Generated content | **U** (boot 857). Collapse only via `[hidden]` |
| `#font-chips` | app.js:45, 805-842 | Generated font chips | G |
| `#btn-add-cart-text`, `#btn-add-cart-image` + `disabled` | app.js:74-75, 1011-1012, 1115-1116, 1122-1123, 1332-1333, 1506-1507, 2254-2259, 2556-2561 | Add or update; `innerHTML` overwritten with "[cart emoji] Add to Cart" / "[check] Update Item" | G. Inner icons are destroyed after the first add; use `::before` or change the JS strings |
| `#btn-pay`, `#btn-pay-image` + `disabled` | app.js:38-39, 1011, 1115, 1121, 1332, 1506, 1597-1605, 1795-1798 | "Buy Now" (adds to cart + opens drawer) | **U**. Inner markup is safe (never rewritten) |
| `#img-file` (`type=file`, `hidden`) | app.js:435, 1349, 1387-1396, 1502 | Picker; `change` opens crop | **U**. Must stay `type=file` |
| `#camera-open` | app.js:448, 1355-1359 | Opens the camera | G |
| `#remove-image` | app.js:449, 1320, 1479-1481, 1504, 2443 | Reset image; `hidden` toggled | **U** |
| `#img-error`, `#img-coverage` | app.js:436, 442, 1308-1313, 1338-1347, 1493-1494 | JS-owned messages; `hidden` | **U** (boot) |
| `#img-controls` | app.js:437, 1322, 1492, 2444 | Adjust group; `hidden` | **U** (boot). Wrapping its rows in a `<details>` is fine |
| `#chip-mode-auto/-logo/-photo` + `.active` | app.js:1438-1451 | Graphic type | G |
| `#img-zoom` (min 0.5, max 2.5, step 0.05), `#zoom-value` | app.js:443-444, 1328-1329, 1459-1467, 1570-1571 | Zoom; wheel writes back to the slider | G. Keep the range: wheel zoom clamps to 0.5-2.5 |
| `#img-threshold` (1-254), `#threshold-value` | app.js:438-439, 1324-1325, 1426-1436, 1496-1497 | Threshold | **U** |
| `#img-invert` (checkbox) | app.js:440, 1326, 1453-1457, 1498 | Invert | **U**. A custom switch must keep the real checkbox |
| `#btn-reset-img-adjust` | app.js:445, 1469-1477 | Reset zoom and offset | G. Inline styles can move to a class |
| `#btn-shape-continue` | app.js:35, 742-746 | Legacy | G. Removable |

### 3.6 Payment and success

| Selector / attribute | Used in | Purpose | What breaks |
|---|---|---|---|
| `#payment-title`, `#payment-sub` | app.js:57-58, 1607-1610 | JS-owned status text | **F** (payment flow) |
| `#btn-reopen-modal` | app.js:2096-2103 | Retry payment | G |
| `#btn-open-direct-link` | app.js:2097, 2105-2133 | Direct link; textContent saved and restored | G. Child svg/span are flattened to text after one click |
| `#queue-number` | app.js:46, 1828, 1886, 1907, 1924 | "#…" then "#N" | **F** |
| `#live-queue` + `.your-turn` | app.js:49, 1939, 1949-1980 | Live panel; `.your-turn` has no CSS today (free hook) | **U**: `stopLiveQueueListener` touches it on **every** non-success route change, including boot |
| `#now-printing` | app.js:52, 1945, 1954 | "#N" / "queue is idle"; the static "#14" stays if Firestore is unavailable | **F** (snapshot callback) |
| `#live-queue-sub` | app.js:51, 1946-1975 | textContent overwritten per snapshot | **F**. The write deletes the nested `#success-for` / `#success-name` (existing bug) |
| `#success-for`, `#success-name` | app.js:47-48, 1838-1845 | "for NAME" (hidden for image orders) | **F**. Currently nested in `#live-queue-sub`. Moving them out changes behaviour (flag it) |
| `#step-payment`, `#step-queue`, `#step-printing`, `#step-done` + `.completed` / `.active` | app.js:461-464, 1983-2024 | Timeline state | **F**. Scope selectors (`.progress-step.active`) because `.active` is used by several components |
| `#verify-banner` | app.js:53, 1829, 1889-1896 | JS text + `hidden` | **F** |
| `#btn-notify` + **first** `<span>` + `.enabled` + `disabled` | app.js:41, 2046-2066 | Notification opt-in; `querySelector('span')` gets the label | **U**. An icon span placed first would receive the label text |
| `#success-footer-text` | app.js:54, 2036 | "Ready for pickup [sparkle emoji]" | **F** |
| "Create Another" inline onclick | index.html:767 | `handleStartCreating()` or `showScreen('create')` | Keep it, or move it to JS deliberately. Its inline style uses `var(--radius-md)` |

### 3.7 Overlays

| Selector / attribute | Used in | Purpose | What breaks |
|---|---|---|---|
| `#auth-modal` | app.js:103, 161-176, 180-183 | Modal root; `hidden` | G: login impossible |
| `#auth-modal-close`, `#auth-modal-backdrop` | app.js:104-105, 397-398 | Close | G |
| `#auth-step-phone`, `#auth-step-otp` | app.js:107-108, 185-201 | Steps via `hidden` | G |
| `#auth-name-input`, `#auth-phone-input`, `#auth-otp-input` | app.js:109-110, 114, 166-175, 196-199, 404-429 | Inputs; Enter-key chain; values read with non-digits stripped | G. Keep `maxlength`, `pattern` and `autocomplete` (`one-time-code` enables SMS autofill). Adding `inputmode="numeric"` is safe |
| `#auth-phone-hint`, `#auth-otp-hint` | app.js:111, 115, 189, 195 + error paths | Only inline error surface (long strings) | G. Give them room for multi-line text |
| `#btn-send-otp`, `#btn-verify-otp` | app.js:112, 116, 272-315, 333-378, 399-400 | innerHTML saved, set to text, then restored | **F**. Inner markup survives |
| `#auth-otp-target`, `#btn-change-phone`, `#btn-resend-otp` | app.js:113, 117-118, 401-402 | OTP target text; back to phone; resend | G |
| `.phone-modal` | style.css:2893-2972 | Shared by auth **and** help | Not a JS hook. Scope auth-only styles with `#auth-modal` or `.auth-modal-box` |
| `#camera-modal`, `#camera-backdrop`, `#camera-close-x`, `#camera-cancel`, `#camera-capture` | app.js:450-456, 1146-1163, 1355-1385, 1398-1424 | Camera UI; closes on root click (`e.target===#camera-modal`) | G |
| `#camera-video[autoplay][playsinline][muted]` | app.js:453, 1140-1143, 1160, 1402 | Stream | **F** on capture. The attributes are needed for inline playback on iOS |
| `#camera-canvas[hidden]` | app.js:454, 1403-1415 | Capture buffer (intrinsic size, CSS-independent) | **F**. Keep it hidden |
| `#crop-modal` + `.crop-shape-rectangle/-circle/-heart` | app.js:467, 1173-1177, 1230, 1234-1244, 1265 | Root **is** the backdrop (`e.target===cropModal`) | Wrapping `.crop-box` in another full-size element breaks outside-click close |
| `#crop-image` | app.js:468, 1210-1214 | Cropper target | **F** |
| `#crop-close`, `#crop-confirm`, `#rotate-left`, `#rotate-right` | app.js:469-472, 1218-1273 | Crop actions | **U** |
| `.crop-shape-circle/-heart .cropper-view-box/.cropper-face` | style.css:2761-2770 | Shape masks on Cropper's own DOM | Removing these loses the shape hint |

### 3.8 Cart and toasts (static)

| Selector / attribute | Used in | Purpose | What breaks |
|---|---|---|---|
| `#cart-overlay` + `.active` | app.js:64, 2224-2227, 2235-2238, 2519 | Dim + click-to-close | G. Must stay the click target |
| `#cart-drawer` + `.active` | app.js:63, 2220-2223, 2231-2234 | Drawer | G. Both `hidden` **and** `.active` are used (350 ms coupling) |
| `#cart-close-btn`, `#cart-continue-btn` | app.js:65, 72, 2518, 2520-2525 | Close; close + create | G |
| `#cart-checkout-btn` + `disabled` | app.js:71, 2277-2279, 2527-2544 | Checkout (opens auth over the drawer when logged out) | G |
| `#cart-checkout-amount` (span **inside** the checkout button) | app.js:70, 2271 | Amount text | G. Only the span's text is written |
| `#cart-drawer-count`, `#cart-total-qty`, `#cart-subtotal-amount` | app.js:67-69, 2268-2270 | JS-owned text | G |
| `#cart-limit-banner` | app.js:73, 2273-2275, 2462 | Shown at ≥20 items | G |
| `#cart-items-container` | app.js:66, 2261-2397 | innerHTML rebuilt | G |
| `#toast-container` | app.js:76, 2200-2215 | Toast host; `pointer-events:none` (toasts use `auto`) | G: toasts silently vanish |

### 3.9 JS-generated markup (style from CSS only; changing the classes means editing app.js)

| Generated selector | Generated at | Purpose | Contract |
|---|---|---|---|
| `button.font-chip[type=button][data-font-id]` + `.selected` > `span.font-chip-text[style="font-family:…"]` + `span.font-chip-name` | app.js:805-842 | Font picker; ids `pixel bebas montserrat marker pacifico` | `className` is assigned in JS, so any extra class must be added in JS. **Never override the inline `font-family`** |
| `div.emoji-cat` > `div.emoji-cat-name` + `div.emoji-grid` > 8 × `button.emoji-btn[type=button]` | app.js:856-879 | Emoji picker (the emoji are engraving content) | `.emoji-cat` and `.emoji-cat-name` have no CSS today |
| `div.toast.toast-{success,info,warning,error}` > `span`(icon) + `span`(msg) | app.js:2200-2215 | Toasts | Class set via `className`. `.toast-info` has no CSS. The icons are JS strings |
| `.cart-empty-state`, `.cart-empty-icon`, empty-state `.btn.btn-primary[onclick]` | app.js:2280-2291 | Empty cart | The onclick uses the globals `closeCartDrawer` and `showScreen` |
| `div.cart-item-card[data-id]` and its inner classes (see section 2) | app.js:2295-2349 | Cart rows | CSS hooks only, except the next row |
| `.btn-qty-minus[data-id]`, `.btn-qty-plus[data-id]` (+`disabled` ≥20), `.btn-edit-item[data-id]`, `.btn-remove-item[data-id]` | app.js:2336-2344, 2352-2396 | **JS hooks** (re-bound after each render) | Renaming breaks quantity, edit and remove |
| `svg.cart-item-thumb` (rect stroke `#6366f1`, text fill `#0f172a`) / `img.cart-item-thumb` | app.js:2300-2312 | Thumbnails | Colours are hard-coded in JS; override with CSS (`.cart-item-thumb rect{stroke:…}`). Image thumbs are white-on-transparent and need `filter:invert(1)` or a dark tile |
| `#keychain-svg` / `.img-overlay` children (dimension lines, outline, hole, `text#keychain-text`) | app.js:909-921, 941-945; keychain-layout.js | Preview geometry | See section 5 |
| `#crop-modal.crop-shape-*` | app.js:1174-1176 | Crop mask hook | Keep the class names |
| `#dbg-btn`, `#dbg-panel(.open)`, `#dbg-x`, `#dbg-body`, inner `.hd .body .sec .sec-h .status .dot(.on/.warn/.off/.idle) .muted .row .pos .pill .now .err .log .ev .t .empty .bar` | debug-panel.js:28-152 | Ops panel | Don't reuse these ids. Global rules on generic classes (`.row`, `.pill`, `.status`, `.muted`, `.body`, `.empty`, `.log`, `.bar`) would leak into it |

### 3.10 State classes and attributes (summary)

| State hook | Elements | Toggled by |
|---|---|---|
| `.active` | `.screen`; `.mode-tab` (`#type-name/#type-image`); `.mode-chip`; `.progress-step`; `.cart-drawer`; `.cart-overlay`; (dormant: `#nav-step-*`, `#btn-view-*`) | app.js:517, 481, 1444, 1995-2020, 2222-2238 |
| `.selected` | `.shape-card`, `.shape-pill`, `.font-chip`, (dormant `.material-card`) | 579, 609-612, 814, 839 |
| `.completed` | `.progress-step` | 1983-2024 |
| `.has-image`, `.dragging` | `#img-keychain` | 1319, 1490, 1528, 1553, 2442 |
| `.dragging` | `#keychain-text` | 1053, 1071 |
| `.your-turn` | `#live-queue` | 1949-1980 |
| `.enabled` + `disabled` | `#btn-notify` | 2053-2061 |
| `.in-view` | `#testimonial-section` | 2187, 2195 |
| `.sample-dimmed`; inline `--px/--py` | `.hero-sample-item` | 661-682 |
| `.crop-shape-{id}` | `#crop-modal` | 1175-1176 |
| `.open` | `#dbg-panel` | debug-panel.js |
| `disabled` (style `:disabled`, not a class) | `#btn-pay #btn-pay-image #btn-add-cart-text #btn-add-cart-image #btn-send-otp #btn-verify-otp #btn-notify #btn-open-direct-link #cart-checkout-btn .btn-qty-plus` | Various. These must stay real `<button>`s |
| `aria-expanded` | `#emoji-toggle` | 882-884 |
| `hidden` | See 3.1 | See 3.1 |
| inline `style` written by JS | `#img-canvas` left/top/width/height; `#img-keychain` aspect-ratio; `.font-chip-text` font-family; `.hero-sample-item` `--px/--py` | Do not override with `!important` |

### 3.11 Dormant names: do NOT reuse for unrelated elements (they would silently activate old JS)

| Name | Code | Effect if it appears in markup |
|---|---|---|
| `.material-card[data-material]` | app.js:761-777 | Click sets `data-material` on both preview boxes (changes preview colours) |
| `#btn-view-product`, `#btn-view-technical` | app.js:779-802 | Toggle `view-product` / `view-technical` (technical shows mm dimension lines) |
| `#nav-step-design`, `#nav-step-review`, `#nav-step-checkout` | app.js:544-561 | Get `.active` per route (usable on purpose for a stepper; all three must exist) |
| `.shape-pill[data-shape-id]` | app.js:611-613, 736-740 | Selects a shape (usable on purpose) |
| `#img-replace` | app.js:441, 1350-1352 | Click opens the file picker (usable on purpose, but not also as `label for=img-file`, or the picker opens twice) |
| `#phone-modal`, `#modal-phone-input`, `#modal-phone-hint`, `#btn-phone-continue`, `#phone-modal-close`, `#phone-modal-backdrop` | app.js:79-84 | Looked up, never used |
| `#screen-name .preview-hint`, `#screen-image .preview-hint` | app.js:926, 949 | Fallback hint targets |
| `.header-help-btn` without `#btn-header-help` wiring | n/a | Help does nothing until JS is added |

### 3.12 Free to rename or remove (no JS reader)
`#nav-brand` (but see its href behaviour), `#user-auth-bar`, `#auth-btn-label`, `#btn-header-help`, `#app-footer`, `#keychain-preview`, `#shape-grid`, `data-mode` on the mode tabs, `#order-progress`, `#live-queue-text` (queried, never used), `#auth-modal-title`, `#auth-modal-sub`, `#auth-name-group`, `#auth-phone-group`, `#auth-otp-group`, `#help-modal` and all its children, `#btn-help-start`, `#cart-footer`, `#img-adjust-hint` (it must remain the first `.preview-hint` in `#img-preview-box`), all `.price-*`, all testimonial, footer and banner decoration classes.

---

## 4. Layout-coupled code (measurements and sizes the CSS must keep satisfying)

| # | Coupling | Code | Current values | What the new CSS must satisfy |
|---|---|---|---|---|
| 1 | Fixed header height vs screen offsets | style.css:77-94 (72 px), 3636-3641 (64 px ≤768); `.screen` padding-top 96 (459); `#screen-welcome` 80 (481) and 72 ≤899 (2995); `.preview-column` sticky `top:88` (1486) | 72 / 96 / 80 / 88 | Change all four together. The planned 52 px header needs the same edit in each place; a single `--header-h` token is recommended |
| 2 | Screen visibility and entrance animation | style.css:452-470 | `display:none/flex !important`; `screenFadeIn` 0.35 s uses `transform` | While `.screen.active` animates, it is the containing block for any `position:fixed` descendant, so a fixed bar inside a screen jumps (Derived). Use `position:sticky` for in-screen bars, or make the entrance opacity-only. `.screen` is `position:relative; z-index:1`, so nothing inside a screen can rise above the header or overlays. Keep modals, drawer and toasts as direct children of `<body>` (they are today). `#screen-welcome` relies on `flex-direction:column` (480-487) |
| 3 | Scroll container | style.css:51-58; app.js:520-523, 711, 722 | `html,body{height:100%; overflow-x:hidden}` | Derived from the overflow spec: `<body>` is the scroller, not the window, so `window.scrollTo` in the footer links is a no-op (the screen reset already scrolled `body`). Do not add inner scroll wrappers such as `main{height:100vh;overflow:auto}`, because they are never reset between screens. Do not put `scroll-behavior:smooth` on html/body (it would animate the "instant" resets). `#screen-welcome` (486) and `.hero-canvas` ≤899 (3002) have `overflow-x:hidden`, which makes them scroll containers, so a `position:sticky` inside welcome sticks to them, not the viewport (Derived). A sticky bar inside `.mode-panel` works: no ancestor between it and body sets overflow (Derived) |
| 4 | Configurator switch | style.css:1475-1481 (≥900 two columns) and 3012-3013 (≤899 one column, preview `position:relative`) | 900/899 | Sticky reset and grid switch must flip at the same width. JS reads no breakpoints (no `matchMedia`; Verified by grep), so breakpoints are free to change |
| 5 | Text preview px/mm | style.css:1561-1575 (`.keychain-preview` max 400 px, SVG width 100%, height auto) | px/mm = SVG width / viewBoxW (86, 64, 69) | Sizing changes px/mm only, not geometry. See the table in section 5 |
| 6 | Text auto-fit | app.js:1014-1027 (`getBBox`) | Shrinks to `maxTextWidth` 52/36/32 mm | `#keychain-svg` must be **rendered** (not `display:none`) whenever text can change. `visibility:hidden` or `opacity:0` is fine; `getBBox` returns 0 inside `display:none`, so no shrink happens (Derived). Existing case: hero and footer shape links rebuild the SVG while create is hidden |
| 7 | Text drag mapping | app.js:1039-1048 (`getScreenCTM().inverse()`) | Pointer → mm | No rotate, skew or 3D transforms on `#keychain-svg` or its ancestors (Assumed safe for translate and uniform scale). `position:sticky` is fine |
| 8 | Image stage box | style.css:2111-2119; app.js:935 | `position:relative`, `width:100%`, `max-width:400px`, CSS `aspect-ratio:72/35` overridden inline by JS to 86/49, 64/64, 69/64 | Keep `position:relative`. Size it **by width only**: no `height` or `max-height` (with a definite width, a max-height clamps the height and distorts the stage; Derived) and no `!important` aspect-ratio. Keep `border:0` and `padding:0`: with global `box-sizing:border-box` the aspect ratio applies to the border box while the canvas and overlay lay out in the padding box, and drag scaling uses the border-box width (Derived). Put frames and texture on a wrapper or the stage background |
| 9 | Image canvas placement | app.js:1278-1295; style.css:2164-2173 | % of the stage. Rect: left 23.26, top 22.45, w 65.12, h 55.10. Circle: 14.06 / 14.06 / 71.88 / 71.88. Heart: 13.04 / 14.06 / 73.91 / 68.75. Bitmap px: 373×180, 307×307, 340×293 | `#img-canvas` stays `position:absolute`, a direct child of `#img-keychain`, with no padding or border, shown only under `.has-image`, and `pointer-events:none` |
| 10 | Overlay and dropzone | style.css:2175-2181, 2183-2197 | `.img-overlay` absolute `inset:0` 100%×100%, `preserveAspectRatio="none"`; `.img-dropzone` absolute `inset:4%` | Keep the overlay in the same containing block as the canvas, with `pointer-events:none` |
| 11 | Image drag and wheel | app.js:1511-1574; style.css:2121-2125 | Delta × processor width / `getBoundingClientRect().width`; the image moves 65%/72%/74% of pointer travel (Derived); wheel `passive:false` | Keep `touch-action:none` and `user-select:none` on `.img-keychain.has-image` (otherwise touch drags scroll the page). No rotate or skew on the stage or its ancestors |
| 12 | Cropper measurement | style.css:2741-2752, 2761-2770; app.js:1167-1216 | `.crop-container` max-height 340 px, overflow hidden; `img` max-width 100%; heart mask `clip-path:path()` in fixed 100×90 px units | The container needs a definite, non-zero, untransformed size when `new Cropper` runs (Assumed, from Cropper v1). No `display` class transitions and no scale-from-0 entrance on `.crop-box` / `.crop-container`. The heart mask does not scale with the box (pre-existing) |
| 13 | Camera | style.css:2675, 2687 | `.camera-container` and video max-height 55vh, `object-fit:cover` | Free to go full-screen. Capture uses the intrinsic `videoWidth/Height` |
| 14 | Toast lifetime | style.css:3584, 3592-3608; app.js:2210-2214 | Slide-in 0.3 s + fade from 3.7 s to 4.0 s; node removed at 4000 ms | The total animation must end at or before 4.0 s, or the JS timeout must change with it |
| 15 | Drawer lifetime | style.css:3193-3231; app.js:2218-2239 | Drawer transform 0.35 s, overlay opacity 0.3 s; `hidden` set 350 ms after close | Close animation ≤ 350 ms (the planned 240 ms is fine). On open, `hidden` is removed and `.active` added in the same tick, so a CSS **transition** does not play (Derived). Use a `@keyframes` animation on `.active` |
| 16 | Focus timing | app.js:171-174, 198 | Auth inputs focused 100 ms after un-hide | The modal must be visible and focusable within 100 ms (no long entrance delay) |
| 17 | Hero parallax | app.js:634-670; style.css:936-1060 | Normalised by `innerWidth/innerHeight`; `--px/--py` in px | Nothing is required; dropping the float keyframes is harmless |
| 18 | Emoji panel | style.css:2039-2046 | `max-height:220px; overflow-y:auto` | Keep a bounded height (64 buttons) |
| 19 | Stacking | style.css + debug-panel.js | `body::before` 0 < `.screen` 1 < header 50 < cart overlay 1000 < drawer 1001 < camera 1050 < crop 1060 = `.phone-modal` (auth, help) 1060 < toasts 1100 < debug 99999 | Keep toast > auth ≥ crop > camera > drawer > overlay > header. Checkout opens auth **over** the open drawer; OTP errors toast over auth. Desktop hero: `.welcome-container` 25 and `.welcome-actions` / `#btn-start` 30 stay above the samples (composition 5) |
| 20 | Bottom-right corner | style.css:3551-3560, 3618-3626; debug-panel.js:28 | Toasts at 24 px (16 px ≤600, full width); debug button at 14 px; reCAPTCHA badge (Assumed); the planned sticky action bar | On create, lift the toasts above the sticky bar (e.g. `#screen-create.active ~ #toast-container{bottom:…}`, a valid sibling selector because the container follows the screens in the DOM). Add safe-area insets |

---

## 5. Preview rendering: what may be restyled vs what must not change

**How it works.**
- **Text mode** is inline SVG in mm units (1 user unit = 1 mm, origin at the blank's top-left, 7 mm margin for dimension lines). It is rebuilt by `updateShapePreviews` (app.js:899-959) from `window.KEYCHAIN_SHAPES` (keychain-layout.js:22-179).
- **Image mode** is `#img-canvas`, a display copy of the offscreen print bitmap (white = burn, transparent = no burn, 0.15 mm/px), placed in % under the `.img-overlay` outline.
- **The printer never sees** CSS, SVG colours or `#img-canvas`. The cart path sends text items as `{name, shapeId, fontId, textPos}` and image items as `imageProcessorState.canvasDataUrl` from `imageProcessor.canvas` (app.js:2456-2492; the single-order path is 1636-1683).
- **Dead files.** `js/preview.js`, `js/shapes.js` and `js/keychain-shapes.js` are not loaded. `keychain-shapes.js` would **overwrite** `window.KEYCHAIN_SHAPES` with an incompatible schema, so never add a script tag for it.

**Derived on-screen scale.** The "Actual size" caption is text only; nothing computes px/mm.

| SVG width | Rectangle (viewBox 86 wide) | Circle (64) | Heart (69) |
|---|---|---|---|
| 400 px (cap; about ≥934 px desktop, 506-899 px single column) | 4.65 px/mm, blank 335 px, 1.23× CSS mm | 6.25 px/mm, 313 px, 1.65× | 5.80 px/mm, 319 px, 1.53× |
| 269 px (375 px phone: 375 − 48 screen padding − 56 box padding − 2 border) | 3.13 px/mm, 0.83× | 4.20 px/mm, 1.11× | 3.90 px/mm, 1.03× |

The preview height also jumps on shape change: SVG height at 400 px is 228 / 400 / 371 px.

### Must NOT change (engraving and data contract)

| Item | Where | Why |
|---|---|---|
| Every numeric field in `KEYCHAIN_SHAPES`: width, height, viewBox, viewBoxW/H, originX/Y, hole, outline geometry, `borderPathD`, `textArea` (x, y, anchor, baseline, fontScale, maxTextWidth, dragBounds), `imageArea` | keychain-layout.js:22-179 | Kept in sync with printer-agent; used for masks, fit and placement |
| `KEYCHAIN_FONTS` id / family / fixedCapHeight / file; `DEFAULT_FONT_ID='pixel'`; `KEYCHAIN_IMAGE_AREA`; `ENGRAVE_PIXEL_SIZE_MM=0.15`; `IMAGE_UPLOAD` | keychain-layout.js:186-247 | Preview-to-burn fit, bitmap resolution, upload limits |
| All of `image-processor.js`, and `imageProcessor.canvas` pixel data | image-processor.js | This canvas **is** the print file. Never draw on, tint or filter it |
| Fit, clamp and placement maths: `renderKeychainText`, `getConstrainedTextPos`, `positionImageCanvas`, drag mapping | app.js:964-1028, 1278-1295, 1511-1574 | Preview placement equals engrave placement |
| Payload fields `name, shapeId/shape, fontId, textPos, printImageBase64, imageProcessorState.canvasDataUrl`; globals `selectedShapeId`, `selectedFontId`, `customTextPos`, `window.selectedShapeId` | app.js:1636-1683, 2456-2492 | Consumed by backend and printer |
| Static rectangle twin (index.html:342-361) must equal the rectangle registry entry; anything added to the JS template (909-921) must also be added to the twin | index.html / app.js | Users see the twin until the first shape selection |
| Engraving font families loaded (Bebas Neue, Montserrat **700**, Noto Emoji, Pacifico, Permanent Marker, Press Start 2P) | index.html:11-13 | Fallback fonts change the `getBBox` fit and appearance |
| No CSS on `#keychain-text`, or inherited from any ancestor (`.screen`, `.create-container`, `.configurator-grid`, `.preview-column`, `.preview-box`, `.keychain-preview`, `#keychain-svg`), for: `font-family`, `font-size`, `font-weight`, `font-style`, `font-stretch`, `font-variant*`, `font-feature-settings`, `font-kerning`, `letter-spacing`, `word-spacing`, `text-transform`, `text-anchor`, `dominant-baseline` | style.css (none set today) | CSS beats presentation attributes and inheritance changes glyph advances. Recommended guard: `.keychain-svg{letter-spacing:normal;word-spacing:normal;font-weight:normal;font-style:normal;text-transform:none;font-feature-settings:normal}` |
| Do not override the inline `font-family` on `.font-chip-text` | app.js:817 | The chip is the font sample |
| Uppercase display rule (only a-z are uppercased) | app.js:984 | Whether the printer uppercases is unknown (Assumed); this is a logic decision |
| Keep the preview rendered while typing (no `display:none` accordion or tab on the text preview) | app.js:1016 | `getBBox` returns 0 |
| No rotate, skew or 3D transform on `#keychain-svg`, `#img-keychain` or their ancestors | app.js:1045, 1534 | Pointer mapping |

### May be restyled (display-only)

| What | How / where | Caveat |
|---|---|---|
| Card chrome: `.preview-box` background, border, radius, padding, shadow, `::before` glow; `.preview-top-bar`; `.preview-badge` | style.css:1492-1532 | Free |
| Caption `.preview-hint` typography | style.css:1695-1700 | Text is JS-owned. The "Actual size" wording is only true at about 1× (see scale table); consider a copy change |
| Ink colour (e.g. burn `#3A2317`) | The last-winning rule `.preview-box[data-material="wood"] .keychain-svg text#keychain-text` (2785-2788) | Keep `fill:none` unless printer-agent is confirmed to fill glyphs (Assumed). Keep stroke width near 0.22 mm; much thicker overstates the burn. Replace the indigo/cyan hover and drag glows (1587-1595) |
| Blank fill and outline colour | style.css:2777-2783 (these win over 1646-1680) | The rule `.keychain-svg rect, circle, path` also matches the **hole** and the circle-shape outline. CSS-only split: the hole is always `circle:last-of-type` in both `#keychain-svg` and `.img-overlay` (outline, then hole, in every shape and the static twin; Derived). Alternatively add classes inside the `outlineSvg` / `holeSvg` strings (display-only strings, but in the do-not-touch file; flag it) |
| Image-mode outline colour | Add `.img-overlay rect, .img-overlay circle, .img-overlay path{stroke:…}` | Today it uses the attribute `#0a0a0a` because it is not under `.keychain-svg` |
| Wood texture behind the engraving | (a) a `<pattern id="kc-wood">` in a separate `aria-hidden` `<svg width="0" height="0" style="position:absolute">` outside the previews, referenced by CSS `fill:url(#kc-wood)` on the outline (avoid `display:none` on that host svg; Assumed browser risk); or (b) an `<image>` in mm as first child in **both** the JS template and the static twin; or (c) a CSS background on `.img-keychain` / `.preview-box` | Anything inside `#keychain-svg` or `.img-overlay` is wiped on shape change unless it is in the template. Texture must sit under the outline and text. There is no measured geometry for the physical blank edge (the outline is the engraved border at 2 mm inset), so do not invent a silhouette |
| Image ink colour | Replace `filter:invert(1)` on `.img-canvas` (2167) with a CSS filter chain toward brown (tune visually; Assumed); or tint the display copy in `renderImageCanvas` (source-in fill) and then **remove** `invert(1)` | JS tinting is an app.js edit. Never tint `imageProcessor.canvas` |
| Drop shadows (`.keychain-svg` filter), stage background, dropzone look | style.css:1570-1575, 2183-2208, 2790-2793 | Keep the dropzone absolutely positioned inside the stage |
| Showing the mm dimension lines as an "actual size" overlay | Remove or override `.preview-box.view-product line, text:not(#keychain-text){opacity:0}` (1689-1693) | They come from `shape.dimensionLines` (attribute colours `#bbb` / `#888`, Inter 2.6 mm) |
| Preview size and position | `.keychain-preview` max-width; the sticky column on phones (change the ≤899 `position:relative` rule) | Changes px/mm only. Constrain the image stage by width, never height. A consistent px/mm across shapes needs width proportional to viewBoxW. No shape class is exposed; CSS could key on `#keychain-svg[viewBox="-7 -7 86 49"]` (Assumed to match for SVG in HTML) or a small JS change adding `data-shape` |
| Cart thumbnails | CSS on `.cart-item-thumb`; `img.cart-item-thumb` can take the same burn filter | Always a rectangle with `#6366f1` in JS; shape-correct thumbs need a JS change |
| Crop masks | style.css:2761-2770 | Cosmetic; the real mask is applied by image-processor |

---

## 6. CSS today (short)

- **Structure.** One file, 3815 lines, 88 KB (the plan's budget is 60 KB). There is no consistent ordering:
  - reset + `[hidden]` (1-10); tokens (12-49); base (51-74); header (76-449, with dead badge, stepper and brand blocks); screens (451-477); welcome hero + samples (479-1060); testimonial (1062-1254); footer (1256-1387); buttons (1389-1457); configurator + preview + controls (1459-2263); payment loader (2265-2295); success dashboard (2297-2603); camera (2605-2695); crop (2697-2770); wood override (2772-2793); phone/auth modal (2795-2972); responsive (2974-3099); cart + toasts (3101-3627); header responsive (3629-3674); user auth (3676-3816).
  - Header responsive rules sit about 3500 lines after the header.
- **Tokens** (`:root` 12-49).
  - 29 defined; 15 never used (`--bg-card`, `--primary-gradient(-hover)`, all `--accent-*`, `--border-hover`, `--radius-sm`, `--shadow-hover`).
  - **Used but undefined:** `--primary` ×8 (3111, 3131, 3181, 3182, 3456, 3491, 3521, 3536: cart button, add-to-cart hover, qty and action hovers, subtotal, continue link, all falling back to inherited colour); `--text-dark` ×5 (2333, 2395, 2436, 2473, 2499, success headings); `--font-title` ×2 (3255, 3320); `--text-muted` ×2 (2809, 2947, with fallback).
  - `var(--radius-md)` is also used inline at index.html:767.
- **Hard-coded colour** (Verified by grep):
  - 245 hex literals (52 distinct) + 216 `rgb()/rgba()` (110 distinct), against about 117 colour-token references, so roughly 80% of colours are literals.
  - Indigo `#6366f1` ×46 + `rgba(99,102,241,…)` ×81, while `--accent-indigo` is unused.
  - The brand gradient `#6366f1→#06b6d4` is written literally 4×. `.btn-primary` uses a 3-stop `#4338ca→#2563eb→#06b6d4` (1412; repeated for `.title-accent`, 637).
  - Outside CSS: the Razorpay theme `#00e5ff` (app.js:1756), cart thumb `#6366f1` / `#0f172a` (2307-2308), SVG strokes `#0a0a0a` / `#09090b` / `#bbb` / `#888` (keychain-layout.js, index.html), avatar gradient `#4f46e5→#06b6d4` (index.html:249-250), and the debug panel's own dark theme.
- **Fonts.**
  - UI: `--font` = Inter + system stack. Buttons and inputs set `font-family` explicitly.
  - `'Playfair Display'` is referenced (1140) but not loaded, so it falls back to Georgia.
  - Weights 450/550/650 are used but not loaded (synthesised).
  - The engraving fonts are functional (see section 5).
- **Breakpoints** (not tokenised; overlapping): `min 900` (1475); `max 820` (2532); `max 1439` (2975); `max 1199` (2981); `max 899` ×2 (2993, 3063); `max 599` (3071); `prefers-reduced-motion` (3090, which stops only the sample float and testimonial transition); `max 600` ×2 (3611, 3808); `max 1024` (3630, dead badge); `max 768` (3636); `max 480` (3664, dead stepper).
- **Animations** (13 names, 14 definitions):
  - `statusPulse` 131 (dead)
  - `pulseGlow` ×2 (251, 2420). The later green box-shadow ring wins for `.welcome-label-dot`, `.status-dot-pulse` and `.pulse-dot`.
  - `screenFadeIn` 467
  - `bounceDown` 699
  - `sampleFloat1-7` 936-1060
  - `spin` 2276
  - `modalPop` 2640 (camera box only)
  - `sampleFloatMobile` 3058 (neutralised by `transform:none !important`)
  - `badgePop` 3150
  - `toastSlideIn` 3592 and `toastFadeOut` 3603
- **z-index**: see section 4, row 19.
- **Dead CSS** (about 450 lines):
  - `.header-left`; the status badge (102-156); brand icon and text blocks (176-249); the `.nav-progress` / `.nav-step*` stepper (256-326, 3646-3673)
  - `.decorations`; `.hero-trust-bar` / `.trust-item` / `.trust-sep` (704-728); `.trust-badge-icon`
  - `.preview-mode-switcher` / `.preview-mode-btn` (1534-1559); metal, acrylic and first-wood finishes (1653-1680); `.view-technical` (1682-1687); the material grid (1801-1845)
  - `.success-icon`; `.queue-position` (2545-2551); `.phone-subtitle`; `.phone-input-group.invalid/.valid` (2876-2891; never applied)
  - `@media 1024` and `@media 480`
- **Duplicates**: `pulseGlow`; `.hero-sample-item` (738 vs 901; the second drops the transform transition); sample hover badge/glow rules (841-849 vs 921-933); wood finish (1660 vs 2777, later wins); two 899 blocks; two 600 blocks next to a 599 block. In app.js, `resetShapeState` is declared twice (576, 621; the later wins).
- **Classes used in HTML/JS with no CSS**: `.btn-notify`, `.verify-banner`, `.tracker-action-row`, `.spinner`, `.progress-content`, `.your-turn`, `.enabled`, `.toast-info`, `.img-coverage`, `.emoji-cat`, `.emoji-cat-name`, `.emoji-toggle-icon`, `.emoji-toggle-label`, `.section-title`, `.payment-sub`, `.btn-block`, `.btn-sm`, `.banner-right`, `.info-card`, `.note-icon`, `.note-content`, `.phone-modal-body`, `.footer-link-shape`, `.footer-link-mode`, `.footer-links-col`.

---

## 7. Safe restructure strategy

### Ground rules (apply to every step)
1. **Contract first.** Every id in section 3 marked **U** or **F** stays in the page exactly once, with the same element type (text input, range, checkbox, file, canvas, video, img, button), from the initial HTML. They are queried once at load, so injected elements are never seen.
2. **Visibility mechanisms stay.**
   - `[hidden]{display:none !important}` goes first in the new reset.
   - `.screen` / `.screen.active` remain the only screen switch.
   - Header visibility stays keyed on `body[data-screen]`.
   - No component `display` rule may carry `!important`.
3. **Put decoration outside JS-owned nodes.** Do not put markup inside nodes whose content JS overwrites: `#btn-add-cart-text/-image`, `#btn-open-direct-link`, `#live-queue-sub`, `#user-phone-tag`, `#cart-badge`, the hints, `#payment-title/-sub`, `#queue-number`, `#now-printing`, `#verify-banner`, `#success-footer-text`, the first span of `#btn-notify`. Use wrappers, siblings or `::before/::after`.
4. **Scope new selectors.** `.active` and `.selected` are shared across components, so scope them (`.progress-step.active`, `.mode-tab.active`). Avoid generic global class names (`.row`, `.pill`, `.status`, `.body`, `.muted`, `.empty`, `.log`, `.bar`) that leak into the debug panel.
5. **Anchors.** Every new in-page `<a href="#…">` needs `return false` or `preventDefault` (pattern at index.html:108).
6. **Scroll model.** Keep html/body as the scroller. No inner scroll wrappers, no `scroll-behavior:smooth` on html/body.
7. **Inline styles.** Move the inline styles (index.html:566-567, 601, 614-620, 767, 830, 845, 862, 868, 914) into classes. Never fight the JS-written inline properties (section 3.10).
8. **Dormant names.** Do not reuse the dormant names in 3.11 unless you intend to activate them.

### Order of work (each step with its verify)
0. **Baseline.** Capture every screen at 390×844 and 1440×900 before any change.
   - States to capture: logged out, logged in, cart restored, `?debug=1`, image loaded, crop circle/heart, drawer open with the auth modal on top.
   - To view success without calling the real verify endpoint, run `showScreen('success')` in the console. Derived: this starts only the read-only Firestore queue listener.
   - Record the known defects below so they are not mistaken for regressions.
   - Verify: console clean on load.
1. **Tokens, reset, base.**
   - New `:root` token block. Either define or delete `--primary`, `--text-dark`, `--font-title` and `--text-muted`. Keep `--radius-md` or edit index.html:767.
   - Reset with `[hidden]` first. Keep the `.screen` rules. Make `screenFadeIn` opacity-only if any fixed or sticky bar will live inside a screen.
   - Add the UI fonts (the plan's Bricolage Grotesque + Anek Latin) to the Google Fonts request **alongside** the six engraving families. Inter can go; the only non-UI uses are the hidden SVG dimension labels and the cart thumb fallback.
   - Verify: all four screens reachable via `showScreen()`, and every modal, drawer and badge still hidden at load.
2. **Header (planned 52 px).**
   - Update the four offsets in section 4 row 1 together.
   - Keep both `#btn-header-auth` and `#user-profile-badge` (an account menu may wrap them). `#cart-btn` with a separate `#cart-badge`. `#home-btn`.
   - Decide explicitly whether the logo stays an implicit home link (`href="#"`, no confirm, no reset) or becomes a button needing JS.
   - Help stays inert unless JS is added (flag it).
   - Verify: header correct for each `data-screen` value, with no wrap or overflow at 360 px.
3. **Shared components.** Buttons (primary, secondary, ghost, icon) with distinct `:disabled` styling; chips and segmented control; cards; inputs with counter. Verify: Add to Cart and Buy Now start disabled and enable on text or image.
4. **Create screen (highest risk).** Follow section 5 exactly.
   - Shape chips: keep `.shape-card[data-shape-id]` (or use `.shape-pill`).
   - Segmented control: keep `#type-name` / `#type-image` + `.active`.
   - 56 px text input without `maxlength`.
   - Emoji row: style the generated classes; keep toggle + `[hidden]`.
   - "Adjust": a `<details>` inside `#img-controls`.
   - "Add photo": keep `#img-dropzone` as `label for=img-file`. Add a second activator only as another `<label for="img-file">` or as `#img-replace`, not both on one element.
   - Sticky bottom action bar: one per `.mode-panel`, wrapping that panel's `.price-tag` and `.configurator-actions`, using `position:sticky; bottom:0` with safe-area padding. Lift the toasts above it (section 4 row 20).
   - Verify: all 3 shapes × 5 fonts; typing, emoji and the 20 cap; text drag (it works only before the first shape change, a known bug); upload → crop (circle and heart masks) → preview aligned after a shape click; camera; zoom, threshold, invert and reset; image drag and wheel zoom on touch and desktop; the "Actual size" caption updates.
5. **Cart (sheet on phones, drawer on desktop), toasts, auth modal.**
   - Cart: `@keyframes` on `.cart-drawer.active` / `.cart-overlay.active`; close ≤ 350 ms; keep both `hidden` and `.active`.
   - Cart item look: CSS on the generated classes. Template changes are app.js edits.
   - Toasts: add `.toast-info`; lifetime ≤ 4 s.
   - Auth as a bottom sheet: scope to `#auth-modal`, since `.phone-modal` is shared with help. Keep it above the drawer. Bound its height for the on-screen keyboard. Leave room for long hint text. Do not hide `#recaptcha-container`.
   - Verify: add, edit, remove and qty, 20-item limit and banner; logged-out checkout opens auth over the drawer; OTP happy path and error hints.
6. **Welcome.**
   - Removing the floating samples and `#hero-canvas` is safe (the JS is guarded) but removes their click-to-shape links.
   - For the planned three tappable shape cards, use static `.footer-link-shape[data-shape]` elements (they work anywhere in the page), or keep `#hero-canvas` wrapping `.hero-sample-item[data-shape][role=button][tabindex=0]`. Do **not** use `.shape-card` on welcome: it only selects the shape and would become the first match for `editCartItem`.
   - Keep `#btn-start` with its inline onclick. Keep `#testimonial-section`.
   - The "how it works" block can be static markup. The current testimonial is anonymous, which is a content decision under the plan's "only true things" rule.
   - Verify: CTA, card links, scroll hint stays on welcome, back button.
7. **Payment and success.**
   - Give `.section-title` and `.payment-sub` real styles; keep `#btn-open-direct-link` text-only.
   - Stepper: build it on `#step-*` with `.completed` / `.active`. Style `.spinner`, `.verify-banner`, `.btn-notify` (+ `.enabled` / `:disabled`) and `.your-turn`.
   - Static placeholders ("#14", "~3 to 6 Minutes", "Verified & Paid", "Live Laser Engine: Online", the help copy's Oval/Shield) may get neutral wording because they are pure static text. `#now-printing`'s initial text is replaced by JS once data arrives.
   - Verify: success via console, notify button, Create Another.
8. **Camera and crop.** Full-screen layouts are fine. Keep the crop root as the click-to-close backdrop, give the container a definite size, and use no transform or scale entrance on crop. Keep the video attributes. Verify: capture → crop → image, and rotate.
9. **Cleanup.** Only after visual parity: delete the dead CSS (section 6), merge duplicate blocks (the later rule is what production renders today), consolidate breakpoints (the JS reads none), and target ≤60 KB. Verify: the diff of captures shows no unintended change.
10. **Deploy.** Bump `?v=` on style.css and any changed js (html/js/css are already served no-store). Check new asset paths load. Derived: the `** → /index.html` rewrite returns HTML with status 200 for missing files, so broken paths do not 404. Review the hosting ignore list before deploying (see merge note 3).

### Needs a JS edit (not reachable by CSS or HTML; flag each as a behaviour change)
- Razorpay theme `#00e5ff` and name "Laser Keychain" (app.js:1746, 1756).
- Emoji in JS strings conflict with the plan's "no emoji as UI icons": toast icons (2204-2206), Add to Cart / Update Item labels (2256), profile tag (153), success footer (2036), cart title and empty state (2283, 2325).
- Cart thumbnail colours and always-rectangle shape (2300-2312); "Shape: undefined" (2298).
- Help modal wiring and an undefined `closeHelpModal`.
- Image burn-colour tint done in JS instead of the CSS filter.
- A shape attribute on the preview for constant px/mm.

### Existing defects (baseline; do not fix inside the visual diff)
- **Text drag.** It stops after any shape selection: listeners stay on the original `#keychain-text` node (app.js:1031-1093 vs 909).
- **Image misaligned on first load.** The overlay viewBox `0 0 72 35` and CSS aspect 72/35 disagree with the 86×49 canvas maths until `updateShapePreviews` first runs (it is not called at boot, 2572-2577).
- **Customer name disappears.** `#live-queue-sub.textContent` wipes `#success-for` / `#success-name`.
- **`#btn-start` double handler.** Hero samples and footer links skip auth, so login is enforced only at checkout.
- **Buy Now.** It only adds to the cart.
- **Help modal** is unwired.
- **Logo `href="#"`** acts as home without confirm or reset.
- **Editing an image cart item** fails unless an image is still loaded (2431-2448).
- **Image cart thumbs** are white-on-transparent (nearly invisible).
- **`#img-dropzone`** activates the picker as a label **and** via a click listener (1349; Assumed harmless).

**Not verifiable without a browser or device:** whether fragment navigation fires popstate, the body-as-scroller behaviour, Cropper measurement timing, reCAPTCHA in a hidden host, `getScreenCTM` under transforms in Safari, the exact CSS filter for burn-brown, and true physical size on phones.