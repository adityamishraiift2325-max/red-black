// Deck integrity guard.
//
// With hands stored as JSON, SQL can no longer prove that a card exists in
// exactly one place. This module re-establishes that guarantee in code: after
// every mutation the service layer calls assertDeckIntegrity() inside the same
// transaction, so a rule bug rolls back instead of corrupting the game.

const { freshDeck } = require('../engine/cards');

const ALL_CARD_IDS = freshDeck().map((c) => c.id);

class IntegrityError extends Error {}

/**
 * Verifies that the 52 catalog cards appear exactly once across both hands,
 * the deck and the discard pile.
 *
 * @param {object} snapshot
 * @param {object} snapshot.hands   { 0: {cardId: meta}, 1: {cardId: meta} }
 * @param {string[]} snapshot.deck
 * @param {string[]} snapshot.discard
 */
function checkDeckIntegrity({ hands, deck = [], discard = [] }) {
    const seen = new Map(); // cardId -> [locations]
    const note = (id, where) => {
        if (!seen.has(id)) seen.set(id, []);
        seen.get(id).push(where);
    };

    for (const seat of [0, 1]) {
        for (const id of Object.keys(hands[seat] || {})) note(id, `hand:${seat}`);
    }
    deck.forEach((id) => note(id, 'deck'));
    discard.forEach((id) => note(id, 'discard'));

    const errors = [];

    const duplicates = [...seen.entries()].filter(([, places]) => places.length > 1);
    for (const [id, places] of duplicates) {
        errors.push(`${id} appears in ${places.length} places: ${places.join(', ')}`);
    }

    const missing = ALL_CARD_IDS.filter((id) => !seen.has(id));
    if (missing.length) errors.push(`missing ${missing.length} card(s): ${missing.join(', ')}`);

    const unknown = [...seen.keys()].filter((id) => !ALL_CARD_IDS.includes(id));
    if (unknown.length) errors.push(`unknown card id(s): ${unknown.join(', ')}`);

    const total = [...seen.values()].reduce((n, places) => n + places.length, 0);
    if (total !== 52 && errors.length === 0) {
        errors.push(`expected 52 card placements, found ${total}`);
    }

    return { ok: errors.length === 0, errors };
}

function assertDeckIntegrity(snapshot, context = '') {
    const { ok, errors } = checkDeckIntegrity(snapshot);
    if (!ok) {
        throw new IntegrityError(
            `Deck integrity violated${context ? ` after ${context}` : ''}:\n  - ${errors.join('\n  - ')}`
        );
    }
}

module.exports = { checkDeckIntegrity, assertDeckIntegrity, IntegrityError, ALL_CARD_IDS };
