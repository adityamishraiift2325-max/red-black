// Repository layer: maps engine state <-> database rows.
// Fully async — every call goes through the libSQL client, so the same code
// runs against a local file and against Turso in production.

const crypto = require('crypto');
const db = require('./client');
const { makeCard } = require('../engine/cards');
const { assertDeckIntegrity } = require('./integrity');

/* ── hand <-> hand_json ─────────────────────────────────────────────── */

/**
 * `freshMap` is { cardId: how } for cards that arrived since this player last
 * acted — the engine's freshCards.
 *
 * Note on `acquired`: it records how a card arrived only while it is still
 * NEW. Once the highlight expires it resets to 'deal'. It is deliberately not
 * a permanent provenance log — the events and turns tables already record
 * every card movement exactly, and that is what the phase-4 player log should
 * read. Keeping a second, weaker history here would just be a thing to drift.
 */
function handToJson(cards, revealedIds = [], freshMap = {}) {
    const revealed = new Set(revealedIds);
    const fresh = freshMap || {};
    const out = {};
    cards.forEach((c, i) => {
        out[c.id] = {
            slot: i + 1,
            revealed: revealed.has(c.id),
            isNew: Object.prototype.hasOwnProperty.call(fresh, c.id),
            acquired: fresh[c.id] || 'deal',
        };
    });
    return out;
}

function jsonToHand(handJson) {
    const obj = typeof handJson === 'string' ? JSON.parse(handJson) : handJson;
    return Object.entries(obj)
        .sort((a, b) => a[1].slot - b[1].slot)
        .map(([id]) => makeCard(id.slice(-1), id.slice(0, -1)));
}

const idToCard = (id) => makeCard(id.slice(-1), id.slice(0, -1));

/* ── SQL ────────────────────────────────────────────────────────────── */

