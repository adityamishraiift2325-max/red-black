// Engine smoke tests — run with: node --test
const test = require('node:test');
const assert = require('node:assert');

const engine = require('../src/engine/gameEngine');
const { makeCard, sumByType, highestOfType } = require('../src/engine/cards');

// Deterministic rng so tests are reproducible.
function seededRng(seed) {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) % 4294967296;
        return s / 4294967296;
    };
}

test('newGame deals 6 cards each from a 52-card deck', () => {
    const g = engine.newGame(seededRng(42));
    assert.strictEqual(g.hands[0].length, 6);
    assert.strictEqual(g.hands[1].length, 6);
    assert.strictEqual(g.deck.length, 40);
    assert.ok(g.currentPlayer === 0 || g.currentPlayer === 1);
    assert.strictEqual(g.phase, 'preparing');
});

test('burnAndDraw keeps hand size at 6 and passes the turn', () => {
    let g = engine.newGame(seededRng(7));
    const p = g.currentPlayer;
    const toBurn = g.hands[p][0].id;

    g = engine.burnAndDraw(g, p, toBurn);

    assert.strictEqual(g.hands[p].length, 6);
    assert.strictEqual(g.deck.length, 39);
    assert.strictEqual(g.discard.length, 1);
    assert.strictEqual(g.prepTurnsCompleted[p], 1);
    assert.notStrictEqual(g.currentPlayer, p);
});

test('burnAndDraw rejects a card not in hand', () => {
    const g = engine.newGame(seededRng(1));
    assert.throws(
        () => engine.burnAndDraw(g, g.currentPlayer, 'NOPE'),
        /not found/
    );
});

test('burnAndDraw rejects an out-of-turn player', () => {
    const g = engine.newGame(seededRng(1));
    const wrong = g.currentPlayer === 0 ? 1 : 0;
    assert.throws(() => engine.burnAndDraw(g, wrong, g.hands[wrong][0].id), /not player/);
});

// ---- Challenge ------------------------------------------------------------

// P1 holds KH and challenges. P2's highest black is KC — an exact tie.
function tieSetup(seed = 3) {
    const g = engine.newGame(seededRng(seed));
    const p1 = g.currentPlayer;
    const p2 = p1 === 0 ? 1 : 0;
    g.hands[p1] = [makeCard('H', 'K'), makeCard('H', '2'), makeCard('D', '3'),
                   makeCard('S', '4'), makeCard('C', '5'), makeCard('D', '6')];
    g.hands[p2] = [makeCard('C', 'K'), makeCard('C', '2'), makeCard('S', '3'),
                   makeCard('H', '4'), makeCard('D', '5'), makeCard('S', '7')];
    return { g, p1, p2 };
}

test('declaring a challenge discloses the colour but never the card', () => {
    const { g, p1, p2 } = tieSetup();
    const out = engine.declareChallenge(g, p1, 'KH');

    assert.strictEqual(out.pending.type, 'challenge_response');
    assert.strictEqual(out.pending.defender, p2);
    assert.strictEqual(out.pending.challengeCardType, 'red', 'colour is disclosed');
    assert.strictEqual(out.pending.requiredType, 'black', 'defender owes their highest black');

    const declared = out.log[out.log.length - 1];
    assert.strictEqual(declared.event, 'challenge_declared');
    assert.ok(!('challengerCard' in declared), 'the card id must NOT appear in the public log');
    assert.strictEqual(out.hands[p1].length, 6, 'nothing moves yet');
    assert.strictEqual(out.hands[p2].length, 6);
});

