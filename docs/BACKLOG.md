# Build backlog

Items whose design is settled enough to implement, tracked here so a "what's
left to push" status doesn't have to be reconstructed from chat scrollback.
Updated when the list changes — a new item lands, one gets built, or one
moves in/out of "blocked" — not mechanically after every message.

Companion to `docs/DECISIONS.md` (which holds *what a rule is*); this file
holds *what's queued to build*.

**Priority order below is the user's, set 2026-08-29.**

---

## Decided — no open questions blocking the queue

**Visual direction: Dusk Velvet.** Chosen 2026-08-29 from four candidates
(Neon Arcade, Deco Parlour, Ink & Press, Dusk Velvet). Plum-to-black ground,
apricot accent `#E2B78A`, rose `#E8698A`, Fraunces display over Karla body,
pill buttons, 12–20px radii.

**Copy: approved as drafted.** All fourteen screen states reviewed and signed
off — voice, wording and tone. Build to the drafted strings rather than
re-inventing them; the reference artifact holds every line in context. Voice
rules: name people not seats · say what happened then what it means · never
narrate the machinery · tension not jokes.

---

## ✅ 1. Round cap + always reveal your hand + new-card highlight — SHIPPED to git, awaiting deploy

Built and tested 2026-08-29. 26/26 engine tests, 32/32 multiplayer checks,
11/11 round-cap end-to-end checks including a live browser DOM check of the
result screen. Committed (`56c290d`), **not yet deployed** — holding for the
go-ahead per the batch-then-ship workflow.

