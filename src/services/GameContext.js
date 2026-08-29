// Shared plumbing for every action service: load the game, run one engine
// call, persist the result. All async now that the DB client is remote-capable.

const db = require('../db/client');
const repo = require('../db/gameRepo');
const engine = require('../engine/gameEngine');
const { Game } = require('../models/Game');
const { NotFoundError, IllegalMoveError, ValidationError, AppError } = require('./errors');
const { Card } = require('../models/Card');

/**
 * Loads the Game aggregate (models), or throws 404.
 *
 * These five reads are independent, so they are issued in parallel. Run
 * sequentially they cost five network round-trips to the database, which
 * dominates response time when the function and the database are not in the
 * same region.
 */
async function loadGame(gameId) {
    const [row, seats, hands, piles, pendingRow] = await Promise.all([
        repo.getGame(gameId),
        repo.getSeats(gameId),
        db.all(repo.SQL.getHands, [gameId]),
        db.get(repo.SQL.getPiles, [gameId]),
        db.get(repo.SQL.getPending, [gameId]),
    ]);
    if (!row) throw new NotFoundError('Game');

    const pending = pendingRow
        ? { ...JSON.parse(pendingRow.context_json), actorSeat: pendingRow.actor_seat,
            type: pendingRow.type, turnId: pendingRow.turn_id }
        : null;
    const game = new Game({ row, seats, hands, piles, pending });
    game.seatRows = seats;   // so callers need not re-query
    return game;
}

async function loadEngineState(gameId) {
    const state = await repo.loadState(gameId);
    if (!state) throw new NotFoundError('Game');
    return state;
}

function assertSeat(seat) {
    const n = Number(seat);
    if (n !== 0 && n !== 1) throw new ValidationError('seat must be 0 or 1', { seat });
    return n;
}

function assertCardId(cardId, field = 'cardId') {
    if (!Card.isValidId(cardId)) {
        throw new ValidationError(`${field} must be a valid card id such as "KH" or "10S"`,
                                  { [field]: cardId });
    }
    return cardId;
}

/**
 * Resolves which seat the caller is, FROM THEIR TOKEN ALONE.
 *
 * The seat is never taken from the request body or path: a client that could
 * name its own seat could simply ask for the opponent's hand. The token is the
 * identity, so a player is structurally unable to act as anyone but themselves.
 */
async function resolveCallerSeat(gameId, token) {
    const seat = await repo.seatForToken(gameId, token);
    if (seat === null) {
        throw new AppError('Not a player in this game, or your session expired.',
                           401, 'UNAUTHENTICATED');
    }
    return seat;
}

/** Both seats must be occupied before any turn can be taken. */
async function assertGameReady(gameId) {
    const g = await repo.getGame(gameId);
    if (!g) throw new NotFoundError('Game');
    if (g.status === 'lobby') {
        throw new IllegalMoveError('Waiting for a second player to join.');
    }
    return g;
}

/**
 * Runs one engine action inside a transaction and persists the outcome.
 * The engine validates FIRST; only a legal move gets a turns row.
 *
 * @returns {{ after: object, turnId: number|null }}
 */
async function applyAction(gameId, action, meta, afterSave) {
    const before = await loadEngineState(gameId);

    let after;
    try {
        after = action(before);
    } catch (err) {
        if (err instanceof engine.GameError) throw new IllegalMoveError(err.message);
        throw err;
    }

    return db.transaction(async (tx) => {
        const turnId = meta.turnId ?? (meta.newTurn
            ? await repo.recordTurn(tx, gameId, {
                seat: meta.seat, action: meta.newTurn, status: meta.turnStatus || 'complete' })
            : null);

        await repo.saveState(tx, gameId, after, { ...meta, turnId });
        if (afterSave) await afterSave({ before, after, turnId, tx });
        return { after, turnId };
    });
}

/**
 * Finds the event a service's own action produced, by NAME rather than by
 * "the last thing in the log" — endTurn() can append a SECOND event
 * (round_cap_resolved) after any action that completes the final prep turn,
 * so `log[log.length - 1]` is not reliably the caller's own event. Every
 * service must locate its event this way; blind last-index access is exactly
 * the bug that silently broke burn/swap/giveback the day round cap shipped.
 */
function findEvent(log, eventName) {
    // Search from the end: a service's own event is normally last or
    // second-to-last, and this is cheap either way for a log this short.
    for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].event === eventName) return log[i];
    }
    return null;
}

module.exports = {
    loadGame, loadEngineState, applyAction, findEvent,
    assertSeat, assertCardId, resolveCallerSeat, assertGameReady,
    repo, engine, db,
};
