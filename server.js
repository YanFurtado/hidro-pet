// Servidor local/VPS do Hidro PET: sem dependências e sem banco de dados.
// Guarda tudo em data/state.json (ou no Upstash Redis, se as variáveis estiverem definidas) e entrega a pasta public.
const http = require('http'), fs = require('fs'), path = require('path');
const { handle } = require('./lib/api.js');
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
const ROUTES = new Set(['state', 'action', 'restore', 'login', 'snapshots', 'health']);
const readBody = (req) => new Promise((ok) => {
  let b = '';
  req.on('data', (d) => { b += d; if (b.length > 5e6) req.destroy(); });
  req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { ok({}); } });
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/api\/([a-z]+)$/);
  if (m && ROUTES.has(m[1])) {
    const r = await handle({ route: m[1], method: req.method, body: req.method === 'POST' ? await readBody(req) : {}, headers: req.headers });
    res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(r.headers || {}) });
    return res.end(JSON.stringify(r.body));
  }
  let p = path.normalize(decodeURIComponent(url.pathname));
  if (p === path.sep || p === '.') p = 'index.html';
  const f = path.join(PUBLIC, p);
  if (!f.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log('Hidro PET rodando em http://localhost:' + PORT));
