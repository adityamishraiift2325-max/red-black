// Turn action 1 of 3: Burn & Draw. Discard one card, draw one.

const { applyAction, assertCardId, findEvent, repo, engine } = require('./GameContext');

async function burnAndDraw(gameId, seat, cardId) {
    const id = assertCardId(cardId);

    const { after, turnId } = await applyAction(
        gameId,
        (state) => engine.burnAndDraw(state, seat, id),
        { action: 'burn_draw', seat, newTurn: 'burn_draw' },
        async ({ after: next, turnId: tid, tx }) => {
            // NOT next.log[next.log.length - 1] — a burn that completes the
            // round cap appends round_cap_resolved AFTER this event.
            const ev = findEvent(next.log, 'burn_draw');
            await tx.run(repo.SQL.insertBurn, [tid, gameId, seat, ev.discarded, ev.drawn, 0]);
        }
    );

    const ev = findEvent(after.log, 'burn_draw');
    return {
        turnId, discarded: ev.discarded, drawn: ev.drawn, nextSeat: after.currentPlayer,
        roundCapResolved: after.phase === 'finished',
    };
}

module.exports = { burnAndDraw };
