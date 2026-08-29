// Game aggregate: the games row plus its seats, hands and piles.
// Answers "what is allowed right now" so services and controllers never
// reimplement those checks.

const { Hand } = require('./Hand');

const STATUS = {
    LOBBY: 'lobby',                     // dealt, second seat still open
    PREPARING: 'preparing',
    AWAITING_RESOLUTION: 'awaiting_resolution',
    FINISHED: 'finished',
};

const MIN_PREP_TURNS = 3;

class Game {
    constructor({ row, seats, hands, piles, pending = null }) {
        this.id = row.id;
        this.joinCode = row.join_code;
        this.status = row.status;
        this.currentSeat = row.current_seat;
        this.startingSeat = row.starting_seat;
        this.winnerSeat = row.winner_seat;
        this.turnNo = row.turn_no;
        this.handSize = row.hand_size;
        this.minPrepTurns = row.min_prep_turns ?? MIN_PREP_TURNS;
        this.prepTurns = [seats[0].prep_turns_completed, seats[1].prep_turns_completed];
        this.playerIds = [seats[0].player_id, seats[1].player_id];
        this.hands = [Hand.fromJson(hands[0].hand_json), Hand.fromJson(hands[1].hand_json)];
        this.deckCount = piles ? piles.deck_count : 0;
        this.deck = piles ? JSON.parse(piles.deck_json) : [];
        this.discard = piles ? JSON.parse(piles.discard_json) : [];
        this.pending = pending;
    }

    isFinished() { return this.status === STATUS.FINISHED; }
    isWaitingForPlayer() { return this.status === STATUS.LOBBY; }
    isAwaitingResolution() { return !!this.pending; }
    opponentOf(seat) { return seat === 0 ? 1 : 0; }
    handOf(seat) { return this.hands[seat]; }
    isSeatsTurn(seat) { return this.currentSeat === seat; }

    /** Both players must have completed their preparation turns. */
    canAttack() {
        return this.prepTurns[0] >= this.minPrepTurns && this.prepTurns[1] >= this.minPrepTurns;
    }

    prepTurnsRemaining(seat) {
        return Math.max(0, this.minPrepTurns - this.prepTurns[seat]);
    }

    /**
     * Every action `seat` may legally take right now, with a reason when it
     * cannot. Drives the UI's button states and keeps validation in one place.
     */
    legalActions(seat) {
        if (this.isFinished()) return { actions: [], reason: 'Game is finished.' };
        if (this.isWaitingForPlayer()) {
            return { actions: [], reason: 'Waiting for a second player to join.' };
        }

        if (this.pending) {
            const actor = this.pending.actorSeat;
            if (actor !== seat) {
                return { actions: [], reason: `Waiting on player ${actor}.` };
            }
            return {
                actions: this.pending.type === 'challenge_response'
                    ? ['challenge.accept', 'challenge.decline']
                    : ['challenge.giveback'],
                reason: null,
            };
        }

        if (!this.isSeatsTurn(seat)) return { actions: [], reason: 'Not your turn.' };

        const actions = ['burn', 'swap', 'challenge'];
        if (this.canAttack()) {
            actions.push('attack');
        }
        return {
            actions,
            reason: null,
            attackBlockedBy: this.canAttack() ? null
                : `Needs ${this.prepTurnsRemaining(0)} more prep turn(s) from P0 and ` +
                  `${this.prepTurnsRemaining(1)} from P1.`,
        };
    }

    /** Live totals an attack would be judged on. */
    totals() {
        return [
            { seat: 0, offense: this.hands[0].offenseTotal(), defense: this.hands[0].defenseTotal() },
            { seat: 1, offense: this.hands[1].offenseTotal(), defense: this.hands[1].defenseTotal() },
        ];
    }
}

module.exports = { Game, STATUS, MIN_PREP_TURNS };
