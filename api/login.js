const { vercel } = require('../lib/api.js');
module.exports = (req, res) => vercel('login', req, res);
