// Developer inspection endpoints. Unredacted — keep off the player client.

const DebugService = require('../services/DebugService');

const handle = (fn) => (req, res, next) => { Promise.resolve(fn(req, res)).catch(next); };

const list = handle(async (req, res) =>
    res.json(await DebugService.listGames(Number(req.query.limit) || 50)));

const dump = handle(async (req, res) =>
    res.json(await DebugService.dump(req.params.id)));

const exportJson = handle(async (req, res) => {
    const data = await DebugService.dump(req.params.id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition',
        `attachment; filename="red-black-${req.params.id.slice(0, 8)}.json"`);
    res.send(JSON.stringify(data, null, 2));
});

module.exports = { list, dump, exportJson };
