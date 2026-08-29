const path = require('path');
const express = require('express');
const routes = require('./routes');
const { migrate } = require('./db/migrate');
const { AppError } = require('./services/errors');
const { IntegrityError } = require('./db/integrity');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serverless containers start cold, so the schema is ensured on first request
// rather than once at boot. migrate() memoises itself.
let ready = null;
app.use((req, res, next) => {
    ready = ready || migrate();
    ready.then(() => next()).catch(next);
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'red-and-black' }));
app.use('/api', routes);

app.use('/api', (req, res) =>
    res.status(404).json({ error: 'No such endpoint', path: req.path }));

app.use((err, req, res, next) => {
    if (err instanceof AppError) {
        return res.status(err.status).json({ error: err.message, code: err.code,
                                            details: err.details });
    }
    if (err instanceof IntegrityError) {
        console.error('INTEGRITY:', err.message);
        return res.status(500).json({ error: 'Deck integrity violation',
                                      code: 'INTEGRITY_ERROR', details: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
});

if (require.main === module) {
    app.listen(PORT, () => console.log(`Red & Black API on http://localhost:${PORT}`));
}

module.exports = app;