test('accepted challenge: a TIE loses for the challenger (KH vs KC)', () => {
    const { g, p1, p2 } = tieSetup();
    let s = engine.declareChallenge(g, p1, 'KH');
    s = engine.respondToChallenge(s, p2, true);

    const res = s.log[s.log.length - 1];
    assert.strictEqual(res.event, 'challenge_resolved');
    assert.strictEqual(res.challengerCard, 'KH');
    assert.strictEqual(res.defenderCard, 'KC');
    assert.strictEqual(res.tie, true);
    assert.strictEqual(res.challengerWins, false, 'defender takes ties');
    assert.strictEqual(res.winner, p2);

    // P2 won, so P2 takes KH — the card P1 attacked with.
    assert.ok(s.hands[p2].some((c) => c.id === 'KH'), 'P2 took the attacking card');
    assert.ok(!s.hands[p1].some((c) => c.id === 'KH'), 'P1 surrendered KH');
    assert.ok(s.hands[p2].some((c) => c.id === 'KC'), 'P2 keeps their own defence card');
    assert.strictEqual(s.hands[p2].length, 7);
    assert.strictEqual(s.hands[p1].length, 5);

    // The WINNER (P2) chooses what P1 gets back, and P1 must accept it.
    assert.strictEqual(s.pending.type, 'winner_giveback');
    assert.strictEqual(s.pending.winner, p2);
    assert.throws(() => engine.completeGiveback(s, p1, '2H'), /Only the challenge winner/);

    s = engine.completeGiveback(s, p2, '2C');
    assert.ok(s.hands[p1].some((c) => c.id === '2C'), 'P1 must accept P2 choice');
    assert.strictEqual(s.hands[p1].length, 6);
    assert.strictEqual(s.hands[p2].length, 6);
    assert.strictEqual(s.prepTurnsCompleted[p1], 1, 'the turn belonged to the challenger');
    assert.strictEqual(s.currentPlayer, p2);
});

test('accepted challenge: challenger strictly higher wins and picks the giveback', () => {
    const { g, p1, p2 } = tieSetup(9);
    g.hands[p1][0] = makeCard('H', 'A');            // AH(14) beats KC(13)
    let s = engine.declareChallenge(g, p1, 'AH');
    s = engine.respondToChallenge(s, p2, true);

    const res = s.log[s.log.length - 1];
    assert.strictEqual(res.challengerWins, true);
    assert.strictEqual(res.tie, false);
    assert.ok(s.hands[p1].some((c) => c.id === 'KC'), 'P1 took the defence card');
    assert.ok(s.hands[p1].some((c) => c.id === 'AH'), 'P1 keeps their own attacking card');
    assert.strictEqual(s.pending.winner, p1);

    s = engine.completeGiveback(s, p1, '2H');
    assert.ok(s.hands[p2].some((c) => c.id === '2H'));
    assert.strictEqual(s.hands[p1].length, 6);
    assert.strictEqual(s.hands[p2].length, 6);
});

test('declined challenge: concedes, surrenders highest black, card stays hidden', () => {
    const { g, p1, p2 } = tieSetup(21);
    let s = engine.declareChallenge(g, p1, 'KH');
    s = engine.respondToChallenge(s, p2, false);

    const res = s.log[s.log.length - 1];
    assert.strictEqual(res.event, 'challenge_declined');
    assert.strictEqual(res.surrenderedCard, 'KC', 'must be their highest black, no substitution');
    assert.strictEqual(res.challengeCardRevealed, false);
    assert.ok(!('challengerCard' in res), 'KH is never disclosed');

    // One-way surrender: KH stays with P1, KC crosses over.
    assert.ok(s.hands[p1].some((c) => c.id === 'KH'), 'challenger keeps their card');
    assert.ok(s.hands[p1].some((c) => c.id === 'KC'), 'and gains the surrendered card');
    assert.strictEqual(s.hands[p1].length, 7);
    assert.strictEqual(s.hands[p2].length, 5);
    assert.ok(!s.revealed[p1].includes('KH'), 'KH is still unknown to P2');

    // Challenger won by concession, so the challenger picks the giveback.
    assert.strictEqual(s.pending.winner, p1);
    s = engine.completeGiveback(s, p1, '3D');
    assert.ok(s.hands[p2].some((c) => c.id === '3D'));
    assert.strictEqual(s.hands[p1].length, 6);
    assert.strictEqual(s.hands[p2].length, 6);
});

test('declining cannot be used to dump a low card', () => {
    const { g, p1, p2 } = tieSetup(33);
    let s = engine.declareChallenge(g, p1, 'KH');
    s = engine.respondToChallenge(s, p2, false);
    // P2 held KC(13), 2C(2), 3S(3), 7S(7) in black. Only KC may go.
    assert.ok(!s.hands[p2].some((c) => c.id === 'KC'));
    assert.ok(s.hands[p2].some((c) => c.id === '2C'), 'low cards are untouched');
});

test('only the challenged player may respond', () => {
    const { g, p1, p2 } = tieSetup(41);
    const s = engine.declareChallenge(g, p1, 'KH');
    assert.throws(() => engine.respondToChallenge(s, p1, true), /Only the challenged player/);
});

