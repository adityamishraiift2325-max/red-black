// Red & Black — core game engine.
// Pure(ish) functions: every action takes a state object and returns a NEW state
// object (deep-cloned) plus appends to state.log. No I/O, no DB — this module
// knows nothing about persistence, so it's easy to unit-test in isolation.

const {
    freshDeck,
    shuffle,
    oppositeType,
    highestOfType,
    highestOverall,
    highestOfTypeOrFallback,
    sumByType,
} = require('./cards');

const HAND_SIZE = 6;
const MIN_PREP_TURNS = 3;

function clone(state) {
    return JSON.parse(JSON.stringify(state));
}

function other(player) {
    return player === 0 ? 1 : 0;
}

class GameError extends Error {}

function newGame(rng = Math.random) {
    const deck = shuffle(freshDeck(), rng);
    const hands = [deck.splice(0, HAND_SIZE), deck.splice(0, HAND_SIZE)];
    const startingPlayer = Math.floor(rng() * 2);

    return {
        deck,
        discard: [],
        hands,
        prepTurnsCompleted: [0, 0],
        currentPlayer: startingPlayer,
        phase: 'preparing', // preparing | finished
        pending: null, // holds in-progress multi-step actions (challenge resolution)
        // revealed[p] = ids of player p's cards the OPPONENT has seen.
        // Central to the bluffing layer: swaps are public, challenges expose cards.
        revealed: [[], []],
        winner: null,
        log: [
            { event: 'game_started', startingPlayer },
        ],
    };
}

function findCard(hand, cardId) {
    return hand.find((c) => c.id === cardId) || null;
}

function removeCard(hand, cardId) {
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) return null;
    return hand.splice(idx, 1)[0];
}

function assertActive(state) {
    if (state.phase === 'finished') throw new GameError('Game is already finished.');
}

function assertNoPending(state) {
    if (state.pending) throw new GameError(`An action is pending resolution: ${state.pending.type}`);
}

function assertPlayersTurn(state, player) {
    if (state.currentPlayer !== player) throw new GameError(`It is not player ${player}'s turn.`);
}

function drawOne(state) {
    if (state.deck.length === 0) {
        if (state.discard.length === 0) {
            throw new GameError('No cards left to draw (deck and discard both empty).');
        }
        state.deck = shuffle(state.discard);
        state.discard = [];
        state.log.push({ event: 'reshuffle', count: state.deck.length });
    }
    return state.deck.shift();
}

// A card only stays "known to the opponent" while it is still in that player's
// hand — once it moves or is discarded, drop the stale knowledge.
function pruneRevealed(state) {
    for (const p of [0, 1]) {
        const held = new Set(state.hands[p].map((c) => c.id));
        state.revealed[p] = [...new Set(state.revealed[p].filter((id) => held.has(id)))];
    }
}

function endTurn(state, { countsAsPrepTurn = true } = {}) {
    if (countsAsPrepTurn) {
        state.prepTurnsCompleted[state.currentPlayer] += 1;
    }
    pruneRevealed(state);
    state.pending = null;
    state.currentPlayer = other(state.currentPlayer);
}

function canAttack(state) {
    return state.prepTurnsCompleted[0] >= MIN_PREP_TURNS && state.prepTurnsCompleted[1] >= MIN_PREP_TURNS;
}

// ---- Action: Burn & Draw ----------------------------------------------

function burnAndDraw(inputState, player, discardCardId) {
    const state = clone(inputState);
    assertActive(state);
    assertNoPending(state);
    assertPlayersTurn(state, player);

    const hand = state.hands[player];
    const discarded = removeCard(hand, discardCardId);
    if (!discarded) throw new GameError(`Card ${discardCardId} not found in player ${player}'s hand.`);

    state.discard.push(discarded);
    const drawn = drawOne(state);
    hand.push(drawn);

    state.log.push({ event: 'burn_draw', player, discarded: discarded.id, drawn: drawn.id });
    endTurn(state);
    return state;
}

// ---- Action: Swap -------------------------------------------------------
// FORCED exchange — the opponent has no say. The initiator surrenders their
// highest card of `myType`; the opponent must surrender their highest card of
// the opposite type. Neither side may substitute a different card.
// If the opponent holds no card of the required type, the fallback rule
// applies: they surrender their highest card overall instead.