**Correction, found while shipping Phase 2 (2026-08-29):** this item was
previously marked as deployed to production in status notes. Checked the
live site directly before this deploy (per standard #7) and it was still
serving the pre-Phase-1 `app.js`/`styles.css` — Phase 1 was never actually
pushed. Both phases go out together in the same `vercel --prod` below.

- **Round cap.** Fires automatically from `endTurn()`; compares total hand
  value; ties go to whoever didn't start. `startingPlayer` is now properly
  persisted (it wasn't before — written to the DB but never read back).
- **Always reveal your own hand.** `revealBtn` / `state.revealed` fully
  removed.
- **New-card highlight.** Cards marked via `freshCards`, cleared on the
  owner's own next action. This also fixed a real, previously invisible
  regression: `hand_json`'s `acquired` field had been silently stuck at
  `'deal'` for every card since the Turso rewrite dropped the code that used
  to populate it.

**Found and fixed along the way, worth knowing about:** every service that
read `log[log.length - 1]` assumed its own event was always last in the log.
A completed round cap appends a second event (`round_cap_resolved`) after
the triggering action — this silently 500'd Burn/Swap/Challenge the moment
any of them happened to complete the cap. The unit suite stayed green
throughout; only the end-to-end test caught it. Fixed with a `findEvent()`
helper (`GameContext.js`) used by name, not position, across all four
services — worth remembering as the pattern for any future engine change
that can append more than one log event per action.

Turn-7 warning and cap countdown were added to the client **functionally
only**, using existing styling — the polished warning-strip treatment from
the mockups is Phase 2 scope, so it wasn't built twice.

## ✅ 2. Visual redesign — apply the chosen direction — SHIPPED to git, awaiting deploy

Built and tested 2026-08-29. 26/26 engine tests (unchanged — this phase only
touched the client and two DealService.js error strings), all six new ES
modules syntax-checked, and a full live walkthrough against a local dev
server: create/join, burn, challenge (declare → accept → giveback), attack
confirm, a declared-attack result screen, and a forced round-cap result
screen — every rendered string checked against the approved reference
artifact word-for-word, and the Dusk Velvet CSS tokens confirmed actually
computing in the browser (background, accent, pill radius, font-family), not
just present in source. Committed (`f081a9a`), **not yet deployed** — going
out together with item 1 (see its note above).

Restyle the existing screens in **Dusk Velvet** (confirmed). Not a rebuild:
components, structure and the state machine all stay — this replaces the
token layer (`public/styles.css` custom properties, type, radii, spacing)
and swaps in the approved copy.

Includes a **full copy pass** — every prompt, button label, empty state and
error message replaced with the signed-off wording. The current strings were
written ad hoc as each feature landed, so they don't sound like one product.

**Also in scope: split `app.js` into real modules.** Confirmed 2026-08-29.
Native ES modules (`<script type="module">`, real `import`/`export`) — not a
framework, no build step. `app.js` is 571 lines and single-file; this phase
already touches every screen for the restyle + copy pass, so splitting the
file structure at the same time means editing each screen once, not twice.
Rough seams: `api.js` (fetch wrapper), `state.js`, `cards.js` (rendering),
`actions.js` (turn actions + the busy loader), `dialogs.js` (drawer, attack
confirm, result overlay), `main.js` (wiring). Also serves phases 4 and 5
directly — a Joker colour-picker prompt and a player-log viewer are real new
UI surfaces, easier to add as new modules than as more functions in one file.

Two additions that came out of the copy review and are now in scope here:
- **Round-cap warning at turn 7** ("One turn left to fix your hand… after
  this you both attack at once, whether you're ready or not"). Being forced
  into an attack unannounced is a gotcha; the warning makes it a countdown.
  Note this depends on item 1 existing first.
- **The `?` on the attack dialog** — the opponent's defence shown as an
  explicit unknown rather than omitted, making the hidden information a
  visible shape at the decision point.

Deliberately sequenced BEFORE mobile fixes: the redesign touches the same
CSS the mobile fixes touch, so doing it after would mean editing those
rules twice.

## 3. Mobile rendering fixes

Diagnosed against production, 2026-08-29 — real reproducible faults, not
cosmetic preference:

- **Overlays cannot scroll.** The end-of-game card is 612px tall. At 360×560
  the *New game* button sits 17px below the fold, and `.overlay` is
  `position:fixed` with `overflow:visible`, so scrolling cannot reach it —
  the screen is a dead end. Affects `.overlay`, `#attackConfirm`,
  `.drawer-scrim`. Fix: `overflow-y:auto` + `align-items:flex-start` +
  `max-height:100dvh` on the scrim, `margin:auto 0` on the card.
- **Top bar wraps to 110px** at 375px — brand, both names and room code all
  share one flex row, eating a fifth of the screen before any game content.
- **`100vh` vs. mobile browser chrome.** Everything sizes against the
  expanded viewport; real usable height is smaller, which is what pushes
  content off. Use `100dvh` with a `100vh` fallback.

Deliberately kept separate from the skin choice: this is a layout fault that
follows whichever direction is picked, so it should be fixed on its own terms
rather than folded into a redesign.

## 4. Player-facing end-of-game log

A curated personal history at game end — what cards *you* played, how *your*
hand changed. Deliberately a new purpose-built read (seat-scoped via the
existing bearer-token pattern), NOT the admin inspector filtered down, so a
future edit to the rich admin dump can't accidentally widen what a player
sees. Never exposes function/service names, table/column names, or raw event
payloads. → `docs/DECISIONS.md` § Player-log vs admin-log segregation

`OPEN`: does it include the opponent's public actions too (a two-player
narrative naturally has two sides), or strictly the viewer's own moves?

## 5. Jack is Joker

Wildcard colour/value mechanic, colour-selection prompt on the owner whenever
a Joker is drawn into any action. Confirmed; 3 minor implementation-detail
assumptions flagged (do declarations persist across turns, is committing
optional at attack time, how the round cap resolves Joker commitment with no
single declaring player). → `docs/DECISIONS.md` § Jack is Joker

## 6. Tips and tricks (post-game coaching)

"What could this player have done better." Still the least specified item —
needs a real design pass before it's buildable: undefined what makes a
suggestion *correct* (simple rule-based heuristics like "you discarded a card
that would have satisfied a later swap demand," vs. something requiring
exploration of alternate lines of play, which is a materially bigger
problem). No design work done yet.

## Blocked / needs more discussion

*(nothing blocked — item 6 needs design, but nothing is waiting on an
external dependency)*

## Shipped

- Region pinning fix — function and Turso DB both in `bom1` (2026-08-29)
- Client-error reporting — `client_errors` table, `/dev.html` panel (2026-08-29)
- `CLAUDE.md` engineering standards + this backlog + `DECISIONS.md` (2026-08-29)
- Lost-session recovery + name-based reclaim (30s idle gate) + removed the
  public `GET /api/games` join-code leak + fixed a silent schema-migration
  gap found while shipping this (2026-08-29)
- Instant click-feedback loader on every action, closes the double-submit
  path as a side effect (2026-08-29)
