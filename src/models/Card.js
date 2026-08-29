// A single playing card. Immutable value object.
// Red (H/D) = Offense, Black (S/C) = Defense.

const RANK_VALUES = {
    2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
    J: 11, Q: 12, K: 13, A: 14,
};

const SUIT_NAMES = { H: 'Hearts', D: 'Diamonds', S: 'Spades', C: 'Clubs' };

class Card {
    constructor(rank, suit) {
        if (!SUIT_NAMES[suit]) throw new Error(`Invalid suit: ${suit}`);
        if (!RANK_VALUES[rank]) throw new Error(`Invalid rank: ${rank}`);
        this.rank = rank;
        this.suit = suit;
        this.id = `${rank}${suit}`;
        this.value = RANK_VALUES[rank];
        this.type = suit === 'H' || suit === 'D' ? 'red' : 'black';
        Object.freeze(this);
    }

    /** Build from a card id such as 'KH' or '10S'. */
    static fromId(id) {
        return new Card(id.slice(0, -1), id.slice(-1));
    }

    static isValidId(id) {
        return typeof id === 'string' && /^(?:[2-9]|10|[JQKA])[HDSC]$/.test(id);
    }

    isOffense() { return this.type === 'red'; }
    isDefense() { return this.type === 'black'; }

    /** The type this card demands from an opponent in a swap or challenge. */
    opposingType() { return this.type === 'red' ? 'black' : 'red'; }

    beats(other) { return this.value > other.value; } // ties are NOT a win
    tiesWith(other) { return this.value === other.value; }

    label() { return `${this.rank} of ${SUIT_NAMES[this.suit]}`; }

    toJSON() {
        return { id: this.id, rank: this.rank, suit: this.suit, value: this.value, type: this.type };
    }
}

module.exports = { Card, RANK_VALUES, SUIT_NAMES };
