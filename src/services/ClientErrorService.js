// Captures frontend failures durably. A toast disappearing after a few
// seconds is not a reporting mechanism — this is what CLAUDE.md standard #4
// means by "reported somewhere durable."
//
// Deliberately tolerant: this endpoint is called from error paths, so it
// must never itself become a new source of failure. Inputs are clamped, not
// validated strictly — a malformed report is still worth keeping.

const db = require('../db/client');

const MAX_LEN = { message: 2000, stack: 8000, context: 100, url: 500, ua: 300 };
const clamp = (s, n) => (s == null ? null : String(s).slice(0, n));

async function report({ gameId, seat, context, message, stack, url, userAgent }) {
    const seatNum = seat === 0 || seat === 1 || seat === '0' || seat === '1' ? Number(seat) : null;
    await db.run(
        `INSERT INTO client_errors (game_id, seat, context, message, stack, url, user_agent)
         VALUES (?,?,?,?,?,?,?)`,
        [
            clamp(gameId, 64) || null,
            seatNum,
            clamp(context, MAX_LEN.context) || 'unspecified',
            clamp(message, MAX_LEN.message) || '(no message)',
            clamp(stack, MAX_LEN.stack),
            clamp(url, MAX_LEN.url),
            clamp(userAgent, MAX_LEN.ua),
        ]
    );
}

/** Developer-facing read. Recent first. */
async function recent(limit = 100) {
    return db.all(
        `SELECT * FROM client_errors ORDER BY created_at DESC, id DESC LIMIT ?`,
        [limit]
    );
}

async function forGame(gameId) {
    return db.all(
        `SELECT * FROM client_errors WHERE game_id = ? ORDER BY created_at DESC, id DESC`,
        [gameId]
    );
}

module.exports = { report, recent, forGame };