test('defender holding none of the required type surrenders outright, no choice offered', () => {
    let g = engine.newGame(seededRng(31));
    const p1 = g.currentPlayer;
    const p2 = p1 === 0 ? 1 : 0;
    // P1 challenges with a LOW red; P2 holds no black at all.
    g.hands[p1] = [makeCard('H', '2'), makeCard('H', '3'), makeCard('D', '3'),
                   makeCard('S', '4'), makeCard('C', '5'), makeCard('C', '6')];
    g.hands[p2] = [makeCard('H', 'K'), makeCard('D', '2'), makeCard('H', '3'),
                   makeCard('D', '4'), makeCard('H', '5'), makeCard('D', '6')];

    const s = engine.declareChallenge(g, p1, '2H');
    const res = s.log[s.log.length - 1];
    assert.strictEqual(res.event, 'challenge_auto_surrender');
    assert.strictEqual(res.surrenderedCard, 'KH', 'highest card overall, no comparison');
    assert.strictEqual(s.pending.type, 'winner_giveback', 'skips accept/decline entirely');
    assert.strictEqual(s.pending.winner, p1);
    assert.ok(s.hands[p1].some((c) => c.id === 'KH'), 'a 2 took a King');
});

test('swap is forced: opponent surrenders their highest of the opposite type', () => {
    let g = engine.newGame(seededRng(13));
    const initiator = g.currentPlayer;
    const opponent = initiator === 0 ? 1 : 0;

    g.hands[initiator] = [makeCard('H', 'K'), makeCard('H', '2'), makeCard('D', '3'),
                          makeCard('S', '4'), makeCard('C', '5'), makeCard('C', '6')];
    g.hands[opponent] = [makeCard('S', 'Q'), makeCard('C', '2'), makeCard('S', '3'),
                         makeCard('H', '4'), makeCard('D', '5'), makeCard('D', '6')];

    g = engine.executeSwap(g, initiator, 'red');

    assert.strictEqual(g.pending, null, 'no consent step — resolves immediately');
    assert.ok(g.hands[initiator].some((c) => c.id === 'QS'), 'initiator got opponent highest black');
    assert.ok(g.hands[opponent].some((c) => c.id === 'KH'), 'opponent forced to hand over QS');
    assert.ok(!g.hands[opponent].some((c) => c.id === 'QS'));
    assert.strictEqual(g.hands[initiator].length, 6);
    assert.strictEqual(g.hands[opponent].length, 6);
    assert.strictEqual(g.prepTurnsCompleted[initiator], 1);
    assert.strictEqual(g.currentPlayer, opponent);
});

test('swap falls back to highest overall when opponent lacks the type', () => {
    let g = engine.newGame(seededRng(29));
    const initiator = g.currentPlayer;
    const opponent = initiator === 0 ? 1 : 0;

    // Initiator gives highest red, so opponent owes highest black — they hold none.
    g.hands[initiator] = [makeCard('H', 'K'), makeCard('H', '2'), makeCard('D', '3'),
                          makeCard('S', '4'), makeCard('C', '5'), makeCard('C', '6')];
    g.hands[opponent] = [makeCard('H', 'J'), makeCard('D', '2'), makeCard('H', '3'),
                         makeCard('D', '4'), makeCard('H', '5'), makeCard('D', '6')];

    g = engine.executeSwap(g, initiator, 'red');

    const last = g.log[g.log.length - 1];
    assert.strictEqual(last.received, 'JH', 'opponent surrendered highest card overall');
    assert.strictEqual(last.opponentFallback, true);
    assert.ok(g.hands[initiator].some((c) => c.id === 'JH'));
});

test('swapped cards become known to the new opponent', () => {
    let g = engine.newGame(seededRng(37));
    const initiator = g.currentPlayer;
    const opponent = initiator === 0 ? 1 : 0;

    g.hands[initiator] = [makeCard('H', 'K'), makeCard('S', '4')];
    g.hands[opponent] = [makeCard('S', 'Q'), makeCard('H', '4')];

    g = engine.executeSwap(g, initiator, 'red');
    assert.ok(g.revealed[initiator].includes('QS'), 'opponent knows initiator now holds QS');
    assert.ok(g.revealed[opponent].includes('KH'), 'initiator knows opponent now holds KH');
});

test('attack is blocked before both players complete 3 prep turns', () => {
    const g = engine.newGame(seededRng(17));
    assert.throws(() => engine.declareAttack(g, g.currentPlayer), /preparation turns/);
});

