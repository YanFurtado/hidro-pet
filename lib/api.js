// Rotas da API do Hidro PET, compartilhadas pelo servidor local (server.js) e pelas funções da Vercel (api/*.js).
const crypto = require('crypto');
const core = require('../public/core.js');
const store = require('./store.js');

const CODE = process.env.ACCESS_CODE || '';
const ON_VERCEL = !!process.env.VERCEL;
const COOKIE = 'hp_auth';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => crypto.createHmac('sha256', CODE).update('hidro-pet-v1').digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookieOf = (h) => { const m = String(h.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)')); return m ? m[1] : ''; };
const clientIp = (h) => String(h['x-forwarded-for'] || h['x-real-ip'] || 'local').split(',')[0].trim();
const cookieHeader = (value, maxAge, h) => `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${h['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;
const json = (status, body, headers) => ({ status, body, headers });

// route: 'state' | 'action' | 'restore' | 'login' | 'snapshots'
async function handle({ route, method, body, headers }) {
  body = body || {}; headers = headers || {};
  try {
    if (ON_VERCEL && !CODE) return json(503, { error: 'config', message: 'Falta definir ACCESS_CODE (código de acesso) nas variáveis de ambiente da Vercel.' });

    if (route === 'login') {
      if (method !== 'POST') return json(405, { error: 'Método não permitido.' });
      if (body.logout) return json(200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0, headers) });
      if (!CODE) return json(200, { ok: true });
      const ip = clientIp(headers);
      if ((await store.failCount(ip, false)) >= 10) return json(429, { error: 'Muitas tentativas. Aguarde 15 minutos.' });
      if (!safeEq(String(body.code || '').trim(), CODE)) { await store.failCount(ip, true); await sleep(700); return json(401, { error: 'Código incorreto.' }); }
      await store.clearFails(ip);
      return json(200, { ok: true }, { 'Set-Cookie': cookieHeader(token(), 60 * 60 * 24 * 180, headers) });
    }

    if (CODE && !safeEq(cookieOf(headers), token())) return json(401, { error: 'auth' });

    if (route === 'state' && method === 'GET') return json(200, { state: await store.read(), authRequired: !!CODE });
    if (route === 'snapshots' && method === 'GET') return json(200, { snapshots: await store.listSnapshots() });

    if (route === 'action' && method === 'POST') {
      const out = await store.mutate((cur) => core.apply(cur, body.action, body.payload));
      return json(200, { state: out.state, extra: out.extra });
    }

    if (route === 'restore' && method === 'POST') {
      let next;
      if (body.snapshot) next = await store.readSnapshot(String(body.snapshot));
      else next = body.state;
      if (!next || !Array.isArray(next.students) || !Array.isArray(next.teachers)) return json(400, { error: 'Arquivo inválido.' });
      const out = await store.mutate((cur) => ({ state: { ...core.emptyState(), ...next, rev: (cur.rev || 0) + 1 } }), { snapshotName: store.PRE_RESTORE });
      return json(200, { state: out.state });
    }
    return json(404, { error: 'Não encontrado.' });
  } catch (e) {
    return json(400, { error: e.message });
  }
}

// Adaptador para as funções da Vercel (req/res no estilo Node).
async function vercel(route, req, res) {
  let body = {};
  if (req.method === 'POST') { // só POST tem corpo; GET nunca espera leitura
    body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    if (body === undefined || body === null) {
      body = req.readableEnded ? {} : await new Promise((ok) => {
        let b = ''; const t = setTimeout(() => ok({}), 3000); // nunca fica esperando para sempre
        req.on('data', (d) => (b += d));
        req.on('end', () => { clearTimeout(t); try { ok(JSON.parse(b || '{}')); } catch (e) { ok({}); } });
      });
    }
  }
  const r = await handle({ route, method: req.method, body, headers: req.headers });
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v);
  res.status(r.status).json(r.body);
}

module.exports = { handle, vercel };
