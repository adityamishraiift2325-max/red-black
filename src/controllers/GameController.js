// Middle layer: pull params, call ONE service, shape the response.
//
// Authorisation lives here too. Every seat-scoped route resolves the caller's
// seat from their bearer token rather than trusting a `seat` field in the
// request — otherwise anyone could ask for the other player's hand.

const DealService = require('../services/DealService');
const BurnService = require('../services/BurnService');
const SwapService = require('../services/SwapService');
const AttackService = require('../services/AttackService');
const ViewService = require('../services/ViewService');
const { resolveCallerSeat, assertGameReady } = require('../services/GameContext');

/** Async handler wrapper — rejected promises reach the error middleware. */
const handle = (fn) => (req, res, next) => { Promise.resolve(fn(req, res)).catch(next); };

/** Bearer token from the Authorization header, or an x-seat-token header. */
function tokenOf(req) {
    const auth = req.get('authorization');
    if (auth && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
    return req.get('x-seat-token') || req.body?.token || req.query?.token || null;
}

/** The caller's seat, derived from their token — never from the request. */
const callerSeat = (req) => resolveCallerSeat(req.params.id, tokenOf(req));

/* ── lobby ──────────────────────────────────────────────────────────── */

const create = handle(async (req, res) => {
    const r = await DealService.createGame({ hostName: req.body?.name });
    res.status(201).json({
        gameId: r.gameId, joinCode: r.joinCode, seat: r.seat,
        token: r.token, name: r.hostName, status: 'lobby',
    });
});

const join = handle(async (req, res) => {
    const r = await DealService.joinGame({ code: req.body?.code, playerName: req.body?.name });
    res.status(200).json({
        gameId: r.gameId, joinCode: r.joinCode, seat: r.seat,
        token: r.token, name: r.playerName, status: 'preparing',
    });
});

/** Pollable while waiting in the lobby. Discloses no card information. */
const lobby = handle(async (req, res) => {
    const s = await ViewService.lobbyStatus(req.params.id);
    if (!s) return res.status(404).json({ error: 'Game not found', code: 'NOT_FOUND' });
    res.json(s);
});

const list = handle(async (req, res) => res.json(await ViewService.listGames()));

/* ── seat-scoped reads (token required) ─────────────────────────────── */

const getSeatView = handle(async (req, res) => {
    const seat = await callerSeat(req);
    res.json(await ViewService.forSeat(req.params.id, seat));
});

const getHand = handle(async (req, res) => {
    const seat = await callerSeat(req);
    res.json(await ViewService.handFor(req.params.id, seat));
});

const getLegalActions = handle(async (req, res) => {
    const seat = await callerSeat(req);
    res.json(await ViewService.legalActions(req.params.id, seat));
});

const previewAttack = handle(async (req, res) => {
    const seat = await callerSeat(req);
    res.json(await AttackService.previewAttack(req.params.id, seat));
});

const getEvents = handle(async (req, res) =>
    res.json(await ViewService.events(req.params.id, req.query.seat ?? null)));
const getPending = handle(async (req, res) =>
    res.json({ pending: await ViewService.pending(req.params.id) }));
const getTurns = handle(async (req, res) => res.json(await ViewService.turns(req.params.id)));
const getOpeningDeal = handle(async (req, res) =>
    res.json(await ViewService.openingDeal(req.params.id)));
const getState = handle(async (req, res) => res.json(await ViewService.fullState(req.params.id)));

/* ── turn actions (token required) ──────────────────────────────────── */

const burn = handle(async (req, res) => {
    const seat = await callerSeat(req);
    await assertGameReady(req.params.id);
    res.json(await BurnService.burnAndDraw(req.params.id, seat, req.body.cardId));
});

const swap = handle(async (req, res) => {
    const seat = await callerSeat(req);
    await assertGameReady(req.params.id);
    res.json(await SwapService.executeSwap(req.params.id, seat, req.body.type,
                                           req.body.tieBreakId ?? null));
});

const attack = handle(async (req, res) => {
    const seat = await callerSeat(req);
    await assertGameReady(req.params.id);
    res.json(await AttackService.declareAttack(req.params.id, seat));
});

module.exports = {
    create, join, lobby, list,
    getState, getSeatView, getHand, getLegalActions, getPending,
    getEvents, getTurns, getOpeningDeal, previewAttack,
    burn, swap, attack,
    tokenOf, callerSeat, handle,
};