test('attack resolves: higher offense wins, ties go to the defender', () => {
    let g = engine.newGame(seededRng(19));
    g.prepTurnsCompleted = [3, 3];
    const attacker = g.currentPlayer;
    const defender = attacker === 0 ? 1 : 0;

    // Offense 10+9 = 19 vs Defense 5+4 = 9 -> attacker wins
    g.hands[attacker] = [makeCard('H', '10'), makeCard('D', '9')];
    g.hands[defender] = [makeCard('S', '5'), makeCard('C', '4')];

    const won = engine.declareAttack(g, attacker);
    assert.strictEqual(won.phase, 'finished');
    assert.strictEqual(won.winner, attacker);

    // Exact tie -> attacker loses
    g.hands[attacker] = [makeCard('H', '5'), makeCard('D', '4')];
    g.hands[defender] = [makeCard('S', '5'), makeCard('C', '4')];
    const tied = engine.declareAttack(g, attacker);
    assert.strictEqual(tied.winner, defender, 'tie must favour the defender');
});

// ---- Round cap --------------------------------------------------------------

/** A game one turn away from the cap, with hands fixed for a known outcome. */
function atCapEdge({ p0, p1, startingPlayer = 0, seed = 7 }) {
    const g = engine.newGame(seededRng(seed));
    g.prepTurnsCompleted = [engine.MAX_PREP_TURNS, engine.MAX_PREP_TURNS - 1];
    g.currentPlayer = 1;          // P1 completes the final turn
    g.startingPlayer = startingPlayer;
    g.hands[0] = p0;
    g.hands[1] = p1;
    return g;
}

test('round cap does NOT fire before both players reach the max', () => {
    let g = engine.newGame(seededRng(11));
    g.prepTurnsCompleted = [engine.MAX_PREP_TURNS, engine.MAX_PREP_TURNS - 2];
    g.currentPlayer = 1;
    g = engine.burnAndDraw(g, 1, g.hands[1][0].id);
    assert.strictEqual(g.phase, 'preparing', 'game must continue at 8/7');
    assert.ok(!g.log.some((e) => e.event === 'round_cap_resolved'));
});

test('round cap fires automatically once both reach the max, higher total wins', () => {
    // P0 total 53 (22 off / 31 def) vs P1 total 51 (25 off / 26 def) -> P0.
    // Taken from the worked example that defined this rule.
    const g = atCapEdge({
        p0: [makeCard('H', '10'), makeCard('D', '9'), makeCard('H', '3'),
             makeCard('S', 'K'), makeCard('C', '10'), makeCard('S', '8')],
        p1: [makeCard('D', 'K'), makeCard('H', '9'), makeCard('D', '3'),
             makeCard('C', 'K'), makeCard('S', '9'), makeCard('C', '4')],
    });
    // Swap is 1-for-1 so totals stay intact; burn would replace a card.
    const out = engine.executeSwap(g, 1, 'red');

    const ev = out.log.find((e) => e.event === 'round_cap_resolved');
    assert.ok(ev, 'cap must resolve without anyone declaring an attack');
    assert.strictEqual(out.phase, 'finished');
    assert.strictEqual(out.winner, ev.winner);
    assert.strictEqual(ev.totals[0].total, ev.totals[0].offense + ev.totals[0].defense);
    assert.strictEqual(ev.tie, false);
    // Net is symmetric: whatever P0 nets, P1 nets the negative.
    const net0 = ev.margins[0].attack + ev.margins[0].defence;
    const net1 = ev.margins[1].attack + ev.margins[1].defence;
    assert.strictEqual(net0, -net1, 'margins must be symmetric');
    assert.strictEqual(net0 > 0, ev.winner === 0, 'positive net must mean a win');
});

test('round cap tie goes to the player who did NOT start', () => {
    // Identical totals (both 30) — only the tie-break can decide.
    const mk = () => [makeCard('H', '10'), makeCard('D', '5'), makeCard('S', '10'), makeCard('C', '5')];

    for (const starter of [0, 1]) {
        const g = atCapEdge({ p0: mk(), p1: mk(), startingPlayer: starter, seed: 19 });
        const out = engine.executeSwap(g, 1, 'red');
        const ev = out.log.find((e) => e.event === 'round_cap_resolved');
        assert.strictEqual(ev.tie, true, 'totals should be equal');
        assert.strictEqual(out.winner, starter === 0 ? 1 : 0,
            `starter P${starter} must lose the tie`);
    }
});

