# Red & Black

A two-player strategic bluffing card duel, played over the web with a standard
52-card deck. Red (♥ ♦) is **Offense**, Black (♠ ♣) is **Defense**. Build your
hand through forced swaps and blind challenges, then attack — if your offense
total beats your opponent's defense total you win instantly. If it doesn't, you
lose instantly.

**Live:** https://red-and-black.vercel.app

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

## Architecture

```
public/          browser client (vanilla JS, no build step)
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
npm start
```

Opens on http://localhost:3000 using a local SQLite file at `data/redblack.db`.
No configuration needed.

```bash
npm test
```

## Deploying

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