const SQL = {
    insertGame: `INSERT INTO games (id,join_code,status,current_seat,starting_seat,turn_no)
                 VALUES (?,?,?,?,?,0)`,
    updateGame: `UPDATE games SET status=?, current_seat=?, winner_seat=?, turn_no=?,
                 finished_at=?, updated_at=datetime('now') WHERE id=?`,
    getGame: `SELECT * FROM games WHERE id=?`,
    getGameByCode: `SELECT * FROM games WHERE join_code=?`,
    // No public "list every game" query anymore — it leaked join_code, the
    // room's password, to anyone who called it. Admin visibility is
    // DebugService.listGames instead (separate, deliberately unauthenticated
    // per the existing /api/debug/* policy, not exposed as /api/games).

    insertSeat: `INSERT INTO game_seats (game_id,seat,player_id,player_name,seat_token,joined_at)
                 VALUES (?,?,?,?,?,?)`,
    claimSeat: `UPDATE game_seats SET player_name=?, seat_token=?, joined_at=datetime('now')
                WHERE game_id=? AND seat=? AND seat_token IS NULL`,
    // Reclaim: same seat, same name, a FRESH token — the old one (wherever
    // it's stranded) stops working the instant this runs, so only one
    // browser ever holds a live token for a seat at a time.
    reclaimSeat: `UPDATE game_seats SET seat_token=? WHERE game_id=? AND seat=?`,
    touchSeat: `UPDATE game_seats SET last_seen_at=datetime('now') WHERE game_id=? AND seat_token=?`,
    updateSeatPrep: `UPDATE game_seats SET prep_turns_completed=? WHERE game_id=? AND seat=?`,
    getSeats: `SELECT * FROM game_seats WHERE game_id=? ORDER BY seat`,
    getSeatByToken: `SELECT * FROM game_seats WHERE game_id=? AND seat_token=?`,

    insertHand: `INSERT INTO player_hands (game_id,seat,player_id,hand_json,card_count)
                 VALUES (?,?,?,?,?)`,
    updateHand: `UPDATE player_hands SET hand_json=?, card_count=?, version=version+1,
                 updated_at=datetime('now') WHERE game_id=? AND seat=?`,
    getHands: `SELECT * FROM player_hands WHERE game_id=? ORDER BY seat`,
    getHand: `SELECT * FROM player_hands WHERE game_id=? AND seat=?`,

    insertDeal: `INSERT INTO initial_deals (game_id,seat,hand_json) VALUES (?,?,?)`,

    insertPiles: `INSERT INTO game_piles (game_id,deck_json,discard_json,deck_count)
                  VALUES (?,?,?,?)`,
    updatePiles: `UPDATE game_piles SET deck_json=?, discard_json=?, deck_count=?,
                  version=version+1, updated_at=datetime('now') WHERE game_id=?`,
    getPiles: `SELECT * FROM game_piles WHERE game_id=?`,

    nextTurnNo: `SELECT COALESCE(MAX(turn_no),0)+1 AS n FROM turns WHERE game_id=?`,
    insertTurn: `INSERT INTO turns (game_id,turn_no,seat,action,status,completed_at)
                 VALUES (?,?,?,?,?,?)`,
    completeTurn: `UPDATE turns SET status='complete', completed_at=datetime('now') WHERE id=?`,

    insertHandHistory: `INSERT INTO hand_history (game_id,turn_no,seat,hand_json)
                        VALUES (?,?,?,?) ON CONFLICT DO NOTHING`,

    insertPending: `INSERT INTO pending_actions (game_id,turn_id,type,actor_seat,context_json)
                    VALUES (?,?,?,?,?)
                    ON CONFLICT(game_id) DO UPDATE SET turn_id=excluded.turn_id,
                      type=excluded.type, actor_seat=excluded.actor_seat,
                      context_json=excluded.context_json`,
    clearPending: `DELETE FROM pending_actions WHERE game_id=?`,
    getPending: `SELECT * FROM pending_actions WHERE game_id=?`,

    insertBurn: `INSERT INTO burns (turn_id,game_id,seat,discarded_card_id,drawn_card_id,reshuffled)
                 VALUES (?,?,?,?,?,?)`,
    insertSwap: `INSERT INTO swaps (turn_id,game_id,initiator_seat,opponent_seat,declared_type,
                 initiator_card_id,opponent_card_id,initiator_fallback,opponent_fallback)
                 VALUES (?,?,?,?,?,?,?,?,?)`,
    insertAttack: `INSERT INTO attacks (turn_id,game_id,resolution_kind,attacker_seat,defender_seat,
                   offense_total,defense_total,attacker_won,winner_seat,
                   attacker_hand_json,defender_hand_json)
                   VALUES (?,?,'declared',?,?,?,?,?,?,?,?)`,
    insertRoundCap: `INSERT INTO attacks (turn_id,game_id,resolution_kind,attacker_seat,defender_seat,
                   offense_total,defense_total,attacker_won,winner_seat,
                   seat0_total,seat1_total,net_margin,was_tie,
                   attacker_hand_json,defender_hand_json)
                   VALUES (?,?,'round_cap',?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(turn_id) DO NOTHING`,

    insertEvent: `INSERT INTO events (game_id,seq,event_type,actor_seat,visibility,payload_json)
                  VALUES (?,?,?,?,?,?)`,
    nextSeq: `SELECT COALESCE(MAX(seq),0)+1 AS n FROM events WHERE game_id=?`,
    getEvents: `SELECT * FROM events WHERE game_id=? ORDER BY seq`,
};

/* ── integrity ──────────────────────────────────────────────────────── */

function snapshotOf(state) {
    return {
        hands: {
            0: Object.fromEntries(state.hands[0].map((c) => [c.id, {}])),
            1: Object.fromEntries(state.hands[1].map((c) => [c.id, {}])),
        },
        deck: state.deck.map((c) => c.id),
        discard: state.discard.map((c) => c.id),
    };
}

/* ── creation & joining ─────────────────────────────────────────────── */

/** Short, unambiguous room code (no 0/O/1/I). */
function makeJoinCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () =>
        alphabet[crypto.randomInt(alphabet.length)]).join('');
}

