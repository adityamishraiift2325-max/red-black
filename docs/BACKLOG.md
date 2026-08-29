# Build backlog

Items whose design is settled enough to implement, tracked here so a "what's
left to push" status doesn't have to be reconstructed from chat scrollback.
Updated when the list changes — a new item lands, one gets built, or one
moves in/out of "blocked" — not mechanically after every message.

Companion to `docs/DECISIONS.md` (which holds *what a rule is*); this file
holds *what's queued to build*.

**Priority order below is the user's, set 2026-08-29.**

---

## 0. Awaiting a decision before anything else

**Pick a visual direction.** Four table skins built as working slices of the
real screen — Neon Arcade, Deco Parlour, Ink & Press, Dusk Velvet — published
as an artifact for review. The choice gates nothing technically (all four map
onto the same existing components), but picking before doing UI work avoids
building the same screens twice.

---

## 1. Round cap + always reveal your hand + new-card highlight

These three ship together as one batch.

- **Round cap — forced dual attack.** Max 8 prep turns each; auto-resolves by
  comparing total hand value; ties go to the second-mover. Fully specified.
  → `docs/DECISIONS.md` § Round cap
- **Always reveal your own hand.** Remove the "click to see your cards"
  toggle entirely (`revealBtn`, `state.revealed`). Seat isolation is enforced
  server-side, so hiding a player's hand from *themselves* was pure friction
  with zero security value. Client-side only: `public/app.js` (8 refs) +
  `public/index.html`.
- **NEW — highlight newly-acquired cards.** Any card that just entered your
  hand — drawn after a burn, received in a swap, or taken/given in a
  challenge — is visually marked for exactly one turn, so a player can see at
  a glance what changed without re-reading their whole hand. Clears on their
  next action. Mostly client-side, but note the data is already there and
  unused: `hand_json` carries a per-card `acquired` field
  (`deal`/`draw`/`swap`/`challenge`) that nothing currently reads. Likely
  needs one addition — a marker for *which turn* it was acquired — so "one
  turn only" can be computed rather than guessed. Shown in all four mockups
  as the `NEW` tag.

## 2. Mobile rendering fixes

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

## 3. Player-facing end-of-game log

A curated personal history at game end — what cards *you* played, how *your*
hand changed. Deliberately a new purpose-built read (seat-scoped via the
existing bearer-token pattern), NOT the admin inspector filtered down, so a
future edit to the rich admin dump can't accidentally widen what a player
sees. Never exposes function/service names, table/column names, or raw event
payloads. → `docs/DECISIONS.md` § Player-log vs admin-log segregation

`OPEN`: does it include the opponent's public actions too (a two-player
narrative naturally has two sides), or strictly the viewer's own moves?

## 4. Jack is Joker

Wildcard colour/value mechanic, colour-selection prompt on the owner whenever
a Joker is drawn into any action. Confirmed; 3 minor implementation-detail
assumptions flagged (do declarations persist across turns, is committing
optional at attack time, how the round cap resolves Joker commitment with no
single declaring player). → `docs/DECISIONS.md` § Jack is Joker

## 5. Tips and tricks (post-game coaching)

"What could this player have done better." Still the least specified item —
needs a real design pass before it's buildable: undefined what makes a
suggestion *correct* (simple rule-based heuristics like "you discarded a card
that would have satisfied a later swap demand," vs. something requiring
exploration of alternate lines of play, which is a materially bigger
problem). No design work done yet.

## Blocked / needs more discussion

*(nothing blocked — item 5 needs design, but nothing is waiting on an
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
