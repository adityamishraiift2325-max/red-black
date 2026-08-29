// Developer-facing inspection. Returns UNREDACTED data — both hands, hidden
// challenge cards, the lot. Never call this from a player-facing screen.

const db = require('../db/client');
const { Hand } = require('../models/Hand');
const { NotFoundError } = require('./errors');
const { checkDeckIntegrity } = require('../db/integrity');

const Q = {
    game: 'SELECT * FROM games WHERE id=?',
    seats: 'SELECT * FROM game_seats WHERE game_id=? ORDER BY seat',
    hands: 'SELECT * FROM player_hands WHERE game_id=? ORDER BY seat',
    deals: 'SELECT * FROM initial_deals WHERE game_id=? ORDER BY seat',
    piles: 'SELECT * FROM game_piles WHERE game_id=?',
    pending: 'SELECT * FROM pending_actions WHERE game_id=?',
    turns: 'SELECT * FROM turns WHERE game_id=? ORDER BY turn_no',
    burns: 'SELECT * FROM burns WHERE game_id=?',
    swaps: 'SELECT * FROM swaps WHERE game_id=?',
    challenges: 'SELECT * FROM challenges WHERE game_id=? ORDER BY turn_id',
    attacks: 'SELECT * FROM attacks WHERE game_id=?',
    events: 'SELECT * FROM events WHERE game_id=? ORDER BY seq',
    history: 'SELECT * FROM hand_history WHERE game_id=? ORDER BY turn_no, seat',
    summaries: `
        SELECT g.id, g.join_code, g.status, g.winner_seat, g.turn_no,
               g.created_at, g.finished_at,
               (SELECT COUNT(*) FROM turns t      WHERE t.game_id = g.id) AS turn_count,
               (SELECT COUNT(*) FROM challenges c WHERE c.game_id = g.id) AS challenge_count,
               (SELECT COUNT(*) FROM swaps s      WHERE s.game_id = g.id) AS swap_count,
               (SELECT COUNT(*) FROM burns b      WHERE b.game_id = g.id) AS burn_count,
               (SELECT GROUP_CONCAT(COALESCE(player_name,'(open)'), ' vs ')
                  FROM game_seats gs WHERE gs.game_id = g.id)             AS players
          FROM games g ORDER BY g.created_at DESC LIMIT ?`,
};

const ids = (json) => Object.keys(JSON.parse(json));

/** One row per game with move counts — the developer index. */
async function listGames(limit = 50) {
    return db.all(Q.summaries, [limit]);
}

/** Everything recorded about one game, in a single payload. */
async function dump(gameId) {
    const game = await db.get(Q.game, [gameId]);
    if (!game) throw new NotFoundError('Game');

    const [hands, piles, turns, seats, deals, pending, events, history,
           burnRows, swapRows, challengeRows, attackRows] = await Promise.all([
        db.all(Q.hands, [gameId]),
        db.get(Q.piles, [gameId]),
        db.all(Q.turns, [gameId]),
        db.all(Q.seats, [gameId]),
        db.all(Q.deals, [gameId]),
        db.get(Q.pending, [gameId]),
        db.all(Q.events, [gameId]),
        db.all(Q.history, [gameId]),
        db.all(Q.burns, [gameId]),
        db.all(Q.swaps, [gameId]),
        db.all(Q.challenges, [gameId]),
        db.all(Q.attacks, [gameId]),
    ]);

    // Index action detail by turn so the timeline assembles in one pass.
    const burns = new Map(burnRows.map((r) => [r.turn_id, r]));
    const swaps = new Map(swapRows.map((r) => [r.turn_id, r]));
    const challenges = new Map(challengeRows.map((r) => [r.turn_id, r]));
    const attacks = new Map(attackRows.map((r) => [r.turn_id, r]));

    const timeline = turns.map((t) => {
        const base = { turnNo: t.turn_no, turnId: t.id, seat: t.seat, action: t.action,
                       status: t.status, at: t.started_at };
        if (burns.has(t.id)) {
            const b = burns.get(t.id);
            return { ...base, detail: { discarded: b.discarded_card_id, drawn: b.drawn_card_id,
                                        reshuffled: !!b.reshuffled } };
        }
        if (swaps.has(t.id)) {
            const s = swaps.get(t.id);
            return { ...base, detail: { declaredType: s.declared_type, gave: s.initiator_card_id,
                                        received: s.opponent_card_id,
                                        opponentFallback: !!s.opponent_fallback } };
        }
        if (challenges.has(t.id)) {
            const c = challenges.get(t.id);
            return { ...base, detail: {
                challengerCard: c.challenger_card_id,      // hidden from players
                challengeCardType: c.challenge_card_type,
                requiredType: c.required_type,
                response: c.response,
                defenderCard: c.defender_card_id,
                values: [c.challenger_value, c.defender_value],
                wasTie: !!c.was_tie,
                cardEverRevealed: !!c.challenge_card_revealed,
                winnerSeat: c.winner_seat,
                contested: c.contested_card_id,
                giveback: c.giveback_card_id,
                givebackBy: c.giveback_by_seat,
            } };
        }
        if (attacks.has(t.id)) {
            const a = attacks.get(t.id);
            return { ...base, detail: { offenseTotal: a.offense_total, defenseTotal: a.defense_total,
                                        attackerWon: !!a.attacker_won, winnerSeat: a.winner_seat } };
        }
        return { ...base, detail: null };
    });

    const handObjs = [Hand.fromJson(hands[0].hand_json), Hand.fromJson(hands[1].hand_json)];

    // Re-run the invariant so a corrupted game is obvious in the dump itself.
    const integrity = checkDeckIntegrity({
        hands: { 0: JSON.parse(hands[0].hand_json), 1: JSON.parse(hands[1].hand_json) },
        deck: JSON.parse(piles.deck_json),
        discard: JSON.parse(piles.discard_json),
    });

    return {
        game: {
            id: game.id, joinCode: game.join_code, status: game.status,
            currentSeat: game.current_seat, startingSeat: game.starting_seat,
            winnerSeat: game.winner_seat, turnNo: game.turn_no,
            createdAt: game.created_at, finishedAt: game.finished_at,
        },
        seats: seats.map((s) => ({
            seat: s.seat, name: s.player_name, joined: s.seat_token !== null,
            prepTurns: s.prep_turns_completed,
        })),
        hands: [0, 1].map((i) => ({
            seat: i, cards: ids(hands[i].hand_json), version: hands[i].version,
            offense: handObjs[i].offenseTotal(), defense: handObjs[i].defenseTotal(),
        })),
        openingDeal: deals.map((d) => ({ seat: d.seat, cards: ids(d.hand_json) })),
        piles: {
            deck: JSON.parse(piles.deck_json),
            discard: JSON.parse(piles.discard_json),
            deckCount: piles.deck_count,
        },
        pending: pending || null,
        timeline,
        events: events.map((e) => ({ seq: e.seq, type: e.event_type, actorSeat: e.actor_seat,
                                     payload: JSON.parse(e.payload_json), at: e.created_at })),
        handHistory: history.map((h) => ({ turnNo: h.turn_no, seat: h.seat,
                                           cards: ids(h.hand_json) })),
        integrity,
    };
}

module.exports = { listGames, dump };