const newToken = () => crypto.randomBytes(24).toString('hex');

/**
 * Deals a game and seats the creator. The second seat is left OPEN — the game
 * id / join code is the room, and the opponent claims seat 1 later.
 */
async function createGame(state, { hostName, hostSeat = 0 }) {
    assertDeckIntegrity(snapshotOf(state), 'deal');
    const id = crypto.randomUUID();
    const joinCode = makeJoinCode();
    const hostToken = newToken();

    await db.transaction(async (tx) => {
        await tx.run(SQL.insertGame, [id, joinCode, 'lobby', state.currentPlayer, state.currentPlayer]);

        for (const seat of [0, 1]) {
            const isHost = seat === hostSeat;
            await tx.run(SQL.insertSeat, [
                id, seat, null,
                isHost ? hostName : null,
                isHost ? hostToken : null,
                isHost ? new Date().toISOString() : null,
            ]);
            const hj = JSON.stringify(handToJson(state.hands[seat]));
            await tx.run(SQL.insertHand, [id, seat, null, hj, state.hands[seat].length]);
            await tx.run(SQL.insertDeal, [id, seat, hj]);
            await tx.run(SQL.insertHandHistory, [id, 0, seat, hj]);
        }

        await tx.run(SQL.insertPiles, [
            id, JSON.stringify(state.deck.map((c) => c.id)),
            JSON.stringify(state.discard.map((c) => c.id)), state.deck.length,
        ]);
        await tx.run(SQL.insertEvent, [id, 1, 'game_created', hostSeat, 'public',
            JSON.stringify({ hostName, hostSeat })]);
    });

    return { gameId: id, joinCode, seat: hostSeat, token: hostToken };
}

/**
 * Claims the open seat. Returns the joiner's seat and token, or throws if the
 * game is full or missing.
 */
// A seat is reclaimable-by-name only once it has gone quiet this long. Well
// above the client's 2.5s poll interval, so an active browser's last_seen_at
// is always fresh and can never be reclaimed out from under it — only a
// genuinely disconnected seat (closed tab, dead battery, lost storage after
// a back-button navigation) becomes eligible. See docs/DECISIONS.md.
const RECLAIM_IDLE_SECONDS = 30;

function secondsSince(isoUtc) {
    if (!isoUtc) return Infinity; // never seen a request from this seat -> treat as idle
    return (Date.now() - new Date(isoUtc + 'Z').getTime()) / 1000;
}

async function joinGame(gameIdOrCode, playerName) {
    const game = await db.get(SQL.getGame, [gameIdOrCode])
        || await db.get(SQL.getGameByCode, [String(gameIdOrCode).toUpperCase()]);
    if (!game) return { error: 'not_found' };

    const seats = await db.all(SQL.getSeats, [game.id]);
    const open = seats.find((s) => s.seat_token === null);

    if (open) {
        const token = newToken();
        const res = await db.run(SQL.claimSeat, [playerName, token, game.id, open.seat]);
        if (res.rowsAffected === 0) return { error: 'full' }; // lost the race to another joiner

        // Both seats filled: the game may now begin.
        await db.run(SQL.updateGame, [
            'preparing', game.current_seat, game.winner_seat, game.turn_no, null, game.id,
        ]);
        const seq = (await db.get(SQL.nextSeq, [game.id])).n;
        await db.run(SQL.insertEvent, [game.id, seq, 'player_joined', open.seat, 'public',
            JSON.stringify({ name: playerName, seat: open.seat })]);

        return { gameId: game.id, joinCode: game.join_code, seat: open.seat, token };
    }

    // No open seat. Is this the ORIGINAL occupant coming back — not a fresh
    // player, but the same one, reconnecting from a browser that lost its
    // token (a back-button navigation, cleared storage, a different device)?
    // No accounts, no passwords: the room code plus the name they used
    // before is the entire recovery mechanism, deliberately gated by
    // RECLAIM_IDLE_SECONDS so it can only ever reclaim a silent seat.
    const wanted = String(playerName || '').trim().toLowerCase();
    const match = wanted && seats.find(
        (s) => s.player_name && s.player_name.trim().toLowerCase() === wanted);
    if (!match) return { error: 'full' };

    const idleFor = secondsSince(match.last_seen_at);
    if (idleFor < RECLAIM_IDLE_SECONDS) {
        return { error: 'seat_active', retryAfterSeconds: Math.ceil(RECLAIM_IDLE_SECONDS - idleFor) };
    }

    const token = newToken();
    await db.run(SQL.reclaimSeat, [token, game.id, match.seat]);
    const seq = (await db.get(SQL.nextSeq, [game.id])).n;
    await db.run(SQL.insertEvent, [game.id, seq, 'player_reclaimed', match.seat, 'public',
        JSON.stringify({ name: match.player_name, seat: match.seat, idleForSeconds: Math.round(idleFor) })]);

    return { gameId: game.id, joinCode: game.join_code, seat: match.seat, token, reclaimed: true };
}

