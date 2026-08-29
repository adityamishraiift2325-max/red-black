-- ===========================================================================
-- RED & BLACK — schema
-- ---------------------------------------------------------------------------
-- Storage model:
--   * `cards` is the immutable catalog of 52 identities (AC, 10S, KH ...).
--   * A player's CURRENT HAND is one row in `player_hands`, held as JSON keyed
--     by card id. Two rows exist per game — one per player — created at the
--     deal and UPDATED IN PLACE on every burn / swap / challenge.
--   * The opening deal is copied once into `initial_deals` and never touched,
--     so the starting position is always recoverable.
--   * The deck and discard live in `game_piles` as ordered id arrays.
--
-- Because hands are JSON, the "one card in one place" rule cannot be enforced
-- by SQL constraints. The service layer asserts it after every mutation
-- (see integrity.js) — all 52 ids present exactly once across hands + deck +
-- discard, or the transaction is rolled back.
-- ===========================================================================


-- ===========================================================================
-- REFERENCE
-- ===========================================================================

-- The 52 physical cards. Seeded once at migration; never mutated.
CREATE TABLE IF NOT EXISTS cards (
    id     TEXT PRIMARY KEY,                              -- 'AC', '10S', 'KH'
    rank   TEXT NOT NULL,                                 -- '2'..'10','J','Q','K','A'
    suit   TEXT NOT NULL CHECK (suit IN ('H','D','S','C')),
    value  INTEGER NOT NULL CHECK (value BETWEEN 2 AND 14),
    type   TEXT NOT NULL CHECK (type IN ('red','black'))  -- red=Offense, black=Defense
);


-- ===========================================================================
-- IDENTITY
-- ===========================================================================

