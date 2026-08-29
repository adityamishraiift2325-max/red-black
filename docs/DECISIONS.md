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

## Jack is Joker — 2026-08-29 (PARTIALLY CONFIRMED)

**Identity.** All four J cards lose their fixed suit-derived color and fixed
value 11. They become a genuine wildcard.

**Value.** Global, shared across all four Jokers — one number, not per-card.
Range 1–15 (so a Joker can beat an Ace(14) or lose to a 2). **Frozen for the
full duration of one logical turn** — a challenge is 3 API calls
(declare → respond → giveback) but 1 turn in the `turns` table, and the value
must not change mid-challenge. Re-rolls once per *completed* turn. Visible to
both players at all times (public, not per-viewer).

**Totals.** An uncommitted Joker sitting in a hand contributes **0** to both
offense and defense totals — it only counts once actively committed to a
color in some action.

**`OPEN` — color commitment mechanism.** The worked example
("i decide to defend with my J") revealed that defending-card selection in a
challenge can't stay fully automatic the way `Hand.highestOfType()` works
today — but whether that active-choice model:
- applies to challenge defense only, or also to forced swaps, and
- is even settled for challenge defense yet (vs. being re-opened entirely),

is **explicitly parked at the user's request** — not decided either way.

**`OPEN` — a gap found while writing this down, not yet raised with the
user.** The attacker gets a clear moment to commit a Joker's color: attack
declaration is a single explicit action, and "worth 0 until committed" means
the attacker must decide each held Joker's color right then to count it
toward their offense sum. But the **defender has no equivalent moment** in a
normal 1-on-1 attack — `declareAttack` is the attacker's call alone, nothing
prompts the defender. If a defender's Joker is worth 0 unless committed, and
they're never asked, does their Joker simply never count toward defense
unless committed earlier (e.g. via some other in-turn action)? Same question
applies to the round-cap forced dual-attack, where both players' totals
matter simultaneously and neither is "declaring" anything. **Needs a decision
before Joker's total-value effects can be implemented for anyone but the
active attacker.**

---
