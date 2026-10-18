const { vercel } = require('../lib/api.js');
module.exports = (req, res) => vercel('snapshots', req, res);
