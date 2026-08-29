// The terminal action: sum red vs black, strictly greater wins.

const { applyAction, loadGame, repo, engine, db } = require('./GameContext');

async function declareAttack(gameId, seat) {
    // Snapshot hands before the engine ends the game, so the attacks row keeps
    // exactly what the totals were computed from.
    const pre = await db.all(repo.SQL.getHands, [gameId]);

    const { after, turnId } = await applyAction(
        gameId,
        (state) => engine.declareAttack(state, seat),
        { action: 'attack', seat, newTurn: 'attack' },
        async ({ after: next, turnId: tid, tx }) => {
            const ev = next.log[next.log.length - 1];
            await tx.run(repo.SQL.insertAttack, [tid, gameId, ev.attacker, ev.defender,
                ev.offenseTotal, ev.defenseTotal, ev.attackerWins ? 1 : 0, ev.winner,
                pre[ev.attacker].hand_json, pre[ev.defender].hand_json]);
        }
    );

    const ev = after.log[after.log.length - 1];
    return { turnId, attackerSeat: ev.attacker, defenderSeat: ev.defender,
             offenseTotal: ev.offenseTotal, defenseTotal: ev.defenseTotal,
             attackerWon: ev.attackerWins, winnerSeat: ev.winner };
}

/**
 * Pre-attack check. Returns ONLY the attacker's own offense total — never the
 * opponent's defense or the outcome. An attacker who could see the answer
 * would cancel every losing attack, removing the risk the game is built on.
 */
async function previewAttack(gameId, seat) {
    const game = await loadGame(gameId);
    const s = Number(seat);
    return {
        seat: s,
        offenseTotal: game.handOf(s).offenseTotal(),
        allowed: game.canAttack(),
        blockedBy: game.canAttack() ? null : game.legalActions(s).attackBlockedBy,
    };
}

module.exports = { declareAttack, previewAttack };
