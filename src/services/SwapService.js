// Turn action 2 of 3: the forced swap. The opponent has no say.

const { applyAction, repo, engine } = require('./GameContext');
const { ValidationError } = require('./errors');

async function executeSwap(gameId, seat, type, tieBreakId = null) {
    if (type !== 'red' && type !== 'black') {
        throw new ValidationError('type must be "red" or "black"', { type });
    }

    const { after, turnId } = await applyAction(
        gameId,
        (state) => engine.executeSwap(state, seat, type, tieBreakId),
        { action: 'swap', seat, newTurn: 'swap' },
        async ({ after: next, turnId: tid, tx }) => {
            const ev = next.log[next.log.length - 1];
            await tx.run(repo.SQL.insertSwap, [tid, gameId, seat, ev.opponent, type,
                ev.gave, ev.received, ev.initiatorFallback ? 1 : 0, ev.opponentFallback ? 1 : 0]);
        }
    );

    const ev = after.log[after.log.length - 1];
    return { turnId, gave: ev.gave, received: ev.received,
             opponentFallbackUsed: !!ev.opponentFallback, nextSeat: after.currentPlayer };
}

module.exports = { executeSwap };
