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

## 1. Player-facing end-of-game log

A curated personal history at game end — what cards *you* played, how *your*
hand changed. Deliberately a new purpose-built read (seat-scoped via the
existing bearer-token pattern), NOT the admin inspector filtered down, so a
future edit to the rich admin dump can't accidentally widen what a player
sees. Never exposes function/service names, table/column names, or raw event
payloads. → `docs/DECISIONS.md` § Player-log vs admin-log segregation

`OPEN`: does it include the opponent's public actions too (a two-player
narrative naturally has two sides), or strictly the viewer's own moves?

## 2. Jack is Joker

Wildcard colour/value mechanic, colour-selection prompt on the owner whenever
a Joker is drawn into any action. Confirmed; 3 minor implementation-detail
assumptions flagged (do declarations persist across turns, is committing
optional at attack time, how the round cap resolves Joker commitment with no
single declaring player). → `docs/DECISIONS.md` § Jack is Joker

## 3. Tips and tricks (post-game coaching)

"What could this player have done better." Still the least specified item —
needs a real design pass before it's buildable: undefined what makes a
suggestion *correct* (simple rule-based heuristics like "you discarded a card
that would have satisfied a later swap demand," vs. something requiring
exploration of alternate lines of play, which is a materially bigger
problem). No design work done yet.

## Blocked / needs more discussion

*(nothing blocked — item 3 needs design, but nothing is waiting on an
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
- **Round cap + always reveal your hand + new-card highlight** (`56c290d`) —
  fires automatically from `endTurn()` once both players hit 8 prep turns,
  ties go to whoever didn't start; `revealBtn`/`state.revealed` removed
  entirely; new cards marked via `freshCards` and cleared on the owner's own
  next action (this also fixed `hand_json.acquired`, silently stuck at
  `'deal'` for every card since the Turso rewrite). Caught along the way: a
  completed round cap appends a *second* log event, which broke every
  service reading `log[log.length-1]` — the unit suite stayed green
  throughout, only an end-to-end test caught it; fixed with a `findEvent()`
  helper used by name, not position. **Deployed to production 2026-08-29**
  — live-verified: `styles.css`/`main.js` served correctly, a real game
  created and responded in 405ms confirming the `bom1` region pinning held.
- **Visual redesign (Dusk Velvet) + full copy pass + ES module split**
  (`f081a9a`) — `public/app.js` (605 lines) split into `state.js`, `api.js`,
  `cards.js`, `dialogs.js`, `actions.js`, `main.js`; every player-facing
  string replaced with the signed-off wording; new round-cap countdown strip.
  Also rewrote the two `DealService.js` error strings to match (flagged
  scope deviation — string-only, no logic change). **Deployed to production
  2026-08-29** alongside the item above — the live site had never actually
  received the round-cap deploy despite an earlier note saying it had; both
  shipped together in one `vercel --prod` after full live verification of
  every screen state against a local dev server.
- **Mobile rendering fixes** (`7277355`) — the three faults diagnosed
  against production (overlay scroll dead-end, top bar wrap, `100vh` vs.
  mobile chrome), plus 3 more the user found by screenshot: swap/burn/
  challenge/giveback buttons rendering edge-to-edge with zero gap (no
  `.selection-actions` container — see actions.js), and the card hand
  leaving a dead strip of space on the right whenever a row broke mid-width
  (`.hand` now a `repeat(auto-fill,minmax(74px,1fr))` grid instead of
  flex-wrap). Live-verified at 375×812, the exact 360×560 case the backlog
  cited (confirmed the previously-unreachable "Again" button is now
  scrollable into view), and a synthetic 900px-container test confirming
  desktop card sizing is unaffected. **Deployed to production 2026-08-30**
  — live-verified: `.selection-actions`/the card grid CSS confirmed serving
  from `red-and-black.vercel.app`, real API round trip still healthy.
- **Attack-unlocked countdown + margin-first result + auto-redirect**
  (`48afa60`) — the cap-countdown strip now shows from the instant
  `canAttack` flips true (5 turns out) instead of only the last 3; the
  result screen leads with a big margin number and "who had the better
  stat" claim, demoting the old raw-totals showdown box to a supporting
  role (round-cap ties skip the callout — no margin to lead with when a
  tie-break rule, not a number, decided it); and the result screen
  auto-redirects to the lobby 15s after it shows, reusing the "Again"
  button's own flow, cancels the moment either result-screen button is
  clicked. No backend change — margin/netMargin were already in the API,
  unused by the client. Live-verified against both a declared-attack win
  and a round-cap win (margin math checked against the raw totals both
  times), cancel-on-click confirmed via a real interval check (not just
  the label), and the full 15s natural expiry let run for real. **Not yet
  deployed** — holding for the go-ahead.
