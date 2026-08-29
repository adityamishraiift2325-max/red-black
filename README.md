# Red & Black

A two-player strategic bluffing card duel, played over the web with a standard
52-card deck. Red (♥ ♦) is **Offense**, Black (♠ ♣) is **Defense**. Build your
hand through forced swaps and blind challenges, then attack — if your offense
total beats your opponent's defense total you win instantly. If it doesn't, you
lose instantly.

**Live:** https://red-and-black.vercel.app

**New here?** This README covers rules, architecture and how to run the
project. For everything else — what's built vs. queued, why a rule works the
way it does, and the engineering standards this codebase follows — read these
three next, in this order:

1. [`CLAUDE.md`](CLAUDE.md) — standing engineering standards (how changes get
   made: scope confirmation, testing discipline, the deploy workflow).
2. [`docs/BACKLOG.md`](docs/BACKLOG.md) — what's shipped, what's queued next,
   in priority order.
3. [`docs/DECISIONS.md`](docs/DECISIONS.md) — the *why* behind rules that
   aren't obvious from the code alone (round-cap tie-breaks, the Joker's open
   questions, session-recovery design).

## The rules that matter

- **Hands are always 6 cards.** Every exchange is 1-for-1.
- **Swaps are forced.** You give your highest card of one colour; your opponent
  must surrender their highest of the opposite colour. They cannot refuse or
  substitute. If they hold none of that colour, they give their highest card
  overall.
- **Challenges are blind.** You name a card face down. Your opponent learns only
  its *colour*, never its value, then chooses:
  - **Accept** — both cards flip and are compared. **The defender wins ties.**
  - **Decline** — they concede without ever seeing your card, and still forfeit
    their highest card of the demanded colour.
- **The challenge winner takes the contested card and chooses what to hand back.**
  The loser must accept it. Declining is simply conceding.
- **Attacks are committed blind.** You are never shown the opponent's defense
  total before deciding. A tie loses for the attacker.
- **A round cap forces the issue.** Once both players have taken 8 preparation
  turns without either attacking, the game resolves itself: totals (offense +
  defense) are compared automatically, and a tie goes to whoever didn't move
  first. Nobody can stall a bluffing game forever. See `docs/DECISIONS.md` §
  Round cap for the exact formula.

## Architecture

```
public/          browser client — vanilla JS, native ES modules, no build step
  state.js         shared state, session persistence, DOM helpers
  api.js           fetch wrapper + durable client-error reporting
  cards.js         card rendering
  dialogs.js       drawer / waiting room / attack-confirm / result overlay
  actions.js       turn actions, the busy-loader, cap-countdown strip, render()
  main.js          button wiring + resume-an-interrupted-session on load
src/
  engine/        pure game rules — no I/O, no database
  models/        Card, Hand, Game, Challenge
  services/      one file per action; owns transactions
  controllers/   HTTP layer; resolves the caller's seat from their token
  routes/        thin bindings, one endpoint per action
  db/            libSQL client, schema, repository, integrity guard
test/            engine unit tests
api/index.js     Vercel serverless entrypoint
```

The engine is completely decoupled from storage: every action takes a state and
returns a **new** state, so the rules are testable in isolation.

The visual design is "Dusk Velvet" (plum-to-black ground, apricot accent,
Fraunces/Karla type) — see `docs/BACKLOG.md`'s Decided section for the exact
tokens if you're touching `public/styles.css`.

### Hidden information is enforced server-side

The UI hiding something is never the mechanism. A player's seat is derived
**only from a bearer token** issued when they claim it — the seat is never read
from the request body or path, so a client cannot ask for the other player's
hand. `Hand.redacted()` returns every opponent card face-down unconditionally.

### Deck integrity

Hands are stored as JSON, so SQL cannot prove a card exists in exactly one
place. `src/db/integrity.js` re-establishes that: after every mutation it
asserts all 52 card ids appear exactly once across both hands, the deck and the
discard — inside the same transaction, so a rule bug rolls back rather than
corrupting the game.

## Running locally

```bash
npm install
npm start          # or: npm run dev  (auto-restarts on file changes)
```

Opens on http://localhost:3000 using a local SQLite file at `data/redblack.db`
(gitignored — every clone gets its own, and it's a plain file you can delete
to reset). **No environment variables, no credentials, no access to anything
production needs.** This is deliberate — see `.env.example`.

To play a full game solo: open the app in two browser tabs (or one normal +
one incognito, so they don't share `localStorage`). Create a game in the
first tab, copy the room code, join with it in the second. `/dev.html` (below)
is the fastest way to see both hands and the log at once while you test.

```bash
npm test
```

Runs the engine's unit tests (`test/engine.test.js`) — 26 tests covering the
rules in isolation, no server or database involved. **These are necessary,
not sufficient** — CLAUDE.md standard #7 has the reasoning and four real bugs
that stayed green in this suite but broke a running server. Before calling
anything done, actually click through it in a browser.

## For collaborators (branches & PRs)

- Branch off `main`: `git checkout -b <your-name>/<short-description>`.
- Commit as you go — small, frequent commits are welcome.
- Open a PR back to `main` when a piece is ready; that's the merge point,
  not a direct push to `main`.
- **Deploying is out of scope for a branch.** `npx vercel --prod` moves the
  live production alias and needs credentials you won't have — don't run it.
  A plain `npx vercel` (no `--prod`) still won't work without those
  credentials either; test locally instead (see above), which needs none.
- Read `CLAUDE.md` before starting — in particular standard #8 (state
  assumptions/blast-radius before building a phase) and standard #7 (unit
  tests are necessary but not sufficient; verify against a running instance).
- If a change touches game rules, check `docs/DECISIONS.md` first — several
  rules have a specific, already-settled formula (round-cap tie-breaks,
  challenge-decline mechanics) that isn't obvious from reading the code cold.

## Deploying

*(Project owner only — see "For collaborators" above if you're on a branch.)*

Production uses [Turso](https://turso.tech) (hosted libSQL), because Vercel's
filesystem is ephemeral — a SQLite file on disk would not survive between
invocations.

Set two environment variables in Vercel:

| Variable | Value |
| --- | --- |
| `TURSO_DATABASE_URL` | `libsql://<db>-<org>.turso.io` |
| `TURSO_AUTH_TOKEN` | database token |

Then `npx vercel --prod`. The same client code handles both targets: with no
env vars it falls back to a local file.

## Developer inspector

`/dev.html` shows the full unredacted record of any game — both hands, the
hidden challenge cards, turn-by-turn detail and a live deck-integrity check.

> ⚠️ The inspector and `/api/debug/*` are currently **unauthenticated**. Anyone
> with the URL can read both players' hands. Fine for local testing; gate them
> before this is genuinely public.
