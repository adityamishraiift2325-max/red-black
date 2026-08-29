// The challenge gets its own controller: it is the only three-step action,
// and each step is issued by a different player.

const ChallengeService = require('../services/ChallengeService');
const { handle, callerSeat } = require('./GameController');
const { assertGameReady } = require('../services/GameContext');

/** POST .../challenge — challenger names a card (never echoed to the defender). */
const declare = handle(async (req, res) => {
    const seat = await callerSeat(req);
    await assertGameReady(req.params.id);
    res.status(201).json(await ChallengeService.declare(req.params.id, seat, req.body.cardId));
});

/** POST .../challenge/accept — defender reveals their highest of the required type. */
const accept = handle(async (req, res) => {
    const seat = await callerSeat(req);
    res.json(await ChallengeService.respond(req.params.id, seat, true));
});

/** POST .../challenge/decline — defender concedes blind and forfeits the card. */
const decline = handle(async (req, res) => {
    const seat = await callerSeat(req);
    res.json(await ChallengeService.respond(req.params.id, seat, false));
});

/** POST .../challenge/giveback — the winner returns a card of their choosing. */
const giveback = handle(async (req, res) => {
    const seat = await callerSeat(req);
    res.json(await ChallengeService.giveback(req.params.id, seat, req.body.cardId));
});

/** GET .../challenge — the open challenge, redacted for the calling seat. */
const current = handle(async (req, res) => {
    const seat = await callerSeat(req);
    res.json({ challenge: await ChallengeService.currentFor(req.params.id, seat) });
});

const history = handle(async (req, res) =>
    res.json(await ChallengeService.history(req.params.id)));

module.exports = { declare, accept, decline, giveback, current, history };
