// Card model and deck utilities for Red & Black.

const SUITS = ['H', 'D', 'S', 'C']; // Hearts, Diamonds = red; Spades, Clubs = black
const RED_SUITS = new Set(['H', 'D']);
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const RANK_VALUES = RANKS.reduce((map, rank, i) => {
    map[rank] = i + 2; // 2..10 face value, J=11, Q=12, K=13, A=14
    return map;
}, {});

function cardId(suit, rank) {
    return `${rank}${suit}`;
}

function makeCard(suit, rank) {
    return {
        id: cardId(suit, rank),
        suit,
        rank,
        value: RANK_VALUES[rank],
        type: RED_SUITS.has(suit) ? 'red' : 'black', // red = Offense, black = Defense
    };
}

function freshDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push(makeCard(suit, rank));
        }
    }
    return deck;
}

// Fisher-Yates shuffle. Accepts an rng function for testability (default Math.random).
function shuffle(cards, rng = Math.random) {
    const arr = cards.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function oppositeType(type) {
    return type === 'red' ? 'black' : 'red';
}

// Returns the highest-value card of `type` in `hand`, or null if none.
// If `tieBreakId` is supplied and it's among the tied-highest cards, it is preferred
// (implements "owner chooses which counts as highest" on ties).
function highestOfType(hand, type, tieBreakId = null) {
    const candidates = hand.filter((c) => c.type === type);
    if (candidates.length === 0) return null;
    const maxValue = Math.max(...candidates.map((c) => c.value));
    const tied = candidates.filter((c) => c.value === maxValue);
    if (tied.length === 1) return tied[0];
    if (tieBreakId) {
        const chosen = tied.find((c) => c.id === tieBreakId);
        if (chosen) return chosen;
    }
    return tied[0];
}

// Returns the highest-value card in the whole hand, regardless of type.
function highestOverall(hand, tieBreakId = null) {
    if (hand.length === 0) return null;
    const maxValue = Math.max(...hand.map((c) => c.value));
    const tied = hand.filter((c) => c.value === maxValue);
    if (tied.length > 1 && tieBreakId) {
        const chosen = tied.find((c) => c.id === tieBreakId);
        if (chosen) return chosen;
    }
    return tied[0];
}

// House rule: when a player is asked for their highest card of `type` but holds
// none of that type, they must surrender their highest card overall instead.
// Returns { card, fallbackUsed }.
function highestOfTypeOrFallback(hand, type, tieBreakId = null) {
    const ofType = highestOfType(hand, type, tieBreakId);
    if (ofType) return { card: ofType, fallbackUsed: false };
    const overall = highestOverall(hand, tieBreakId);
    return { card: overall, fallbackUsed: overall !== null };
}

function sumByType(hand, type) {
    return hand.filter((c) => c.type === type).reduce((sum, c) => sum + c.value, 0);
}

module.exports = {
    SUITS,
    RANKS,
    RANK_VALUES,
    makeCard,
    freshDeck,
    shuffle,
    oppositeType,
    highestOfType,
    highestOverall,
    highestOfTypeOrFallback,
    sumByType,
};
