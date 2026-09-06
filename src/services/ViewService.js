// Read-only projections. Every redaction lives here, so "a player never sees
// the opponent's cards" is enforced in one place.

const { loadGame, repo, db } = require('./GameContext');
const { IllegalMoveError } = require('./errors');
const ChallengeService = require('./ChallengeService');

/** The per-seat game view — what a player's screen renders from. */
async function forSeat(gameId, seat) {
    const [game, pendingChallenge] = await Promise.all([
        loadGame(gameId),
        ChallengeService.currentFor(gameId, Number(seat)),
    ]);
    const s = Number(seat);
    const opp = game.opponentOf(s);
    const legal = game.legalActions(s);
    const seats = game.seatRows;   // already loaded by loadGame

    return {
        gameId: game.id,
        joinCode: game.joinCode,
        you: s,
        yourName: seats[s].player_name,
        opponentName: seats[opp].player_name,
        opponentJoined: seats[opp].seat_token !== null,
        status: game.status,
        currentSeat: game.currentSeat,
        yourTurn: game.isSeatsTurn(s) && game.status !== 'lobby',
        yourHand: game.handOf(s).visible(),
        opponentCardCount: game.handOf(opp).size,
        yourTotals: {
            offense: game.handOf(s).offenseTotal(),
            defense: game.handOf(s).defenseTotal(),
        },
        prepTurns: { you: game.prepTurns[s], opponent: game.prepTurns[opp] },
        // Round cap: drives the turn-7 warning so a forced resolution reads as
        // a countdown rather than a gotcha.
        turnsUntilCap: {
            you: game.turnsUntilRoundCap()[s],
            opponent: game.turnsUntilRoundCap()[opp],
        },
        isFinalPrepTurn: game.isFinalPrepTurn(s),
        canAttack: game.canAttack(),
        legalActions: game.status === 'lobby' ? [] : legal.actions,
        blockedReason: game.status === 'lobby'
            ? 'Waiting for a second player to join.' : legal.reason,
        attackBlockedBy: legal.attackBlockedBy ?? null,
        deckCount: game.deckCount,
        pendingChallenge,
        winnerSeat: game.winnerSeat,
        youWon: game.winnerSeat === null ? null : game.winnerSeat === s,
        finalReveal: game.isFinished() ? await finalRevealFor(gameId, game, s, opp) : null,
    };
}

/** Post-game disclosure: safe only once the game is over. */
async function finalRevealFor(gameId, game, seat, opp) {
    const atk = await db.get(
        `SELECT * FROM attacks WHERE game_id=? ORDER BY turn_id DESC LIMIT 1`, [gameId]);
    return {
        opponentHand: game.handOf(opp).visible(),
        opponentTotals: { offense: game.handOf(opp).offenseTotal(),
                          defense: game.handOf(opp).defenseTotal() },
        yourTotals: { offense: game.handOf(seat).offenseTotal(),
                      defense: game.handOf(seat).defenseTotal() },
        attack: atk ? {
            kind: atk.resolution_kind || 'declared',
            attackerSeat: atk.attacker_seat, defenderSeat: atk.defender_seat,
            offenseTotal: atk.offense_total, defenseTotal: atk.defense_total,
            // Only meaningful for a declared attack. On a round cap nobody
            // attacked — the client must branch on `kind` and not narrate
            // "you attacked" for a resolution the player never chose.
            youAttacked: (atk.resolution_kind || 'declared') === 'declared'
                && atk.attacker_seat === seat,
            winnerSeat: atk.winner_seat,
            margin: atk.offense_total - atk.defense_total,
            // Round-cap detail: both sides' totals, oriented to this viewer.
            roundCap: (atk.resolution_kind === 'round_cap') ? {
                yourTotal: seat === 0 ? atk.seat0_total : atk.seat1_total,
                theirTotal: seat === 0 ? atk.seat1_total : atk.seat0_total,
                netMargin: seat === 0 ? atk.net_margin : -atk.net_margin,
                wasTie: !!atk.was_tie,
            } : null,
        } : null,
    };
}

/** Lobby status — safe to poll without a token. Reveals nothing about hands. */
async function lobbyStatus(gameId) {
    const g = await repo.findGame(gameId);
    if (!g) return null;
    const seats = await repo.getSeats(g.id);
    return {
        gameId: g.id,
        joinCode: g.join_code,
        status: g.status,
        players: seats.map((s) => ({
            seat: s.seat, name: s.player_name, joined: s.seat_token !== null })),
        ready: seats.every((s) => s.seat_token !== null),
    };
}

