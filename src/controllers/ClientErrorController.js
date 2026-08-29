// Intentionally unauthenticated: a failed join or a broken token means the
// player has no valid seat token to send anyway, and that's exactly the
// failure we most need to see. Never trust this input, never let it throw
// back to the caller — an error report failing is not the player's problem.

const ClientErrorService = require('../services/ClientErrorService');

const handle = (fn) => (req, res, next) => { Promise.resolve(fn(req, res)).catch(next); };

const report = handle(async (req, res) => {
    const b = req.body || {};
    try {
        await ClientErrorService.report({
            gameId: b.gameId, seat: b.seat, context: b.context,
            message: b.message, stack: b.stack, url: b.url,
            userAgent: req.get('user-agent'),
        });
    } catch (err) {
        // Swallow: reporting a failure must never itself fail the request.
        console.error('client-error report failed to persist:', err.message);
    }
    res.status(204).end();
});

const list = handle(async (req, res) => {
    res.json(await ClientErrorService.recent(Number(req.query.limit) || 100));
});

const forGame = handle(async (req, res) => {
    res.json(await ClientErrorService.forGame(req.params.id));
});

module.exports = { report, list, forGame };
