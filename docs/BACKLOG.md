# Build backlog

Items whose design is settled enough to implement, tracked here so a "what's
left to push" status doesn't have to be reconstructed from chat scrollback.
Updated when the list changes — a new item lands, one gets built, or one
moves in/out of "blocked" — not mechanically after every message.

Companion to `docs/DECISIONS.md` (which holds *what a rule is*); this file
holds *what's queued to build*.

---

## Built & tested locally — awaiting your go-ahead to ship

**Lost-session recovery.** Fixes the real bug hit while testing (friend's
   back-button navigation locked them out permanently). Two parts: the
   client no longer destroys a valid session on a transient error (only on a
   genuine 401), and a room-code + matching-name rejoin lets a player reclaim
   their seat if their browser's storage is truly gone, gated to only work
   once that seat has been idle 20+ seconds so it can never interrupt an
   active player. Also removed the public `GET /api/games` listing found
   while working in this area — it leaked every game's join code (the room's
   password) to anyone who asked. 18/18 engine tests, 32/32 multi-player
   checks, plus a live end-to-end repro of the original bug through the real
   UI. → `docs/DECISIONS.md` § Lost-session recovery

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
3. **Instant click-feedback UI.** Action buttons switch to a visibly "pending"
   state the instant they're clicked (before the network round trip), so a
   click never looks like it didn't register. Frontend-only, no DB/API
   changes. Fully specified.

## Blocked / needs more discussion

*(none currently)*

## Shipped

- Region pinning fix — function and Turso DB both in `bom1` (2026-08-29)
- Client-error reporting — `client_errors` table, `/dev.html` panel (2026-08-29)
- `CLAUDE.md` engineering standards + this backlog + `DECISIONS.md` (2026-08-29)