function executeSwap(inputState, player, myType, tieBreakId = null) {
    const state = clone(inputState);
    assertActive(state);
    assertNoPending(state);
    assertPlayersTurn(state, player);
    if (myType !== 'red' && myType !== 'black') throw new GameError('myType must be "red" or "black".');

    const opponent = other(player);

    const mine = highestOfTypeOrFallback(state.hands[player], myType, tieBreakId);
    if (!mine.card) throw new GameError(`Player ${player} has no cards to swap.`);

    const theirType = oppositeType(myType);
    const theirs = highestOfTypeOrFallback(state.hands[opponent], theirType);
    if (!theirs.card) throw new GameError(`Player ${opponent} has no cards to swap.`);

    removeCard(state.hands[player], mine.card.id);
    removeCard(state.hands[opponent], theirs.card.id);
    state.hands[player].push(theirs.card);
    state.hands[opponent].push(mine.card);

    // Swaps are public, so each card is known to its NEW owner's opponent.
    // (revealed[p] tracks cards in p's hand that p's opponent has seen.)
    state.revealed[player].push(theirs.card.id);
    state.revealed[opponent].push(mine.card.id);

    state.log.push({
        event: 'swap_executed',
        initiator: player,
        opponent,
        gave: mine.card.id,
        received: theirs.card.id,
        initiatorFallback: mine.fallbackUsed,
        opponentFallback: theirs.fallbackUsed,
    });

    endTurn(state);
    return state;
}
// ---- Action: Challenge ---------------------------------------------------
// A three-step, hidden-information exchange:
//
//   1. declareChallenge   The challenger names one of their cards and demands
//                         the defender's highest card of the OPPOSITE type.
//                         The named card stays FACE DOWN. The defender learns
//                         only its colour — never its value.
//
//   2. respondToChallenge The defender ACCEPTS (both cards flip together and
//                         values are compared, defender winning ties) or
//                         DECLINES (concedes without ever seeing the card).
//                         Declining is a concession: the defender still hands
//                         over their highest card of the required type.
//
//   3. completeGiveback   The winner takes the loser's contested card, then
//                         returns any card of the WINNER'S choosing. The loser
//                         has no say and must accept it.
//
// The unifying rule: the challenge winner takes the contested card and picks
// what goes back. Declining simply concedes the win to the challenger.

function declareChallenge(inputState, player, myCardId) {
    const state = clone(inputState);
    assertActive(state);
    assertNoPending(state);
    assertPlayersTurn(state, player);

    const defender = other(player);
    const challengerCard = findCard(state.hands[player], myCardId);
    if (!challengerCard) throw new GameError(`Card ${myCardId} not found in player ${player}'s hand.`);

    const requiredType = oppositeType(challengerCard.type);
    const defenderBest = highestOfType(state.hands[defender], requiredType);

    // FALLBACK: the defender holds no card of the required type, so there is
    // nothing to defend with and no decision to offer. Their highest card
    // overall is surrendered outright, with no comparison.
    if (!defenderBest) {
        const surrendered = highestOverall(state.hands[defender]);
        if (!surrendered) throw new GameError(`Player ${defender} has no cards.`);

        removeCard(state.hands[defender], surrendered.id);
        state.hands[player].push(surrendered);
        state.revealed[player].push(surrendered.id);

        state.log.push({
            event: 'challenge_auto_surrender',
            challenger: player,
            defender,
            challengerCard: challengerCard.id,
            requiredType,
            surrenderedCard: surrendered.id,
        });

        state.pending = {
            type: 'winner_giveback',
            challenger: player,
            winner: player,
            loser: defender,
            contestedCardId: surrendered.id,
            outcome: 'auto_surrender',
        };
        return state;
    }

    // The card itself is NOT placed in the pending payload's public half —
    // the API layer exposes only `challengeCardType` to the defender.
    state.pending = {
        type: 'challenge_response',
        challenger: player,
        defender,
        challengerCardId: challengerCard.id,   // server-side only
        challengeCardType: challengerCard.type, // colour IS disclosed
        requiredType,                           // what the defender owes
    };

    state.log.push({
        event: 'challenge_declared',
        challenger: player,
        defender,
        challengeCardType: challengerCard.type,
        requiredType,
    });
    return state;
}

