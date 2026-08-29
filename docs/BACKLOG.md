# Build backlog

Items whose design is settled enough to implement, tracked here so a "what's
left to push" status doesn't have to be reconstructed from chat scrollback.
Updated when the list changes — a new item lands, one gets built, or one
moves in/out of "blocked" — not mechanically after every message.

Companion to `docs/DECISIONS.md` (which holds *what a rule is*); this file
holds *what's queued to build*.

---

## Ready to build (design settled, awaiting implementation + your go-ahead to ship)

1. **Round cap — forced dual attack.** Max 8 prep turns each; auto-resolves by
   comparing total hand value; ties go to the second-mover. Fully specified,
   zero open questions. → `docs/DECISIONS.md` § Round cap
2. **Jack is Joker.** Wildcard color/value mechanic, color-selection prompt on
   the owner whenever a Joker is drawn into any action. Confirmed; 3 minor
   implementation-detail assumptions flagged (do declarations persist across
   turns, is committing optional at attack time, how round-cap resolves
   Joker commitment with no single declaring player) — none block starting.
   → `docs/DECISIONS.md` § Jack is Joker
3. **Always reveal your own hand.** The "click to see your cards" toggle
   serves no purpose — seat isolation is already enforced server-side (a
   player's own view is fully redacted from the opponent regardless of this
   flag), so hiding a player's own hand FROM THEMSELVES was pure friction
   with zero security value. Remove `revealBtn` and `state.revealed`
   entirely: a player's dealt cards render face-up and their totals show the
   instant the table loads. Purely client-side — `public/app.js` (8
   references) and `public/index.html` (the button itself); no DB, API, or
   engine changes. Small, same shape as the click-feedback loader already
   shipped.
4. **Player-facing end-of-game log.** An option shown at game end to reveal
   a curated personal history — what cards *you* played, how *your* hand's
   state changed over the game. Deliberately narrow and NOT the admin
   inspector filtered down: a new purpose-built read (own `turns` +
   `hand_history` rows, seat-scoped via the same bearer-token pattern as
   everything else) so there's no "a future edit to the rich admin dump
   accidentally widens what a player sees" failure mode. Never shows
   function/service names, DB table or column names, or raw event payloads —
   see the segregation principle in `docs/DECISIONS.md`. Mostly specified;
   one open question before starting: does it include the opponent's public
   actions too (a two-player narrative naturally involves both sides), or
   strictly the viewing player's own moves as literally requested? Everything
   else needed (per-seat hand snapshots, per-turn action detail) already
   exists in the schema.

## Blocked / needs more discussion

- **Post-game tips/coaching.** "What could this player have done better to
  build a stronger hand." Explicitly called out as a separate item from the
  log above — do not conflate them. Needs a real design pass before it's
  buildable: undefined what makes a suggestion "correct" (simple rule-based
  heuristics like "you discarded a card that would have satisfied a later
  swap demand," vs. something that requires exploring alternate lines of
  play, which is a materially bigger problem). No design work done yet.

## Shipped

- Region pinning fix — function and Turso DB both in `bom1` (2026-08-29)
- Client-error reporting — `client_errors` table, `/dev.html` panel (2026-08-29)
- `CLAUDE.md` engineering standards + this backlog + `DECISIONS.md` (2026-08-29)
- Lost-session recovery + name-based reclaim (30s idle gate) + removed the
  public `GET /api/games` join-code leak + fixed a silent schema-migration
  gap found while shipping this (2026-08-29)
- Instant click-feedback loader on every action, closes the double-submit
  path as a side effect (2026-08-29)
