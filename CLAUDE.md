# Red & Black — engineering standards

Standing instructions for anything working in this repo. These are not
aspirational — every rule below was either already how this codebase is
built, or is a direct response to a real bug this session hit. Follow them by
default; deviating needs a reason, not a shortcut.

## 1. Small, single-purpose units — not literal microservices

The instinct behind "everything is a microservice, no one service doing a lot
of processing" is right, but the label is wrong in a way that would hurt if
taken literally. **Microservice** means network-separated, independently
deployable processes — that is NOT what this app should be, and building it
that way would actively undo two things already fought for:

- **Deck integrity depends on one process.** `integrity.js` asserts all 52
  cards are accounted for *inside the same database transaction* as the
  mutation, so a rule bug rolls back instead of corrupting the game. Split
  across network-separated services, that guarantee becomes a distributed
  transaction problem — a much harder, much slower thing to get right, for
  an app with two players and 52 cards.
- **We already paid a latency tax once for crossing a network boundary
  unnecessarily.** The Vercel↔Turso region mismatch turned one turn action
  into 20 sequential ~230ms round trips (4.6s). Deliberately introducing
  service-to-service network calls inside a single request would reintroduce
  that exact class of bug on purpose.

What we actually want, and already have: **narrow, single-responsibility
modules inside one deployable app**, each with an obvious job — the existing
`engine/` → `models/` → `services/` → `controllers/` → `routes/` layering.
`BurnService`, `SwapService`, `ChallengeService`, `AttackService` each own
exactly one action; none of them does the other's work. That's the
correct reading of "not one service doing a lot of processing" — small
*modules*, not small *deployments*. Keep splitting services this way.
Revisit true microservices only if a specific piece needs independent
scaling or a separate deploy cadence — neither is true here.

## 2. Comments explain WHY, not WHAT

A comment restating the code is waste (`// increment the counter` above
`count++`). A comment is worth writing when it captures something the code
alone can't: a rule being encoded, a decision that could look wrong out of
context, or a bug that would reappear if "fixed" the obvious way. Examples
already in this codebase, which is the bar:

```js
// A card only stays "known to the opponent" while it is still in that
// player's hand — once it moves or is discarded, drop the stale knowledge.
function pruneRevealed(state) { ... }
```

```js
// The engine validates FIRST, and only a legal move gets a turns row.
// Recording the turn up front would leave orphan rows and turn a rule
// violation into a constraint crash instead of a clean 409.
```

Every DB write that isn't self-explanatory from its name gets a comment
saying *what invariant it's protecting* or *what would break without it*.
Every redaction point (`Hand.redacted()`, the attack preview withholding the
opponent's total) gets a comment naming what it must never leak and why —
these are the lines a future edit is most likely to accidentally undo.

## 3. Logs are for a live instance; comments are for a reader of the source

These are different tools solving different problems — don't conflate them.
A comment helps someone reading the code. A log helps someone debugging a
*running* instance they can't attach a debugger to (which, on Vercel, is
every production request).

**Current gap, worth naming honestly:** this app has almost no structured
logging. `console.error` only fires in the global error handler. Add logging
at service boundaries as features are touched — one line per action, with
`gameId`, `seat`, `action`, and duration, and **never** hand contents or
tokens. Vercel's function log viewer is the tool for this; use it before
guessing at production behavior.

## 4. Frontend failures must be reported somewhere durable, not just flashed

`toast(e.message)` disappears after 3.8 seconds and is never seen again
unless the player happens to describe it to a developer in the moment. That
is not a reporting mechanism — implemented in this session as the first
concrete example of this standard: client-side failures now also POST to
`/api/client-errors` (fire-and-forget, never blocks the UI, never throws if
it itself fails) and are visible in `/dev.html` under **Client errors**. A
global `window.onerror` / `unhandledrejection` handler catches failures the
app's own `try/catch` never sees. See [ClientErrorService.js](src/services/ClientErrorService.js).

## 5. Identity comes from the server. Never trust it from the client.

A player's seat is resolved **only** from their bearer token
(`resolveCallerSeat`) — never from a `seat` field in the request body, path,
or query string. This is not a style preference; it's the entire reason the
opponent's hand can't be read. Any new feature that involves "which player
is this" (Joker color commitment, future ones) must derive it the same way.
Locking a UI element is cosmetic; this is the actual lock.

## 6. Every mutation defends its own invariants, in the same transaction

Deck integrity (52 cards, exactly once, across hands+deck+discard) is
asserted inside every `saveState` call, not just checked after the fact.
The pattern generalizes: if a feature introduces a new invariant (e.g. "the
shared Joker value must be identical across all four Joker cards" once
built), assert it in the same transaction as the write that could break it,
and let the assertion roll the transaction back. An invariant that's only
checked in a test, and not in the write path, will eventually be violated in
production and go unnoticed.

## 7. Green tests are not proof. Verify against a running instance.

Every one of these was missed by tests that still reported green, and only
caught by actually hitting a live server:
- the Attack button being a dead click (`window.confirm` silently returning
  `false` in an embedded browser — no test exercises a real dialog)
- `[hidden]` losing to a CSS `display: grid` rule (a DOM/CSS interaction, not
  a logic bug)
- a test asserting `status >= 400` passed on an actual 500 crash, masking a
  real bug (`turn_no` uniqueness violation from validating in the wrong
  order)
