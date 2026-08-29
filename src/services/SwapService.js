// Turn action 2 of 3: the forced swap. The opponent has no say.

const { applyAction, findEvent, repo, engine } = require('./GameContext');
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
            // NOT next.log[next.log.length - 1] — see BurnService for why.
            const ev = findEvent(next.log, 'swap_executed');
            await tx.run(repo.SQL.insertSwap, [tid, gameId, seat, ev.opponent, type,
                ev.gave, ev.received, ev.initiatorFallback ? 1 : 0, ev.opponentFallback ? 1 : 0]);
        }
    );

    const ev = findEvent(after.log, 'swap_executed');
    return {
        turnId, gave: ev.gave, received: ev.received,
        opponentFallbackUsed: !!ev.opponentFallback, nextSeat: after.currentPlayer,
        roundCapResolved: after.phase === 'finished',
    };
}

module.exports = { executeSwap };