test('round cap resolution is terminal - no further actions allowed', () => {
    const g = atCapEdge({
        p0: [makeCard('H', 'K'), makeCard('S', '9')],
        p1: [makeCard('D', '4'), makeCard('C', '3')],
    });
    const out = engine.executeSwap(g, 1, 'red');
    assert.strictEqual(out.phase, 'finished');
    assert.throws(() => engine.burnAndDraw(out, out.currentPlayer, out.hands[out.currentPlayer][0].id),
        /already finished/);
    assert.throws(() => engine.declareAttack(out, out.currentPlayer), /already finished/);
});

test('turnsUntilRoundCap counts down per player', () => {
    const g = engine.newGame(seededRng(23));
    assert.deepStrictEqual(engine.turnsUntilRoundCap(g), [8, 8]);
    g.prepTurnsCompleted = [7, 8];
    assert.deepStrictEqual(engine.turnsUntilRoundCap(g), [1, 0]);
    g.prepTurnsCompleted = [9, 9]; // never negative
    assert.deepStrictEqual(engine.turnsUntilRoundCap(g), [0, 0]);
});

// ---- New-card highlight -----------------------------------------------------

test('a drawn card is marked new, survives the opponent turn, clears on your next', () => {
    let g = engine.newGame(seededRng(42));
    const p = g.currentPlayer;
    const q = p === 0 ? 1 : 0;

    g = engine.burnAndDraw(g, p, g.hands[p][0].id);
    const drawn = g.log[g.log.length - 1].drawn;
    assert.deepStrictEqual(g.freshCards[p], { [drawn]: 'draw' }, 'exactly the drawn card is new');

    // The opponent acting must NOT clear the other player's highlight.
    g = engine.burnAndDraw(g, q, g.hands[q][0].id);
    assert.strictEqual(g.freshCards[p][drawn], 'draw', 'highlight survives their turn');

    // Acting again clears the old one and marks only the newly drawn card.
    const keep = g.hands[p].find((c) => c.id !== drawn);
    g = engine.burnAndDraw(g, p, keep.id);
    const drawn2 = g.log[g.log.length - 1].drawn;
    assert.ok(!(drawn in g.freshCards[p]), 'spent highlight is cleared');
    assert.strictEqual(g.freshCards[p][drawn2], 'draw');
});

test('a forced swap marks the new card for BOTH players', () => {
    let g = engine.newGame(seededRng(13));
    const p = g.currentPlayer;
    const q = p === 0 ? 1 : 0;
    g.hands[p] = [makeCard('H', 'K'), makeCard('S', '4')];
    g.hands[q] = [makeCard('S', 'Q'), makeCard('H', '4')];

    g = engine.executeSwap(g, p, 'red');
    assert.strictEqual(g.freshCards[p]['QS'], 'swap', 'initiator sees what they received');
    assert.strictEqual(g.freshCards[q]['KH'], 'swap', 'opponent sees what was forced on them');
});

test('a card that leaves the hand loses its new marker', () => {
    let g = engine.newGame(seededRng(5));
    const p = g.currentPlayer;
    const q = p === 0 ? 1 : 0;
    g = engine.burnAndDraw(g, p, g.hands[p][0].id);
    const drawn = g.log[g.log.length - 1].drawn;
    assert.ok(drawn in g.freshCards[p]);

    // Force that exact card out via a swap initiated by the opponent.
    g.hands[p] = [{ ...g.hands[p].find((c) => c.id === drawn) }];
    g.hands[q] = [makeCard(g.hands[p][0].type === 'red' ? 'S' : 'H', 'A')];
    const type = g.hands[p][0].type === 'red' ? 'black' : 'red';
    g = engine.executeSwap(g, q, type);
    assert.ok(!(drawn in g.freshCards[p]), 'a card no longer held cannot stay highlighted');
});

test('engine actions are immutable - original state is untouched', () => {
    const g = engine.newGame(seededRng(23));
    const before = JSON.stringify(g);
    engine.burnAndDraw(g, g.currentPlayer, g.hands[g.currentPlayer][0].id);
    assert.strictEqual(JSON.stringify(g), before);
});

test('highestOfType honours the owner tie-break choice', () => {
    const hand = [makeCard('H', 'K'), makeCard('D', 'K'), makeCard('S', '2')];
    assert.strictEqual(highestOfType(hand, 'red', 'KD').id, 'KD');
    assert.strictEqual(highestOfType(hand, 'red', 'KH').id, 'KH');
    assert.strictEqual(sumByType(hand, 'red'), 26);
});