/** Full unredacted state. Debug/referee only. */
async function fullState(gameId) {
    const game = await loadGame(gameId);
    return {
        gameId: game.id, status: game.status, currentSeat: game.currentSeat,
        hands: [game.handOf(0).visible(), game.handOf(1).visible()],
        totals: game.totals(), prepTurns: game.prepTurns,
        canAttack: game.canAttack(), pending: game.pending,
        deckCount: game.deckCount, winnerSeat: game.winnerSeat,
    };
}

async function handFor(gameId, seat) {
    const game = await loadGame(gameId);
    const s = Number(seat);
    return { seat: s, cards: game.handOf(s).visible(), size: game.handOf(s).size,
             offenseTotal: game.handOf(s).offenseTotal(),
             defenseTotal: game.handOf(s).defenseTotal() };
}

async function legalActions(gameId, seat) {
    const game = await loadGame(gameId);
    return { seat: Number(seat), ...game.legalActions(Number(seat)) };
}

async function pending(gameId) {
    return (await loadGame(gameId)).pending;
}

async function events(gameId, seat = null) {
    const rows = await db.all(repo.SQL.getEvents, [gameId]);
    return rows
        .filter((r) => seat === null || r.visibility === 'public' || r.visibility === `seat_${seat}`)
        .map((r) => ({ seq: r.seq, type: r.event_type, actorSeat: r.actor_seat,
                       payload: JSON.parse(r.payload_json), at: r.created_at }));
}

async function turns(gameId) {
    return db.all(`SELECT * FROM turns WHERE game_id=? ORDER BY turn_no`, [gameId]);
}

async function openingDeal(gameId) {
    const rows = await db.all(
        `SELECT seat, hand_json FROM initial_deals WHERE game_id=? ORDER BY seat`, [gameId]);
    return rows.map((r) => ({ seat: r.seat, cards: Object.keys(JSON.parse(r.hand_json)) }));
}

/**
 * Turns one raw event row into a plain-text narrative sentence, from `seat`'s
 * point of view ("you" vs the opponent's name). This is the ONLY place that
 * reads event_type/payload_json for the player-facing log — the response
 * playerLog() returns carries just these finished sentences, never the raw
 * event shape, so a client inspecting the response cannot learn engine/event
 * internals (docs/BACKLOG.md item 1's explicit requirement).
 *
 * Deliberately mirrors describeEvent() in public/actions.js (same voice, same
 * cases) rather than sharing a module with it — this app has no build step,
 * and that client copy is ESM while this is CommonJS. Keep the two in sync by
 * hand if a new event type is added; see docs/BACKLOG.md standard #13.
 *
 * A card id left in the text (e.g. "9D") is plain text, not markup — the
 * client re-uses the existing prettyCard() regex helper to colour it, so this
 * function never has to know about HTML.
 */
function narrate(e, viewerSeat, names) {
    const p = e.payload || {};
    const who = (s) => (s === viewerSeat ? 'You' : (names[s] || 'Opponent'));
    switch (e.type) {
        case 'game_created':        return `${who(p.hostSeat)} created the room.`;
        case 'player_joined':       return `${p.name} joined. Game on.`;
        case 'player_reclaimed':    return `${who(p.seat)} reconnected.`;
        case 'game_started':        return 'Cards dealt. 6 each.';
        case 'burn_draw':           return `${who(p.player)} burned a card and drew.`;
        case 'swap_executed':       return `${who(p.initiator)} forced a swap: ${p.gave} out, ${p.received} in.`;
        // The demanded colour only — never the card itself. Even from the
        // challenger's own end-of-game log: docs/DECISIONS.md says a declined
        // challenge card "stays hidden forever," and the stored payload for
        // this event never carries it in the first place (see gameEngine.js),
        // so there is nothing to withhold here beyond what's already true.
        case 'challenge_declared':
            return `${who(p.challenger)} challenged with a ${p.challengeCardType} card — demanding the highest ${p.requiredType}.`;
        case 'challenge_resolved':
            return `Revealed: ${p.challengerCard} vs ${p.defenderCard}` +
                   (p.tie ? ' — a tie, so the defender takes it. ' : ' — ') +
                   `${who(p.winner)} won the challenge.`;
        case 'challenge_declined':
            return `${who(p.defender)} declined without looking and forfeited ${p.surrenderedCard}.`;
        case 'challenge_auto_surrender':
            return `${who(p.defender)} held no ${p.requiredType} card — ${p.surrenderedCard} surrendered outright.`;
        case 'giveback':            return `${who(p.winner)} handed back ${p.given}.`;
        case 'attack':
            return `${who(p.attacker)} attacked — offense ${p.offenseTotal} vs defense ${p.defenseTotal}. ` +
                   `${who(p.winner)} won.`;
        case 'round_cap_resolved':
            return `Neither of you attacked — the ${p.maxPrepTurns}-turn limit settled it. ` +
                   `${who(p.winner)} won${p.tie ? ' on the tie-break' : ''}.`;
        default: return null; // an event type this narrator doesn't know yet — see comment above
    }
}

