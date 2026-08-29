// libSQL client. The SAME code path serves local development and production:
//   local  -> file:./data/redblack.db
//   Turso  -> libsql://<db>-<org>.turso.io  (with TURSO_AUTH_TOKEN)
//
// Everything here is async. SQLite-on-disk cannot be used on serverless hosts
// like Vercel, where the filesystem is ephemeral and per-invocation.

const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

function resolveUrl() {
    if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
    if (process.env.RB_DB_URL) return process.env.RB_DB_URL;

    // On a serverless host the bundle directory is read-only and /tmp is the
    // only writable path. /tmp lives only as long as one container, so this is
    // a fallback that keeps the app from crashing — NOT durable storage.
    // Set TURSO_DATABASE_URL for anything real.
    const file = process.env.RB_DB_PATH
        || (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
            ? '/tmp/redblack.db'
            : path.join(__dirname, '..', '..', 'data', 'redblack.db'));

    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
    } catch { /* read-only fs; libsql will surface any real problem */ }
    return `file:${file}`;
}

const url = resolveUrl();
const client = createClient({
    url,
    ...(process.env.TURSO_AUTH_TOKEN ? { authToken: process.env.TURSO_AUTH_TOKEN } : {}),
});

const isRemote = url.startsWith('libsql://') || url.startsWith('https://');

/** Single row or null. */
async function get(sql, args = []) {
    const rs = await client.execute({ sql, args });
    return rs.rows.length ? rs.rows[0] : null;
}

/** All rows. */
async function all(sql, args = []) {
    const rs = await client.execute({ sql, args });
    return rs.rows;
}

/** Write; returns { rowsAffected, lastInsertRowid }. */
async function run(sql, args = []) {
    const rs = await client.execute({ sql, args });
    return {
        rowsAffected: rs.rowsAffected,
        lastInsertRowid: rs.lastInsertRowid === undefined || rs.lastInsertRowid === null
            ? null : Number(rs.lastInsertRowid),
    };
}

/**
 * Runs `fn` inside a write transaction, passing a tx object with the same
 * get/all/run helpers. Rolls back on any thrown error — which is what keeps
 * the deck-integrity assertion meaningful.
 */
async function transaction(fn) {
    const tx = await client.transaction('write');
    const api = {
        get: async (sql, args = []) => {
            const rs = await tx.execute({ sql, args });
            return rs.rows.length ? rs.rows[0] : null;
        },
        all: async (sql, args = []) => (await tx.execute({ sql, args })).rows,
        run: async (sql, args = []) => {
            const rs = await tx.execute({ sql, args });
            return {
                rowsAffected: rs.rowsAffected,
                lastInsertRowid: rs.lastInsertRowid === undefined || rs.lastInsertRowid === null
                    ? null : Number(rs.lastInsertRowid),
            };
        },
    };
    try {
        const out = await fn(api);
        await tx.commit();
        return out;
    } catch (err) {
        try { await tx.rollback(); } catch { /* already closed */ }
        throw err;
    }
}

/** Executes a multi-statement SQL script (schema application). */
async function executeScript(sql) {
    await client.executeMultiple(sql);
}

module.exports = { client, get, all, run, transaction, executeScript, url, isRemote };
