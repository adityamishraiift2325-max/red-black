// Creates a game and seats the host. The second seat stays OPEN — the game id
// (and its short join code) is the room the opponent joins with.

const repo = require('../db/gameRepo');
const engine = require('../engine/gameEngine');
const { ValidationError, ConflictError } = require('./errors');

function cleanName(name, fallback) {
    const n = String(name || '').trim().slice(0, 24);
    if (!n) return fallback;
    return n;
}

async function createGame({ hostName } = {}) {
    const name = cleanName(hostName, 'Player 1');
    const state = engine.newGame();
    const res = await repo.createGame(state, { hostName: name, hostSeat: 0 });
    return { ...res, hostName: name, startingSeat: state.currentPlayer };
}

/**
 * Claims the open seat — OR, if both seats are already taken and the given
 * name matches whoever holds one of them, reclaims it. That's the entire
 * no-accounts recovery path: the room code plus the name you used before
 * gets you back into your own game after a lost connection, a back-button
 * navigation, or a different device. See docs/DECISIONS.md.
 */
async function joinGame({ code, playerName }) {
    if (!code) throw new ValidationError('A game id or join code is required.');
    const name = cleanName(playerName, 'Player 2');
    const res = await repo.joinGame(String(code).trim(), name);
    if (res.error === 'not_found') throw new ValidationError('No game found with that code.');
    if (res.error === 'seat_active') {
        throw new ConflictError(
            `Someone's still playing that seat. If that someone is you, give it ` +
            `${res.retryAfterSeconds}s and try again.`
        );
    }
    if (res.error === 'full') {
        throw new ValidationError(
            'That game already has two players. If you were one of them, use the same name you had.'
        );
    }
    return { ...res, playerName: name };
}

module.exports = { createGame, joinGame };