CREATE TABLE IF NOT EXISTS players (
    id           TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ===========================================================================
-- GAME STATE
-- ===========================================================================

CREATE TABLE IF NOT EXISTS games (
    id              TEXT PRIMARY KEY,
    -- 'lobby' = dealt, but the second seat is still open and no turn may be
    -- taken until someone joins.
    status          TEXT NOT NULL DEFAULT 'lobby'
                    CHECK (status IN ('lobby','preparing','awaiting_resolution','finished')),
    join_code       TEXT UNIQUE,          -- short, shareable form of the game id
    current_seat    INTEGER CHECK (current_seat IN (0,1)),
    starting_seat   INTEGER NOT NULL CHECK (starting_seat IN (0,1)),
    winner_seat     INTEGER CHECK (winner_seat IN (0,1)),
    turn_no         INTEGER NOT NULL DEFAULT 0,
    hand_size       INTEGER NOT NULL DEFAULT 6,
    min_prep_turns  INTEGER NOT NULL DEFAULT 3,
    rng_seed        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);

-- The two seats of a game. A NULL player_id is an OPEN seat: the game id is
-- the room code, and the second player claims the free seat by entering it.
--
-- seat_token is the bearer secret proving "I am this seat". It is issued once
-- when the seat is claimed and never leaves that player's browser. The API
-- checks it before returning a hand, so one player physically cannot fetch
-- the other's cards — locking the UI toggle alone would be cosmetic.
CREATE TABLE IF NOT EXISTS game_seats (
    game_id              TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    seat                 INTEGER NOT NULL CHECK (seat IN (0,1)),
    player_id            TEXT REFERENCES players(id),
    player_name          TEXT,
    seat_token           TEXT,
    prep_turns_completed INTEGER NOT NULL DEFAULT 0,   -- gates the attack action
    joined_at            TEXT,
    PRIMARY KEY (game_id, seat)
);

CREATE INDEX IF NOT EXISTS idx_seat_token ON game_seats(seat_token);

-- --------------------------------------------------------------------------
-- PRIMARY TABLE: one row per player per game holding their CURRENT hand.
-- Exactly two rows are written at the deal, then updated in place each turn.
--
-- hand_json is an object keyed by card id, each card carrying its own state:
--   {
--     "AC":  { "slot": 1, "revealed": false, "acquired": "deal"      },
--     "10S": { "slot": 2, "revealed": true,  "acquired": "challenge" },
--     ...
--   }
-- Keying by card id makes a duplicate within a hand structurally impossible.
--   slot     - stable display position, so the UI does not reshuffle on render
--   revealed - opponent has seen this card (public swap / challenge reveal)
--   acquired - deal | draw | swap | challenge  (provenance, for the UI feed)
--
-- `version` increments on every write and is used for optimistic locking, so
-- two clients acting at once cannot silently overwrite each other.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_hands (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id     TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    seat        INTEGER NOT NULL CHECK (seat IN (0,1)),
    player_id   TEXT REFERENCES players(id),
    hand_json   TEXT NOT NULL,
    card_count  INTEGER NOT NULL CHECK (card_count >= 0),
    version     INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (game_id, seat)          -- exactly one current hand per player
);

CREATE INDEX IF NOT EXISTS idx_player_hands_game ON player_hands(game_id);

-- The opening deal, written once and never updated. Keeps the starting
-- position auditable no matter how far the game has progressed.
CREATE TABLE IF NOT EXISTS initial_deals (
    game_id   TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    seat      INTEGER NOT NULL CHECK (seat IN (0,1)),
    hand_json TEXT NOT NULL,     -- the six cards as dealt
    dealt_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (game_id, seat)
);

-- Deck and discard as ordered arrays of card ids: ["7H","QS",...].
-- deck_json[0] is the next card to be drawn.
CREATE TABLE IF NOT EXISTS game_piles (
    game_id      TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    deck_json    TEXT NOT NULL DEFAULT '[]',
    discard_json TEXT NOT NULL DEFAULT '[]',
    deck_count   INTEGER NOT NULL DEFAULT 0,
    version      INTEGER NOT NULL DEFAULT 1,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A challenge resolves in two steps. This parks the outstanding obligation so
-- a game survives a server restart mid-challenge.
-- PRIMARY KEY on game_id => at most one obligation per game.
CREATE TABLE IF NOT EXISTS pending_actions (
    game_id      TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    turn_id      INTEGER REFERENCES turns(id) ON DELETE CASCADE,
    -- challenge_response: the defender owes an accept/decline.
    -- winner_giveback   : the challenge winner owes a card of their choosing.
    type         TEXT NOT NULL CHECK (type IN ('challenge_response','winner_giveback')),
    actor_seat   INTEGER NOT NULL CHECK (actor_seat IN (0,1)),
    context_json TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ===========================================================================
-- HISTORY  (append-only: replay, audit, post-game analysis)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS turns (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id        TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    turn_no        INTEGER NOT NULL,
    seat           INTEGER NOT NULL CHECK (seat IN (0,1)),
    action         TEXT NOT NULL CHECK (action IN ('burn_draw','swap','challenge','attack')),
    status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','complete')),
    counts_as_prep INTEGER NOT NULL DEFAULT 1 CHECK (counts_as_prep IN (0,1)),
    started_at     TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at   TEXT,
    UNIQUE (game_id, turn_no)
);

CREATE INDEX IF NOT EXISTS idx_turns_game ON turns(game_id, turn_no);

-- Snapshot of both hands after every completed turn. Cheap at 6 cards each,
-- and it makes "show me the board at turn 7" a single indexed lookup.
CREATE TABLE IF NOT EXISTS hand_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    turn_no    INTEGER NOT NULL,
    seat       INTEGER NOT NULL CHECK (seat IN (0,1)),
    hand_json  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (game_id, turn_no, seat)
);

CREATE TABLE IF NOT EXISTS burns (
    turn_id           INTEGER PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
    game_id           TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    seat              INTEGER NOT NULL,
    discarded_card_id TEXT NOT NULL REFERENCES cards(id),
    drawn_card_id     TEXT NOT NULL REFERENCES cards(id),
    reshuffled        INTEGER NOT NULL DEFAULT 0
);

-- Swaps are FORCED — no accept/decline columns, because there is no choice.
CREATE TABLE IF NOT EXISTS swaps (
    turn_id            INTEGER PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
    game_id            TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    initiator_seat     INTEGER NOT NULL CHECK (initiator_seat IN (0,1)),
    opponent_seat      INTEGER NOT NULL CHECK (opponent_seat IN (0,1)),
    declared_type      TEXT NOT NULL CHECK (declared_type IN ('red','black')),
    initiator_card_id  TEXT NOT NULL REFERENCES cards(id),  -- given away
    opponent_card_id   TEXT NOT NULL REFERENCES cards(id),  -- surrendered
    initiator_fallback INTEGER NOT NULL DEFAULT 0,  -- held none of the type
    opponent_fallback  INTEGER NOT NULL DEFAULT 0
);

-- A challenge runs in three steps and this row is written once, then UPDATEd
-- as each step lands:
--
--   1. DECLARE  challenger_card_id is stored but is NOT disclosed to the
--               defender — only challenge_card_type (the colour) is. The row
--               sits with response = NULL, awaiting the defender.
--   2. RESPOND  accepted  -> both cards flip, values compared, defender wins ties
--               declined  -> defender concedes WITHOUT ever seeing the card and
--                            still forfeits their highest card of required_type
--               (auto_surrender when the defender held none of that type)
--   3. GIVEBACK the winner returns a card of their own choosing.
--
-- challenge_card_revealed stays 0 on a declined challenge — that is the record
-- of the bluff having worked, and the UI must keep the card hidden forever.
CREATE TABLE IF NOT EXISTS challenges (
    turn_id                 INTEGER PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
    game_id                 TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    challenger_seat         INTEGER NOT NULL CHECK (challenger_seat IN (0,1)),
    defender_seat           INTEGER NOT NULL CHECK (defender_seat IN (0,1)),

    -- step 1: the declaration
    challenger_card_id      TEXT NOT NULL REFERENCES cards(id),  -- server-side truth
    challenge_card_type     TEXT NOT NULL CHECK (challenge_card_type IN ('red','black')),
    required_type           TEXT NOT NULL CHECK (required_type IN ('red','black')),
    declared_at             TEXT NOT NULL DEFAULT (datetime('now')),

    -- step 2: the response (all NULL until the defender acts)
    response                TEXT CHECK (response IN ('accepted','declined','auto_surrender')),
    defender_card_id        TEXT REFERENCES cards(id),
    challenger_value        INTEGER,   -- NULL when declined: no comparison happened
    defender_value          INTEGER,
    was_tie                 INTEGER NOT NULL DEFAULT 0,
    challenge_card_revealed INTEGER NOT NULL DEFAULT 0,
    winner_seat             INTEGER CHECK (winner_seat IN (0,1)),
    loser_seat              INTEGER CHECK (loser_seat IN (0,1)),
    contested_card_id       TEXT REFERENCES cards(id),  -- card the winner took

    -- step 3: the giveback, chosen by the winner
    giveback_card_id        TEXT REFERENCES cards(id),
    giveback_by_seat        INTEGER CHECK (giveback_by_seat IN (0,1)),
    responded_at            TEXT,
    resolved_at             TEXT
);

CREATE INDEX IF NOT EXISTS idx_challenges_game ON challenges(game_id);

CREATE TABLE IF NOT EXISTS attacks (
    turn_id            INTEGER PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
    game_id            TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    attacker_seat      INTEGER NOT NULL CHECK (attacker_seat IN (0,1)),
    defender_seat      INTEGER NOT NULL CHECK (defender_seat IN (0,1)),
    offense_total      INTEGER NOT NULL,   -- sum of attacker's red cards
    defense_total      INTEGER NOT NULL,   -- sum of defender's black cards
    attacker_won       INTEGER NOT NULL,   -- strictly greater to win
    winner_seat        INTEGER NOT NULL CHECK (winner_seat IN (0,1)),
    attacker_hand_json TEXT NOT NULL,
    defender_hand_json TEXT NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ordered event stream driving the UI feed and full-game replay.
CREATE TABLE IF NOT EXISTS events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id      TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    seq          INTEGER NOT NULL,
    event_type   TEXT NOT NULL,
    actor_seat   INTEGER CHECK (actor_seat IN (0,1)),
    -- Visibility of this event: 'public' both players see it, otherwise only
    -- the named seat does. Lets the API build a per-player feed with one query.
    visibility   TEXT NOT NULL DEFAULT 'public'
                 CHECK (visibility IN ('public','seat_0','seat_1')),
    payload_json TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (game_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_events_game ON events(game_id, seq);

-- Frontend failures, reported by the browser itself. A toast that disappears
-- after a few seconds is not a reporting mechanism — nothing durable was
-- capturing what actually went wrong for a player. game_id/seat are nullable
-- because a failure can happen before either exists (e.g. a failed join).
CREATE TABLE IF NOT EXISTS client_errors (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id    TEXT,
    seat       INTEGER CHECK (seat IS NULL OR seat IN (0,1)),
    context    TEXT,              -- what the player was doing: 'burn', 'join', 'unhandled', ...
    message    TEXT NOT NULL,
    stack      TEXT,
    url        TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_client_errors_game ON client_errors(game_id);
CREATE INDEX IF NOT EXISTS idx_client_errors_created ON client_errors(created_at);


-- ===========================================================================
-- VIEWS
-- ===========================================================================

-- Flattens hand_json back into one row per card, joined to the catalog.
-- Lets SQL query hands even though they are stored as JSON.
CREATE VIEW IF NOT EXISTS v_hands AS
SELECT ph.game_id,
       ph.seat,
       j.key                                   AS card_id,
       c.rank, c.suit, c.value, c.type,
       json_extract(j.value, '$.slot')         AS slot,
       json_extract(j.value, '$.revealed')     AS revealed,
       json_extract(j.value, '$.acquired')     AS acquired
  FROM player_hands ph,
       json_each(ph.hand_json) j
  JOIN cards c ON c.id = j.key;

-- Live offense/defense totals — the numbers an attack is judged on.
CREATE VIEW IF NOT EXISTS v_seat_totals AS
SELECT game_id,
       seat,
       COUNT(*)                                                AS card_count,
       COALESCE(SUM(CASE WHEN type='red'   THEN value END), 0) AS offense_total,
       COALESCE(SUM(CASE WHEN type='black' THEN value END), 0) AS defense_total
  FROM v_hands
 GROUP BY game_id, seat;
