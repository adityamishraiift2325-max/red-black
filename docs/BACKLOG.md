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

## 1. Attack-unlocked countdown + result-screen overhaul

Added 2026-08-29/30 from user feedback. Three pieces, two screens — the cap
countdown (a), and the result overlay getting both a margin-first rewrite
(b) and an auto-redirect (c) added a day later. Bundled into one phase.

**a) The cap countdown should start the moment attack unlocks, not just when
it's close.** Right now `renderCapWarning()` (`actions.js`) only shows the
strip once `turnsUntilCap <= 3`. The user wants it visible from the instant
`canAttack` becomes true — which is inherently 5 turns before the cap
(`MAX_PREP_TURNS(8) - REQUIRED_PREP_TURNS(3) = 5`), framed as "N chances
left to attack before both hands are forced open," not a countdown that
appears out of nowhere partway through. Concretely: swap the `<= 3`
threshold for "whenever `v.canAttack` is true" (derive the interval from the
same constants the engine already uses, not a hardcoded `5`, so it can't
drift if `MAX_PREP_TURNS` ever changes). `ASSUMPTION`: the wording scales
across the whole 5→1 range rather than switching registers partway (today's
"close" vs. "last turn" split) — worth confirming the exact copy before
building, not inventing it mid-build.

**b) Result screen should lead with the comparative claim and the margin,
not the raw totals.** Today's showdown box gives the two raw numbers (e.g.
"68" / "40") the most prominent typography on the screen; the user wants the
*margin* to carry that prominence instead — "You had the better hand — by
28" rather than two big totals a player has to subtract themselves. No
backend work needed: `finalReveal.attack.margin` (declared attacks) and
`finalReveal.attack.roundCap.netMargin` (round cap) are already in the API
payload, unused by the client. Client-only change: `showResult()` in
`dialogs.js` — lead with which stat won it ("better offense" for a declared
attack the attacker won, "better hand" for round cap, "better defense" for a
declared attack the defender held), make the margin number the visually
dominant one, and demote the two raw totals to a secondary/supporting role
rather than removing them (a bluffing game's post-mortem should still let a
player see the actual numbers if they want them).

**c) Auto-redirect off the result screen after 15 seconds.** Added
2026-08-30. Once the victory/defeat overlay shows, start a 15-second timer;
on expiry, take the player back to the lobby/new-game screen automatically
— the same destination `backBtn`/`againBtn` already send them to (client
routing only, no backend involved: the game record just sits `finished` in
the DB regardless of when either player navigates away). `ASSUMPTION`:
"new game screen" means the lobby (start-a-game / join-a-game screen), not
auto-creating a fresh game on the player's behalf — confirm before building
if that's wrong. Two things worth deciding at build time, not guessing:
- The timer should almost certainly be visible (a small "Returning to the
  lobby in Ns…" label in the established voice), not a silent surprise
  redirect — and should cancel if the player clicks either result-screen
  button (`reviewBtn`/`againBtn`) rather than firing on top of whatever they
  chose to do instead.
- Whether a player who wants to linger on the reveal gets any way to cancel
  it (e.g. a small "stay here" dismiss), or whether 15s is simply the
  screen's lifetime, full stop — a real product call, not obvious either
  way.

## 2. Player-facing end-of-game log

A curated personal history at game end — what cards *you* played, how *your*
hand changed. Deliberately a new purpose-built read (seat-scoped via the
existing bearer-token pattern), NOT the admin inspector filtered down, so a
future edit to the rich admin dump can't accidentally widen what a player
sees. Never exposes function/service names, table/column names, or raw event
payloads. → `docs/DECISIONS.md` § Player-log vs admin-log segregation

`OPEN`: does it include the opponent's public actions too (a two-player
narrative naturally has two sides), or strictly the viewer's own moves?

## 3. Jack is Joker

Wildcard colour/value mechanic, colour-selection prompt on the owner whenever
a Joker is drawn into any action. Confirmed; 3 minor implementation-detail
assumptions flagged (do declarations persist across turns, is committing
optional at attack time, how the round cap resolves Joker commitment with no
single declaring player). → `docs/DECISIONS.md` § Jack is Joker

## 4. Tips and tricks (post-game coaching)

"What could this player have done better." Still the least specified item —
needs a real design pass before it's buildable: undefined what makes a
suggestion *correct* (simple rule-based heuristics like "you discarded a card
that would have satisfied a later swap demand," vs. something requiring
exploration of alternate lines of play, which is a materially bigger
problem). No design work done yet.

## Blocked / needs more discussion

*(nothing blocked — item 4 needs design, but nothing is waiting on an
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