/**
 * Resolves a bearer token to its seat. This is the authorisation check.
 * Also touches last_seen_at (fire-and-forget — must never slow down or fail
 * the actual request) so the reclaim-idle-gate above reflects real presence.
 */
async function seatForToken(gameId, token) {
    if (!token) return null;
    const row = await db.get(SQL.getSeatByToken, [gameId, token]);
    if (row) db.run(SQL.touchSeat, [gameId, token]).catch(() => {});
    return row ? row.seat : null;
}

async function getSeats(gameId) { return db.all(SQL.getSeats, [gameId]); }
async function getGame(gameId) { return db.get(SQL.getGame, [gameId]); }
async function findGame(idOrCode) {
    return (await db.get(SQL.getGame, [idOrCode]))
        || (await db.get(SQL.getGameByCode, [String(idOrCode).toUpperCase()]));
}

/* ── state persistence ──────────────────────────────────────────────── */

async function saveState(tx, gameId, state, detail = {}) {
    assertDeckIntegrity(snapshotOf(state), detail.action || 'action');
    const turnNo = state.prepTurnsCompleted[0] + state.prepTurnsCompleted[1];

    for (const seat of [0, 1]) {
        // `acquired` comes straight from the engine's freshCards, which is the
        // single source of truth for "how did this card get here". Before this,
        // saveState accepted an acquired map that no service ever passed, so
        // every card was silently recorded as 'deal' forever.
        const hj = JSON.stringify(
            handToJson(state.hands[seat], state.revealed[seat], state.freshCards?.[seat]));
        await tx.run(SQL.updateHand, [hj, state.hands[seat].length, gameId, seat]);
        await tx.run(SQL.updateSeatPrep, [state.prepTurnsCompleted[seat], gameId, seat]);
        await tx.run(SQL.insertHandHistory, [gameId, turnNo, seat, hj]);
    }

    await tx.run(SQL.updatePiles, [
        JSON.stringify(state.deck.map((c) => c.id)),
        JSON.stringify(state.discard.map((c) => c.id)),
        state.deck.length, gameId,
    ]);

    await tx.run(SQL.updateGame, [
        state.phase === 'finished' ? 'finished'
            : state.pending ? 'awaiting_resolution' : 'preparing',
        state.currentPlayer, state.winner, turnNo,
        state.phase === 'finished' ? new Date().toISOString() : null,
        gameId,
    ]);

    if (state.pending) {
        const actorSeat = state.pending.type === 'challenge_response'
            ? state.pending.defender : state.pending.winner;
        await tx.run(SQL.insertPending, [gameId, detail.turnId ?? null, state.pending.type,
            actorSeat, JSON.stringify(state.pending)]);
    } else {
        await tx.run(SQL.clearPending, [gameId]);
    }

    // Persist EVERY event this action produced, not just the last one. A
    // single action can append two: its own, plus round_cap_resolved when it
    // happened to complete the final turn. Writing only the last would
    // silently drop the action that caused it.
    //
    // The log is rebuilt 1:1 from the events table on load, so anything beyond
    // the stored count is new. nextSeq is maxSeq+1, i.e. storedCount+1.
    const nextSeq = (await tx.get(SQL.nextSeq, [gameId])).n;
    const storedCount = nextSeq - 1;
    const newEvents = state.log.slice(storedCount);

    for (let i = 0; i < newEvents.length; i++) {
        const ev = newEvents[i];
        await tx.run(SQL.insertEvent, [gameId, storedCount + 1 + i, ev.event,
            detail.seat ?? null, 'public', JSON.stringify(ev)]);

        // The cap resolves inside endTurn, so ANY action can trigger it —
        // recording it here rather than in a service is what guarantees no
        // action path can end the game without leaving an attacks row.
        if (ev.event === 'round_cap_resolved' && detail.turnId) {
            const t0 = ev.totals[0], t1 = ev.totals[1];
            await tx.run(SQL.insertRoundCap, [
                detail.turnId, gameId,
                // No one declared this; the seat that completed the final turn
                // fills attacker_seat only to satisfy NOT NULL.
                detail.seat ?? state.startingPlayer,
                detail.seat === 0 ? 1 : 0,
                t0.offense, t1.defense,
                ev.winner === (detail.seat ?? state.startingPlayer) ? 1 : 0,
                ev.winner,
                t0.total, t1.total, t0.total - t1.total, ev.tie ? 1 : 0,
                JSON.stringify(handToJson(state.hands[0], state.revealed[0], state.freshCards?.[0])),
                JSON.stringify(handToJson(state.hands[1], state.revealed[1], state.freshCards?.[1])),
            ]);
        }
    }
}

