// A challenge in flight. This class owns the single most important redaction
// rule in the game: the challenger's card is NEVER disclosed to the defender
// while a response is outstanding, and stays hidden forever if they decline.

const RESPONSE = {
    ACCEPTED: 'accepted',
    DECLINED: 'declined',
    AUTO_SURRENDER: 'auto_surrender',
};

const PENDING = {
    AWAITING_RESPONSE: 'challenge_response',
    AWAITING_GIVEBACK: 'winner_giveback',
};

class Challenge {
    constructor(row) {
        this.turnId = row.turn_id;
        this.gameId = row.game_id;
        this.challengerSeat = row.challenger_seat;
        this.defenderSeat = row.defender_seat;
        this.challengerCardId = row.challenger_card_id;      // server-side truth
        this.challengeCardType = row.challenge_card_type;     // disclosed
        this.requiredType = row.required_type;                // disclosed
        this.response = row.response;
        this.defenderCardId = row.defender_card_id;
        this.challengerValue = row.challenger_value;
        this.defenderValue = row.defender_value;
        this.wasTie = !!row.was_tie;
        this.cardRevealed = !!row.challenge_card_revealed;
        this.winnerSeat = row.winner_seat;
        this.loserSeat = row.loser_seat;
        this.contestedCardId = row.contested_card_id;
        this.givebackCardId = row.giveback_card_id;
        this.givebackBySeat = row.giveback_by_seat;
    }

    isAwaitingResponse() { return this.response === null || this.response === undefined; }
    isResolved() { return this.givebackCardId !== null && this.givebackCardId !== undefined; }
    wasDeclined() { return this.response === RESPONSE.DECLINED; }

    /**
     * What `viewer` may see. The challenger always sees their own card; the
     * defender sees it only once it has actually been revealed in a comparison.
     */
    viewFor(viewer) {
        const isChallenger = viewer === this.challengerSeat;
        const maySeeCard = isChallenger || this.cardRevealed;

        const base = {
            turnId: this.turnId,
            challengerSeat: this.challengerSeat,
            defenderSeat: this.defenderSeat,
            challengeCardType: this.challengeCardType,
            requiredType: this.requiredType,
            challengerCard: maySeeCard ? this.challengerCardId : null,
            cardHidden: !maySeeCard,
            response: this.response ?? null,
        };

        if (this.isAwaitingResponse()) {
            return {
                ...base,
                awaiting: viewer === this.defenderSeat ? 'your_response' : 'opponent_response',
                prompt: viewer === this.defenderSeat
                    ? `Opponent challenged with a ${this.challengeCardType} card. ` +
                      `Accept to reveal both, or decline and forfeit your highest ${this.requiredType}.`
                    : 'Waiting for your opponent to accept or decline.',
            };
        }

        return {
            ...base,
            defenderCard: this.defenderCardId,
            challengerValue: this.challengerValue,
            defenderValue: this.defenderValue,
            wasTie: this.wasTie,
            winnerSeat: this.winnerSeat,
            contestedCard: this.contestedCardId,
            givebackCard: this.givebackCardId,
            resolved: this.isResolved(),
        };
    }
}

module.exports = { Challenge, RESPONSE, PENDING };