/**
 * The same margin/claim the result screen shows (see showResult() in
 * public/dialogs.js) — reused here so the log is self-contained even for a
 * player who dismissed or never saw the result screen. Returns ready-made
 * display fields (a claim sentence + a magnitude), not the raw attacker/
 * winner seats, for the same reason narrate() returns sentences rather than
 * event shapes: this endpoint's contract is "no internals to interpret."
 *
 * `null` on a round-cap TIE, same as the result screen's own callout — there
 * is no magnitude to lead with when a tie-break RULE decided it, not a
 * number.
 */
function resultMargin(atk, seat, opponentName) {
    if (!atk) return null;
    const wonByYou = atk.winner_seat === seat;
    if ((atk.resolution_kind || 'declared') === 'round_cap') {
        if (atk.was_tie) return null;
        const netMargin = seat === 0 ? atk.net_margin : -atk.net_margin;
        return { claim: `${wonByYou ? 'You' : opponentName} had the better hand`,
                 magnitude: Math.abs(netMargin) };
    }
    const attackerWon = atk.winner_seat === atk.attacker_seat;
    const stat = attackerWon ? 'offense' : 'defense';
    return { claim: `${wonByYou ? 'You' : opponentName} had the better ${stat}`,
             magnitude: Math.abs(atk.offense_total - atk.defense_total) };
}

/**
 * The player-facing end-of-game log (docs/BACKLOG.md item 1). Available only
 * once the game is over — see docs/DECISIONS.md § Player-log vs admin-log
 * segregation for why this is a purpose-built read rather than the admin
 * inspector filtered down: it never returns function/service/table names or
 * a raw event payload, only narrated sentences and the viewer's own cards.
 */
async function playerLog(gameId, seat) {
    const game = await loadGame(gameId);
    if (!game.isFinished()) {
        throw new IllegalMoveError('The game log is available once the game ends.');
    }
    const s = Number(seat);
    const names = { 0: game.seatRows[0].player_name, 1: game.seatRows[1].player_name };

    // events() already filters to what this seat may see — today every event
    // is written 'public' (see gameRepo.js), so this includes both players'
    // moves; the OPEN backlog question ("your moves only, or the opponent's
    // public actions too") is resolved here as "both", matching a two-player
    // narrative and requiring no plumbing change either way if that's revisited.
    const raw = await events(gameId, s);
    const entries = raw
        .map((e) => ({ seq: e.seq, at: e.at, actorSeat: e.actorSeat,
                       isYou: e.actorSeat === s, text: narrate(e, s, names) }))
        .filter((e) => e.text !== null);

    const opponentName = names[game.opponentOf(s)];
    const atk = await db.get(
        `SELECT * FROM attacks WHERE game_id=? ORDER BY turn_id DESC LIMIT 1`, [gameId]);

    return {
        gameId: game.id,
        you: s,
        yourName: names[s],
        opponentName,
        youWon: game.winnerSeat === s,
        result: resultMargin(atk, s, opponentName),
        entries,
        // Only ever the viewer's own hand — the opponent's is not this
        // endpoint's business; the result screen's existing finalReveal
        // already covers "what they were holding" separately.
        //
        // Just the closing hand, not opening-vs-closing side by side: a
        // side-by-side comparison made the player do the diffing themselves.
        // Each card already carries its own `acquired` provenance (deal /
        // draw / swap / challenge — see Hand.js), so tagging each card in
        // the one hand tells the "how it changed" story directly.
        yourClosingHand: game.handOf(s).visible(),
    };
}

module.exports = {
    forSeat, lobbyStatus, fullState, handFor, legalActions, pending,
    events, turns, openingDeal, playerLog,
};