- the region-latency bug — nothing about it was a logic error; every unit
  and integration test passed throughout

Rule: unit tests (engine, `npm test`) prove the *rules* are right. They do
not prove the *deployed system* behaves right. Before calling anything done,
hit the actual running server (locally or in prod) and check real behavior —
including reading the server log, not just the response status.

## 8. Confirm scope before starting a phase — don't just start building

At the start of any build phase or backlog item (not every small edit —
a phase, not a one-line fix), stop and state back, in one short message:

- **Assumptions** — anywhere the spec has a gap and a call has to be made to
  proceed at all, name the call before making it.
- **Blast radius** — what else in the system this could touch: other screens
  that share the code being changed, other in-flight or queued backlog
  items, data that needs a migration, anything that was working before and
  might not be after.
- **Inputs still needed** — a decision only the user can make, content only
  they can supply, a credential, anything that would otherwise get invented
  or guessed mid-build.

Then **wait for an explicit go-ahead** before writing code. This is a
separate gate from standard #10 below — this one sits at the *start* of
work; #9 is the matching gate at the *finish*.

## 9. Report delivery when a phase finishes — what, how, and what it doesn't touch

The closing half of standard #8: a phase should be bounded by a checkpoint on
both sides, not just the finish line of "it works." When a phase or backlog
item is done — built, tested, committed — close it out with three things,
concretely, not as a restatement of the original plan:

- **What was covered** — the actual pieces shipped.
- **How, briefly** — the real approach taken, especially anywhere it
  deviated from the scope confirmed in standard #8 (a gap found mid-build, a
  decision made along the way).
- **What it doesn't affect** — explicit confirmation that the rest of
  `docs/BACKLOG.md` (standard #13) is still buildable as described. Actually
  check this, don't just assert it — if something DID change for a later
  item, say so and update that item's entry rather than leaving it stale.

Example of this working: the Phase 1 report named a bug standard #7 (green
tests aren't proof) predicts unit tests alone would miss — `log[log.length-1]`
breaking once round cap could append a second event — and confirmed Phase 2's
redesign scope was unaffected rather than silently assuming so.

## 10. Don't deploy on every message — batch, verify, wait for the go-ahead

Building a feature and shipping it to the live URL are two different
decisions. Default to: implement, test locally (unit tests + a real running
instance per rule 7), and **stop there**. Collect changes across a few
messages rather than pushing to production after each one. `git commit` is
fine to do as you go — it's local and reversible. `npx vercel --prod` (which
moves the live `red-and-black.vercel.app` alias) is not something to run
unprompted; wait for an explicit "ship it" / "deploy this."

If a preview is useful mid-development, `npx vercel` **without** `--prod`
creates a throwaway preview URL without touching the production alias —
prefer that over `--prod` when a live check is genuinely needed before the
batch is ready.

## 11. Decisions get written down at decision time

`docs/DECISIONS.md` is the running record of confirmed and open rule
questions, written as they're settled — not reconstructed from chat scrollback
later. When a design discussion in chat lands on something concrete, it goes
in that file before implementation starts, with open questions marked `OPEN`
explicitly rather than silently assumed.

## 12. Player-facing views never expose internals; admin gating is deferred, not forgotten

A player-facing view (the game screen, any player-visible log or history)
shows only game *content* — cards, moves, outcomes. Never function or
service names, table or column names, raw event payloads, or anything else
that reveals how the system works internally. That belongs exclusively to
the admin surface (`/dev.html`, `/api/debug/*`).

That admin surface currently has **no authentication** — an accepted,
explicit tradeoff for development speed, not an oversight. It stays
unauthenticated until this project has real auth or user roles; when that
exists, gating the admin namespace behind it is the natural next step. Don't
silently "fix" this by adding ad-hoc checks — track it as a real feature. See
`docs/DECISIONS.md` § Player-log vs admin-log segregation.

## 13. Design forward for the whole backlog, not just the current phase

When a phase touches the DB schema or the architecture, keep the *rest* of
`docs/BACKLOG.md` in mind while shaping it — not to build those items early,
but so landing one doesn't force a breaking change when a later one arrives.
Concrete, not abstract — the actual connections in this backlog right now:

- **Round cap's dual-attack resolution and Joker's open question** ("how
  does colour commitment work in a resolution with no single declaring
  player") are the same structural problem. Shape the round-cap resolution
  code with that in mind, even though Joker is two phases away.
- **The turn-tracking added for the new-card highlight (phase 1) is very
  likely the same data phase 4's player log needs** ("how did your hand
  change over the game"). Design it once, as something phase 4 can read
  directly, rather than building two separate turn-history mechanisms that
  drift apart.
- **The ES-module split (phase 2) exists partly for phases 4 and 5** — a
  color-picker prompt (Joker) and a log viewer (player log) are real new UI
  surfaces, much easier to add as new modules than as more functions crammed
  into one file.

If a phase's natural implementation would make a later, already-queued item
harder or require a migration to undo, that's worth a line in the
scope-confirmation from standard #8 — not a silent decision either way.

## 14. Track the build backlog; surface it when it changes, not on schedule

`docs/BACKLOG.md` holds what's confirmed-and-queued to build vs. already
shipped. Update it whenever an item is added, resolved, or moves in/out of
"blocked." Mention the current count/status back to the user when it changes
materially — a new item became ready, a batch is worth shipping — not
mechanically after every message. Always answer immediately if asked
directly.
