// Applies schema.sql and seeds the immutable `cards` reference table.
// Safe to run repeatedly. Works against a local file or Turso.

const path = require('path');
const fs = require('fs');
const db = require('./client');
const { freshDeck } = require('../engine/cards');

let applied = null;

async function migrate() {
    if (applied) return applied;
    applied = (async () => {
        await db.executeScript(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
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
        process.exit(0);
    }).catch((e) => { console.error(e); process.exit(1); });
}
