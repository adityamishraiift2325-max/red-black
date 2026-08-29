// Vercel serverless entrypoint. vercel.json rewrites every request here, and
// the Express app handles both the API and the static files.
module.exports = require('../src/server.js');
