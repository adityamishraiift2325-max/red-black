// Read-only projections. Every redaction lives here, so "a player never sees
// the opponent's cards" is enforced in one place.

const { loadGame, repo, db } = require('./GameContext');
const ChallengeService = require('./ChallengeService');

/** The per-seat game view — what a player's screen renders from. */
async function forSeat(gameId, seat) {
    const [game, pendingChallenge] = await Promise.all([
        loadGame(gameId),
        ChallengeService.currentFor(gameId, Number(seat)),
    ]);
    const s = Number(seat);
    const opp = game.opponentOf(s);
    const legal = game.legalActions(s);
    const seats = game.seatRows;   // already loaded by loadGame

    return {
        gameId: game.id,
        joinCode: game.joinCode,
        you: s,
        yourName: seats[s].player_name,
        opponentName: seats[opp].player_name,
        opponentJoined: seats[opp].seat_token !== null,
        status: game.status,
        currentSeat: game.currentSeat,
        yourTurn: game.isSeatsTurn(s) && game.status !== 'lobby',
        yourHand: game.handOf(s).visible(),
        opponentCardCount: game.handOf(opp).size,
        yourTotals: {
            offense: game.handOf(s).offenseTotal(),
            defense: game.handOf(s).defenseTotal(),
        },
        prepTurns: { you: game.prepTurns[s], opponent: game.prepTurns[opp] },
        canAttack: game.canAttack(),
        legalActions: game.status === 'lobby' ? [] : legal.actions,
        blockedReason: game.status === 'lobby'
            ? 'Waiting for a second player to join.' : legal.reason,
        attackBlockedBy: legal.attackBlockedBy ?? null,
        deckCount: game.deckCount,
        pendingChallenge,
        winnerSeat: game.winnerSeat,
        youWon: game.winnerSeat === null ? null : game.winnerSeat === s,
        finalReveal: game.isFinished() ? await finalRevealFor(gameId, game, s, opp) : null,
    };
}

/** Post-game disclosure: safe only once the game is over. */
async function finalRevealFor(gameId, game, seat, opp) {
    const atk = await db.get(
        `SELECT * FROM attacks WHERE game_id=? ORDER BY turn_id DESC LIMIT 1`, [gameId]);
    return {
        opponentHand: game.handOf(opp).visible(),
        opponentTotals: { offense: game.handOf(opp).offenseTotal(),
                          defense: game.handOf(opp).defenseTotal() },
        yourTotals: { offense: game.handOf(seat).offenseTotal(),
                      defense: game.handOf(seat).defenseTotal() },
        attack: atk ? {
            attackerSeat: atk.attacker_seat, defenderSeat: atk.defender_seat,
            offenseTotal: atk.offense_total, defenseTotal: atk.defense_total,
            youAttacked: atk.attacker_seat === seat,
            winnerSeat: atk.winner_seat,
            margin: atk.offense_total - atk.defense_total,
        } : null,
    };
}

/** Lobby status — safe to poll without a token. Reveals nothing about hands. */
async function lobbyStatus(gameId) {
    const g = await repo.findGame(gameId);
    if (!g) return null;
    const seats = await repo.getSeats(g.id);
    return {
        gameId: g.id,
        joinCode: g.join_code,
        status: g.status,
        players: seats.map((s) => ({
            seat: s.seat, name: s.player_name, joined: s.seat_token !== null })),
        ready: seats.every((s) => s.seat_token !== null),
    };
}

/** Full unredacted state. Debug/referee only. */
async function fullState(gameId) {
    const game = await loadGame(gameId);
    return {
        gameId: game.id, status: game.status, currentSeat: game.currentSeat,
        hands: [game.handOf(0).visible(), game.handOf(1).visible()],
        totals: game.totals(), prepTurns: game.prepTurns,
        canAttack: game.canAttack(), pending: game.pending,
        deckCount: game.deckCount, winnerSeat: game.winnerSeat,
    };
}

async function handFor(gameId, seat) {
    const game = await loadGame(gameId);
    const s = Number(seat);
    return { seat: s, cards: game.handOf(s).visible(), size: game.handOf(s).size,
             offenseTotal: game.handOf(s).offenseTotal(),
             defenseTotal: game.handOf(s).defenseTotal() };
}

async function legalActions(gameId, seat) {
    const game = await loadGame(gameId);
    return { seat: Number(seat), ...game.legalActions(Number(seat)) };
}

async function pending(gameId) {
    return (await loadGame(gameId)).pending;
}

async function events(gameId, seat = null) {
    const rows = await db.all(repo.SQL.getEvents, [gameId]);
    return rows
        .filter((r) => seat === null || r.visibility === 'public' || r.visibility === `seat_${seat}`)
        .map((r) => ({ seq: r.seq, type: r.event_type, actorSeat: r.actor_seat,
                       payload: JSON.parse(r.payload_json), at: r.created_at }));
}

async function turns(gameId) {
    return db.all(`SELECT * FROM turns WHERE game_id=? ORDER BY turn_no`, [gameId]);
}

async function openingDeal(gameId) {
    const rows = await db.all(
        `SELECT seat, hand_json FROM initial_deals WHERE game_id=? ORDER BY seat`, [gameId]);
    return rows.map((r) => ({ seat: r.seat, cards: Object.keys(JSON.parse(r.hand_json)) }));
}

const listGames = () => repo.listGames();

module.exports = {
    forSeat, lobbyStatus, fullState, handFor, legalActions, pending,
    events, turns, openingDeal, listGames,
};
