// The challenge — three separate calls so each step is its own endpoint,
// its own transaction and its own failure point.
//
//   declare()  -> challenger names a card (kept hidden from the defender)
//   respond()  -> defender accepts or declines
//   giveback() -> the winner returns a card of their choosing

const { applyAction, assertCardId, findEvent, repo, engine, db } = require('./GameContext');
const { Challenge, RESPONSE } = require('../models/Challenge');
const { IllegalMoveError, NotFoundError } = require('./errors');

const Q = {
    insert: `INSERT INTO challenges (turn_id,game_id,challenger_seat,defender_seat,
             challenger_card_id,challenge_card_type,required_type) VALUES (?,?,?,?,?,?,?)`,
    respond: `UPDATE challenges SET response=?, defender_card_id=?, challenger_value=?,
              defender_value=?, was_tie=?, challenge_card_revealed=?, winner_seat=?,
              loser_seat=?, contested_card_id=?, responded_at=datetime('now') WHERE turn_id=?`,
    giveback: `UPDATE challenges SET giveback_card_id=?, giveback_by_seat=?,
               resolved_at=datetime('now') WHERE turn_id=?`,
    open: `SELECT * FROM challenges WHERE game_id=? AND resolved_at IS NULL
           ORDER BY turn_id DESC LIMIT 1`,
    history: `SELECT * FROM challenges WHERE game_id=? ORDER BY turn_id`,
};

/* ── STEP 1 ─────────────────────────────────────────────────────────── */

async function declare(gameId, seat, cardId) {
    const id = assertCardId(cardId);

    const { after, turnId } = await applyAction(
        gameId,
        (state) => engine.declareChallenge(state, seat, id),
        { action: 'challenge', seat, newTurn: 'challenge', turnStatus: 'open' },
        async ({ after: next, turnId: tid, tx }) => {
            // declareChallenge never calls endTurn, so this is safe even
            // without findEvent — kept consistent with the rest of this file
            // anyway, so a future engine change can't silently reintroduce
            // the round-cap bug that hit Burn/Swap.
            const ev = findEvent(next.log, 'challenge_declared')
                    || findEvent(next.log, 'challenge_auto_surrender');
            const requiredType = ev.requiredType;
            const cardType = requiredType === 'black' ? 'red' : 'black';
            await tx.run(Q.insert, [tid, gameId, seat,
                next.pending.loser ?? next.pending.defender, id, cardType, requiredType]);

            if (ev.event === 'challenge_auto_surrender') {
                await tx.run(Q.respond, [RESPONSE.AUTO_SURRENDER, ev.surrenderedCard, null, null,
                    0, 0, seat, next.pending.loser, ev.surrenderedCard, tid]);
            }
        }
    );

    const ev = findEvent(after.log, 'challenge_declared') || findEvent(after.log, 'challenge_auto_surrender');
    const auto = ev.event === 'challenge_auto_surrender';
    return {
        turnId, autoSurrendered: auto,
        challengeCardType: auto ? undefined : ev.challengeCardType,
        requiredType: ev.requiredType,
        surrenderedCard: auto ? ev.surrenderedCard : undefined,
        awaiting: auto ? 'giveback' : 'defender_response',
        actorSeat: after.pending.type === 'winner_giveback'
            ? after.pending.winner : after.pending.defender,
    };
}

/* ── STEP 2 ─────────────────────────────────────────────────────────── */

async function respond(gameId, seat, accept) {
    if (typeof accept !== 'boolean') {
        throw new IllegalMoveError('accept must be true (accept) or false (decline).');
    }
    const open = await db.get(Q.open, [gameId]);
    if (!open) throw new NotFoundError('Open challenge');
    const turnId = open.turn_id;

    const { after } = await applyAction(
        gameId,
        (state) => engine.respondToChallenge(state, seat, accept),
        { action: 'challenge_response', seat, turnId },
        async ({ after: next, tx }) => {
            // respondToChallenge never calls endTurn either — safe, kept
            // consistent for the same reason as declare() above.
            const ev = findEvent(next.log, 'challenge_resolved')
                    || findEvent(next.log, 'challenge_declined');
            if (accept) {
                await tx.run(Q.respond, [RESPONSE.ACCEPTED, ev.defenderCard, ev.challengerValue,
                    ev.defenderValue, ev.tie ? 1 : 0, 1, ev.winner, ev.winner === 0 ? 1 : 0,
                    next.pending.contestedCardId, turnId]);
            } else {
                // No comparison happened: values stay NULL and the challenge
                // card is never marked revealed.
                await tx.run(Q.respond, [RESPONSE.DECLINED, ev.surrenderedCard, null, null, 0, 0,
                    next.pending.winner, next.pending.loser, next.pending.contestedCardId, turnId]);
            }
        }
    );

    const ev = findEvent(after.log, 'challenge_resolved') || findEvent(after.log, 'challenge_declined');
    return accept
        ? { turnId, response: 'accepted', challengerCard: ev.challengerCard,
            defenderCard: ev.defenderCard, challengerValue: ev.challengerValue,
            defenderValue: ev.defenderValue, wasTie: ev.tie, winnerSeat: ev.winner,
            contestedCard: after.pending.contestedCardId, awaiting: 'giveback',
            actorSeat: after.pending.winner }
        : { turnId, response: 'declined', surrenderedCard: ev.surrenderedCard,
            challengeCardRevealed: false, winnerSeat: after.pending.winner,
            contestedCard: after.pending.contestedCardId, awaiting: 'giveback',
            actorSeat: after.pending.winner };
}

/* ── STEP 3 ─────────────────────────────────────────────────────────── */

async function giveback(gameId, seat, cardId) {
    const id = assertCardId(cardId);
    const open = await db.get(Q.open, [gameId]);
    if (!open) throw new NotFoundError('Open challenge');
    const turnId = open.turn_id;

    const { after } = await applyAction(
        gameId,
        (state) => engine.completeGiveback(state, seat, id),
        { action: 'giveback', seat, turnId },
        async ({ tx }) => {
            await tx.run(Q.giveback, [id, seat, turnId]);
            await tx.run(repo.SQL.completeTurn, [turnId]);
        }
    );

    return {
        turnId, given: id, givenBySeat: seat,
        nextSeat: after.currentPlayer, prepTurns: after.prepTurnsCompleted,
        // completeGiveback DOES call endTurn, so a giveback can be the action
        // that completes the round cap.
        roundCapResolved: after.phase === 'finished',
    };
}

/* ── reads ──────────────────────────────────────────────────────────── */

async function currentFor(gameId, viewer) {
    const row = await db.get(Q.open, [gameId]);
    if (!row) return null;
    return new Challenge(row).viewFor(Number(viewer));
}

async function history(gameId) {
    return (await db.all(Q.history, [gameId])).map((r) => new Challenge(r));
}

module.exports = { declare, respond, giveback, currentFor, history };
