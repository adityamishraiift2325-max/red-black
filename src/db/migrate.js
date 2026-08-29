// Applies schema.sql and seeds the immutable `cards` reference table.
// Safe to run repeatedly. Works against a local file or Turso.

const path = require('path');
const fs = require('fs');
const db = require('./client');
const { freshDeck } = require('../engine/cards');

// `CREATE TABLE IF NOT EXISTS` in schema.sql only ever creates a NEW table —
// against a database where the table already exists (i.e. every real
// deployment after the first), adding a column to schema.sql is a silent
// no-op. This bit us directly: last_seen_at was added to game_seats for the
// reclaim feature, schema.sql ran clean against production, and the column
// never actually appeared. Every column added AFTER initial launch needs an
// explicit entry here — schema.sql alone is not enough for an existing DB.
const COLUMN_MIGRATIONS = [
    { table: 'game_seats', column: 'last_seen_at', ddl: 'ALTER TABLE game_seats ADD COLUMN last_seen_at TEXT' },
    // Round cap (phase 1). SQLite cannot add a CHECK constraint via ALTER, so
    // resolution_kind is a plain TEXT here while a fresh DB gets the
    // constrained version from schema.sql — the app only ever writes the two
    // valid values, and back-filling existing rows to 'declared' is correct
    // since every game that predates the cap ended by a declared attack.
    { table: 'attacks', column: 'resolution_kind',
      ddl: "ALTER TABLE attacks ADD COLUMN resolution_kind TEXT NOT NULL DEFAULT 'declared'" },
    { table: 'attacks', column: 'seat0_total', ddl: 'ALTER TABLE attacks ADD COLUMN seat0_total INTEGER' },
    { table: 'attacks', column: 'seat1_total', ddl: 'ALTER TABLE attacks ADD COLUMN seat1_total INTEGER' },
    { table: 'attacks', column: 'net_margin', ddl: 'ALTER TABLE attacks ADD COLUMN net_margin INTEGER' },
    { table: 'attacks', column: 'was_tie',
      ddl: 'ALTER TABLE attacks ADD COLUMN was_tie INTEGER NOT NULL DEFAULT 0' },
];

async function applyColumnMigrations() {
    for (const { table, column, ddl } of COLUMN_MIGRATIONS) {
        const cols = await db.all(`PRAGMA table_info(${table})`);
        const has = cols.some((c) => c.name === column);
        if (!has) await db.run(ddl);
    }
}

let applied = null;

async function migrate() {
    if (applied) return applied;
    applied = (async () => {
        await db.executeScript(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
        await applyColumnMigrations();
        const { n } = await db.get('SELECT COUNT(*) AS n FROM cards');
        if (Number(n) < 52) {
            await db.transaction(async (tx) => {
                for (const c of freshDeck()) {
                    await tx.run(
                        `INSERT INTO cards (id,rank,suit,value,type) VALUES (?,?,?,?,?)
                         ON CONFLICT(id) DO NOTHING`,
                        [c.id, c.rank, c.suit, c.value, c.type]);
                }
            });
        }
        return true;
    })();
    return applied;
}

module.exports = { migrate };

if (require.main === module) {
    migrate().then(async () => {
        const objs = await db.all(
            `SELECT name,type FROM sqlite_master WHERE type IN ('table','view')
             AND name NOT LIKE 'sqlite_%' ORDER BY type,name`);
        const { n } = await db.get('SELECT COUNT(*) AS n FROM cards');
        console.log('target :', db.url.startsWith('file:') ? db.url : '(remote Turso)');
        console.log('tables :', objs.filter(o => o.type === 'table').map(o => o.name).join(', '));
        console.log('views  :', objs.filter(o => o.type === 'view').map(o => o.name).join(', '));
        console.log('cards  :', Number(n));
        for (const { table, column } of COLUMN_MIGRATIONS) {
            const cols = await db.all(`PRAGMA table_info(${table})`);
            console.log(`  ${table}.${column} present:`, cols.some((c) => c.name === column));
        }
        process.exit(0);
    }).catch((e) => { console.error(e); process.exit(1); });
}
