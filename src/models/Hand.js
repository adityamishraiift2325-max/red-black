// A player's hand. Wraps the hand_json structure stored in player_hands and
// owns every "which card counts as highest" decision, so no service has to
// reimplement the rules.

const { Card } = require('./Card');

class Hand {
    /** @param {Array<{card: Card, slot: number, revealed: boolean, acquired: string}>} entries */
    constructor(entries = []) {
        this.entries = entries;
    }

    /** Parse the hand_json column: { "KH": { slot, revealed, isNew, acquired } } */
    static fromJson(handJson) {
        const obj = typeof handJson === 'string' ? JSON.parse(handJson) : handJson;
        const entries = Object.entries(obj)
            .map(([id, meta]) => ({
                card: Card.fromId(id),
                slot: meta.slot,
                revealed: !!meta.revealed,
                isNew: !!meta.isNew,
                acquired: meta.acquired || 'deal',
            }))
            .sort((a, b) => a.slot - b.slot);
        return new Hand(entries);
    }

    /** Build from plain card objects (engine format). */
    static fromCards(cards, revealedIds = [], acquiredMap = {}) {
        const revealed = new Set(revealedIds);
        return new Hand(cards.map((c, i) => ({
            card: c instanceof Card ? c : Card.fromId(c.id),
            slot: i + 1,
            revealed: revealed.has(c.id),
            acquired: acquiredMap[c.id] || 'deal',
        })));
    }

    toJson() {
        const out = {};
        for (const e of this.entries) {
            out[e.card.id] = { slot: e.slot, revealed: e.revealed, isNew: e.isNew, acquired: e.acquired };
        }
        return out;
    }

    get size() { return this.entries.length; }
    ids() { return this.entries.map((e) => e.card.id); }
    cards() { return this.entries.map((e) => e.card); }
    has(cardId) { return this.entries.some((e) => e.card.id === cardId); }
    find(cardId) { return this.entries.find((e) => e.card.id === cardId) || null; }
    ofType(type) { return this.entries.filter((e) => e.card.type === type).map((e) => e.card); }

    /**
     * Highest card of a type. On a value tie the owner may nominate which one
     * counts, via tieBreakId.
     */
    highestOfType(type, tieBreakId = null) {
        return Hand.#pickHighest(this.ofType(type), tieBreakId);
    }

    highestOverall(tieBreakId = null) {
        return Hand.#pickHighest(this.cards(), tieBreakId);
    }

    /**
     * The card a player must surrender when asked for their highest of `type`.
     * Falls back to their highest card overall when they hold none of that type.
     * @returns {{card: Card|null, fallbackUsed: boolean}}
     */
    forcedSurrender(type, tieBreakId = null) {
        const ofType = this.highestOfType(type, tieBreakId);
        if (ofType) return { card: ofType, fallbackUsed: false };
        const overall = this.highestOverall(tieBreakId);
        return { card: overall, fallbackUsed: overall !== null };
    }

    lowest() {
        if (!this.entries.length) return null;
        return this.cards().reduce((lo, c) => (c.value < lo.value ? c : lo));
    }

    totalOf(type) {
        return this.ofType(type).reduce((sum, c) => sum + c.value, 0);
    }

    offenseTotal() { return this.totalOf('red'); }
    defenseTotal() { return this.totalOf('black'); }

    /** Cards this hand's owner knows the OPPONENT has seen. */
    revealedIds() { return this.entries.filter((e) => e.revealed).map((e) => e.card.id); }

    /**
     * What the opponent may see: NOTHING. Every card is face down, always.
     *
     * Persisting "this card is known to the opponent" leaked information the
     * moment such a card left the hand: burning a card the opponent had seen
     * told them exactly what was discarded, and they could then reason about
     * the rest of the hand. A challenge or swap reveals a card at that instant
     * — that moment is recorded in the event log and nowhere else. It does not
     * follow the card around afterwards.
     */
    redacted() {
        return this.entries.map((e) => ({ slot: e.slot, id: null, faceUp: false }));
    }

    /** The owner's own view: their full hand, including the new-card flag. */
    visible() {
        return this.entries.map((e) => ({
            slot: e.slot,
            id: e.card.id,
            rank: e.card.rank,
            suit: e.card.suit,
            value: e.card.value,
            type: e.card.type,
            isNew: e.isNew,
            acquired: e.acquired,
        }));
    }

    static #pickHighest(cards, tieBreakId) {
        if (!cards.length) return null;
        const max = Math.max(...cards.map((c) => c.value));
        const tied = cards.filter((c) => c.value === max);
        if (tied.length > 1 && tieBreakId) {
            const chosen = tied.find((c) => c.id === tieBreakId);
            if (chosen) return chosen;
        }
        return tied[0];
    }
}

module.exports = { Hand };
