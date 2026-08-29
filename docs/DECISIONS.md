# Rule decisions log

Running record of game-rule decisions as they're confirmed, so a design
discussion in chat doesn't have to be re-derived later. Each entry is dated
and states what's confirmed vs. still open.

Format: **RULE** — confirmed behaviour. `OPEN:` unresolved questions blocking
implementation.

---

## Round cap (forced dual attack) — 2026-08-29

**Trigger.** `minPrepTurns` (3) is unchanged — attack becomes *optional* there,
same as today. A new `maxPrepTurns = 8` is a hard ceiling: once
`prepTurnsCompleted[0] >= 8 AND prepTurnsCompleted[1] >= 8`, the game
auto-resolves. No player declares anything — it fires as a side effect of the
16th turn completing.

**Resolution.** Both players are scored simultaneously:

```
netScore(P) = (P.offense − opponent.defense) + (P.defense − opponent.offense)
            = (P.offense + P.defense) − (opponent.offense + opponent.defense)
```

The cross-terms cancel, so this is equivalent to — and should be implemented
as — **comparing each player's total hand value (offense+defense summed)**.
Higher total wins. Confirmed against a worked example: P0 (22 off / 31 def,
total 53) beat P1 (25 off / 26 def, total 51).

**Ties.** Exact equal totals → **the player who did NOT start the game wins**
(`winnerSeat = opponentOf(startingSeat)`), the closest equivalent to
"defender wins ties" in a mechanic with no defender.

**Still to decide when this gets implemented:** whether the individual
attack/defend sub-results (e.g. "P0 loses their attack by 4, defends by 6")
get logged/displayed even though only the net matters for the outcome —
almost certainly yes, for the UI narrative and the `attacks` table, but not
yet nailed down as a schema shape.

---

## Jack is Joker — 2026-08-29 (CONFIRMED — one synthesis pass, see note)

**Identity.** All four J cards lose their fixed suit-derived color and fixed
value 11. They become a genuine wildcard.

**Value.** Global, shared across all four Jokers — one number, not per-card.
Range 1–15 (so a Joker can beat an Ace(14) or lose to a 2). **Frozen for the
full duration of one logical turn** — a challenge is 3 API calls
(declare → respond → giveback) but 1 turn in the `turns` table, and the value
must not change mid-challenge. Re-rolls once per *completed* turn. Visible to
both players at all times (public, not per-viewer).

**Color commitment — the resolved model.** Whenever a Joker is drawn into
*any* action — the owner attacking with it, playing it as their own challenge
card, or being pulled in as the "highest of type" candidate in a forced swap
or a challenge defense — **the card's owner is shown a selection prompt**
("offense or defense?") at that moment. This applies everywhere a Joker could
be involved, including forced swaps and forced challenge defense, not just
the actions a player initiates themselves. The chosen color is what makes it
eligible (or not) for whatever is being demanded, and is what makes it count
toward that owner's totals from that point on.

This resolves what looked like two conflicting signals in chat:
*"i decide to defend with my J"* — a real UI decision, not the engine silently
computing "highest of type." *"the person would have to exchange the Joker
for it"* — if the owner declares it as the demanded color and it's their
highest, it *is* the one taken; the "have to" is about the consequence of the
declaration, not about the declaration itself being automatic.

**Totals.** **0** while genuinely uncommitted (never yet drawn into any
action). Once played — meaning the owner has been through the selection
prompt for it, whether by their own initiative or because an opponent's
action pulled it in — it counts at its current value toward whichever side
was declared.

**Low-confidence points carried forward, not yet asked — flagging rather than
silently assuming:**
1. Does a color declaration persist for the rest of the game once made, or
   revert to undeclared the next time the card would be involved in
   something new? (E.g. declared red in turn 5 — if later demanded as
   "highest black" from the same hand, is it still eligible, having
   reverted?)
2. At attack declaration, is committing each held Joker to a color always
   *optional* for the attacker (they could choose to leave one uncommitted,
   worth 0, rather than take the value boost)? Assuming yes, since nothing
   suggests it's forced and "worth 0 until committed" implies committing is
   a choice.
3. The round-cap forced dual-attack has no "declaring player" at all — both
   totals matter simultaneously. Unclear how/when Joker commitment happens
   there; likely needs its own resolution step before the score comparison.

---

## Lost-session recovery (the back-button bug) — 2026-08-29 (CONFIRMED, BUILT)

**The bug.** A friend joined a room, hit the browser's back button, and could
never get back in. Root cause: the resume-on-load flow wiped the saved seat
token on *any* error, including a plain network blip — not just a genuine
"this token is dead" response. Once wiped, the seat was still occupied
server-side forever, so re-joining just reported the room full, with no
recovery path at all.

**Fix, part 1 — stop destroying valid sessions.** The client now only clears
a saved session on an actual 401 (the token genuinely no longer holds that
seat). Any other failure (network, 500) leaves the session alone and shows a
"could not reconnect, try reloading" message instead.

**Fix, part 2 — recovery when the browser's storage really is gone.**
Explicitly confirmed doable without accounts or passwords. The *existing*
join flow (room code + name) doubles as reclaim: if a seat is already taken
but the given name matches who holds it, that's treated as the same player
reconnecting, not a stranger — they get a fresh token for that seat, and the
old one dies immediately.

Gated by presence, not by knowledge alone: a seat is only reclaimable once it
has gone quiet for `RECLAIM_IDLE_SECONDS` (20s — well above the 2.5s client
poll, so an actively-playing seat's presence is always fresh and can never be
reclaimed out from under it). Explored and rejected: device/browser
fingerprinting as an alternative identifier — rejected because it would be
stored the same way the token already is and lost by the exact same failure
mode, so it doesn't actually solve anything the token recovery doesn't
already solve, and reliable fingerprinting isn't "easy" or fully honest
(browsers actively randomize against it).

**Residual, stated tradeoff:** anyone who knows both the room code and a name
already used in that room could reclaim an *idle* seat. For a casual game
among friends this is accepted as reasonable; it cannot kick an active
player under any circumstance.

**Related, found and fixed in the same pass:** `GET /api/games` publicly
listed every game including its `join_code` — the room's password — to
anyone who called it, unused by the current client. Removed entirely; admin
visibility remains via `/api/debug/games`.

---
