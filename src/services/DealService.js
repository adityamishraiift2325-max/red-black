// Creates a game and seats the host. The second seat stays OPEN — the game id
// (and its short join code) is the room the opponent joins with.

const repo = require('../db/gameRepo');
const engine = require('../engine/gameEngine');
const { ValidationError } = require('./errors');

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

async function joinGame({ code, playerName }) {
    if (!code) throw new ValidationError('A game id or join code is required.');
    const name = cleanName(playerName, 'Player 2');
    const res = await repo.joinGame(String(code).trim(), name);
    if (res.error === 'not_found') throw new ValidationError('No game found with that code.');
    if (res.error === 'full')      throw new ValidationError('That game already has two players.');
    return { ...res, playerName: name };
}

module.exports = { createGame, joinGame };