function respondToChallenge(inputState, player, accept) {
    const state = clone(inputState);
    assertActive(state);
    if (!state.pending || state.pending.type !== 'challenge_response') {
        throw new GameError('No challenge is awaiting a response.');
    }
    if (state.pending.defender !== player) {
        throw new GameError('Only the challenged player may respond.');
    }

    const { challenger, defender, challengerCardId, requiredType } = state.pending;
    const challengerCard = findCard(state.hands[challenger], challengerCardId);
    if (!challengerCard) throw new GameError('The challenge card is no longer in hand.');

    const defenderCard = highestOfType(state.hands[defender], requiredType);
    if (!defenderCard) throw new GameError(`Player ${defender} has no ${requiredType} card.`);

    let winner;
    let loser;
    let contested;
    let outcome;

    if (!accept) {
        // DECLINED — a concession. The defender never sees the challenge card,
        // but still forfeits their highest card of the required type. They may
        // not substitute a different one.
        winner = challenger;
        loser = defender;
        contested = defenderCard;
        outcome = 'declined';

        state.log.push({
            event: 'challenge_declined',
            challenger,
            defender,
            surrenderedCard: defenderCard.id,
            requiredType,
            challengeCardRevealed: false,
        });
    } else {
        // ACCEPTED — both cards flip together. The defender wins ties, so the
        // challenger must be STRICTLY higher to win.
        const challengerWins = challengerCard.value > defenderCard.value;
        winner = challengerWins ? challenger : defender;
        loser = challengerWins ? defender : challenger;
        contested = challengerWins ? defenderCard : challengerCard;
        outcome = challengerWins ? 'accepted_challenger_won' : 'accepted_defender_won';

        // Both cards are now public knowledge.
        state.revealed[challenger].push(challengerCard.id);
        state.revealed[defender].push(defenderCard.id);

        state.log.push({
            event: 'challenge_resolved',
            challenger,
            defender,
            challengerCard: challengerCard.id,
            challengerValue: challengerCard.value,
            defenderCard: defenderCard.id,
            defenderValue: defenderCard.value,
            tie: challengerCard.value === defenderCard.value,
            challengerWins,
            winner,
        });
    }

    // The winner takes the contested card off the loser.
    removeCard(state.hands[loser], contested.id);
    state.hands[winner].push(contested);
    state.revealed[winner].push(contested.id);

    state.pending = {
        type: 'winner_giveback',
        challenger,
        winner,
        loser,
        contestedCardId: contested.id,
        outcome,
    };
    return state;
}

// The winner returns any card of their choosing; the loser must accept it.
// Restores both hands to their normal size.
function completeGiveback(inputState, player, giveCardId) {
    const state = clone(inputState);
    assertActive(state);
    if (!state.pending || state.pending.type !== 'winner_giveback') {
        throw new GameError('No giveback is pending.');
    }
    const { challenger, winner, loser, outcome } = state.pending;
    if (player !== winner) throw new GameError('Only the challenge winner chooses the giveback.');

    const given = removeCard(state.hands[winner], giveCardId);
    if (!given) throw new GameError(`Card ${giveCardId} not found in player ${winner}'s hand.`);
    state.hands[loser].push(given);
    state.revealed[loser].push(given.id);

    state.log.push({ event: 'giveback', winner, loser, given: given.id, outcome });

    // The turn always belongs to the challenger, whoever won the exchange.
    state.currentPlayer = challenger;
    endTurn(state);
    return state;
}

// ---- Action: Attack -------------------------------------------------------

function declareAttack(inputState, player) {
    const state = clone(inputState);
    assertActive(state);
    assertNoPending(state);
    assertPlayersTurn(state, player);

    if (!canAttack(state)) {
        throw new GameError(
            `Both players need ${MIN_PREP_TURNS} preparation turns before an attack. ` +
            `Current: [${state.prepTurnsCompleted.join(', ')}]`
        );
    }

    const defender = other(player);
    const offenseTotal = sumByType(state.hands[player], 'red');
    const defenseTotal = sumByType(state.hands[defender], 'black');
    const attackerWins = offenseTotal > defenseTotal;

    state.phase = 'finished';
    state.winner = attackerWins ? player : defender;
    state.pending = null;

    state.log.push({
        event: 'attack',
        attacker: player,
        defender,
        offenseTotal,
        defenseTotal,
        attackerWins,
        winner: state.winner,
    });

    return state;
}

module.exports = {
    GameError,
    newGame,
    canAttack,
    burnAndDraw,
    executeSwap,
    declareChallenge,
    respondToChallenge,
    completeGiveback,
    declareAttack,
    MIN_PREP_TURNS,
    HAND_SIZE,
};
