// Turn action 1 of 3: Burn & Draw. Discard one card, draw one.

const { applyAction, assertCardId, repo, engine } = require('./GameContext');

async function burnAndDraw(gameId, seat, cardId) {
    const id = assertCardId(cardId);

    const { after, turnId } = await applyAction(
        gameId,
        (state) => engine.burnAndDraw(state, seat, id),
        { action: 'burn_draw', seat, newTurn: 'burn_draw' },
        async ({ after: next, turnId: tid, tx }) => {
            const ev = next.log[next.log.length - 1];
            await tx.run(repo.SQL.insertBurn, [tid, gameId, seat, ev.discarded, ev.drawn, 0]);
        }
    );

    const ev = after.log[after.log.length - 1];
    return { turnId, discarded: ev.discarded, drawn: ev.drawn, nextSeat: after.currentPlayer };
}

module.exports = { burnAndDraw };