async function recordTurn(tx, gameId, { seat, action, status = 'complete' }) {
    const n = (await tx.get(SQL.nextTurnNo, [gameId])).n;
    const res = await tx.run(SQL.insertTurn, [gameId, n, seat, action, status,
        status === 'complete' ? new Date().toISOString() : null]);
    return res.lastInsertRowid;
}

/** Reconstructs the engine state from the database. */
async function loadState(gameId) {
    const g = await db.get(SQL.getGame, [gameId]);
    if (!g) return null;
    const hands = await db.all(SQL.getHands, [gameId]);
    const piles = await db.get(SQL.getPiles, [gameId]);
    const seats = await db.all(SQL.getSeats, [gameId]);
    const pending = await db.get(SQL.getPending, [gameId]);
    const events = await db.all(SQL.getEvents, [gameId]);

    return {
        deck: JSON.parse(piles.deck_json).map(idToCard),
        discard: JSON.parse(piles.discard_json).map(idToCard),
        hands: [jsonToHand(hands[0].hand_json), jsonToHand(hands[1].hand_json)],
        prepTurnsCompleted: [seats[0].prep_turns_completed, seats[1].prep_turns_completed],
        currentPlayer: g.current_seat,
        phase: g.status === 'finished' ? 'finished' : 'preparing',
        pending: pending ? JSON.parse(pending.context_json) : null,
        revealed: [0, 1].map((i) =>
            Object.entries(JSON.parse(hands[i].hand_json))
                .filter(([, m]) => m.revealed).map(([id]) => id)),
        // Both of these MUST round-trip or they silently reset on every poll:
        // freshCards would drop the highlight, and startingPlayer would break
        // the round cap's tie-break (games.starting_seat is the only durable
        // record of who moved first).
        freshCards: [0, 1].map((i) =>
            Object.fromEntries(
                Object.entries(JSON.parse(hands[i].hand_json))
                    .filter(([, m]) => m.isNew)
                    .map(([id, m]) => [id, m.acquired]))),
        startingPlayer: g.starting_seat,
        winner: g.winner_seat,
        log: events.map((e) => JSON.parse(e.payload_json)),
    };
}

module.exports = {
    SQL, db,
    createGame, joinGame, seatForToken, getSeats, getGame, findGame,
    saveState, recordTurn, loadState,
    handToJson, jsonToHand, makeJoinCode,
};
