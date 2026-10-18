// Armazenamento do Hidro PET.
// - Local/VPS: um arquivo JSON em disco (pasta data/).
// - Vercel (sem disco): Upstash Redis via REST, guardando UM único valor (o JSON todo, comprimido).
// Escolha automática: se as variáveis do Redis existirem, usa Redis; senão, usa arquivo.
const crypto = require('crypto'), zlib = require('zlib'), fs = require('fs'), path = require('path');
const core = require('../public/core.js');

// A Vercel pode colocar um prefixo nos nomes ao conectar o banco (ex.: STORAGE_KV_REST_API_URL), então procuramos por padrão.
const findEnv = (re, not) => { const k = Object.keys(process.env).find((n) => re.test(n) && !(not && not.test(n)) && process.env[n]); return k ? process.env[k] : ''; };
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || findEnv(/REST(_API)?_URL$/i);
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || findEnv(/REST(_API)?_TOKEN$/i, /READ_?ONLY/i);
const useRedis = !!(/^https?:\/\//.test(REDIS_URL) && REDIS_TOKEN);
// Só nomes (nunca valores) das variáveis ligadas a armazenamento, para diagnóstico.
const storageInfo = () => ({
  storage: useRedis ? 'redis' : process.env.VERCEL ? 'temporario' : 'arquivo',
  envNames: Object.keys(process.env).filter((n) => /REST|KV_|UPSTASH|REDIS|STORAGE/i.test(n)).sort(),
});
// Na Vercel o disco do projeto é somente leitura; sem Redis, usa a pasta temporária (dados NÃO permanentes).
const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? path.join(require('os').tmpdir(), 'hidro-pet') : path.join(__dirname, '..', 'data'));
const FILE = path.join(DATA_DIR, 'state.json');
const KEY = 'hidro:state', LOCK = 'hidro:lock', SNAP = 'hidro:snap:';
const PRE_RESTORE = 'antes-da-restauracao';
const SNAP_TTL = 60 * 60 * 24 * 45; // cópias diárias ficam 45 dias
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todaySP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

// ---------- Redis (REST) ----------
async function cmd(...args) {
  const r = await fetch(REDIS_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  let j; try { j = await r.json(); } catch (e) { j = {}; }
  if (!r.ok || j.error) throw new Error('Armazenamento indisponível: ' + (j.error || r.status));
  return j.result;
}
const pack = (state) => 'gz:' + zlib.gzipSync(JSON.stringify(state)).toString('base64'); // o plano grátis limita o tamanho de cada gravação
const unpack = (s) => (s == null ? null : JSON.parse(s.startsWith('gz:') ? zlib.gunzipSync(Buffer.from(s.slice(3), 'base64')).toString() : s));

async function redisLock() {
  const id = crypto.randomUUID();
  for (let i = 0; i < 40; i++) {
    if ((await cmd('SET', LOCK, id, 'NX', 'PX', '8000')) === 'OK') return id;
    await sleep(80 + Math.random() * 120);
  }
  throw new Error('O sistema está ocupado. Tente de novo em instantes.');
}
const redisUnlock = (id) => cmd('EVAL', "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", '1', LOCK, id).catch(() => {});

// ---------- leitura / escrita brutas ----------
async function rawRead() {
  if (useRedis) return unpack(await cmd('GET', KEY));
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return null; }
}
async function rawWrite(state) {
  if (useRedis) return void (await cmd('SET', KEY, pack(state)));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(state));
  fs.renameSync(FILE + '.tmp', FILE);
}
async function saveSnapshot(name, state, overwrite) {
  if (useRedis) return void (await cmd('SET', SNAP + name, pack(state), ...(overwrite ? [] : ['NX']), 'EX', String(SNAP_TTL)));
  const f = path.join(DATA_DIR, 'backup-' + name + '.json');
  if (overwrite || !fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(state));
}

// ---------- API pública ----------
let queue = Promise.resolve(); // no modo arquivo, serializa as gravações dentro do processo
async function read() { return Object.assign(core.emptyState(), (await rawRead()) || {}); }

// Executa fn(estadoAtual) → { state, extra }. Só um por vez (trava no Redis / fila no arquivo).
async function mutate(fn, { snapshotName } = {}) {
  const run = async () => {
    const lock = useRedis ? await redisLock() : null;
    try {
      const before = await read();
      const out = await fn(before);
      if (before.rev > 0) await saveSnapshot(snapshotName || todaySP(), before, !!snapshotName); // estado de antes da 1ª alteração do dia
      await rawWrite(out.state);
      return out;
    } finally { if (lock) await redisUnlock(lock); }
  };
  if (useRedis) return run();
  const p = queue.then(run, run); queue = p.catch(() => {}); return p;
}

async function listSnapshots() {
  let names;
  if (useRedis) names = ((await cmd('KEYS', SNAP + '*')) || []).map((k) => k.slice(SNAP.length));
  else { try { names = fs.readdirSync(DATA_DIR).filter((f) => /^backup-.+\.json$/.test(f)).map((f) => f.slice(7, -5)); } catch (e) { names = []; } }
  return names.sort().reverse();
}
async function readSnapshot(name) {
  if (!/^(\d{4}-\d{2}-\d{2}|antes-da-restauracao)$/.test(name)) throw new Error('Cópia inválida.');
  const s = useRedis ? unpack(await cmd('GET', SNAP + name)) : (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'backup-' + name + '.json'), 'utf8')); } catch (e) { return null; } })();
  if (!s) throw new Error('Cópia não encontrada.');
  return s;
}

// contador de tentativas de login (por IP), para frear tentativa de adivinhar o código
const memFails = new Map();
async function failCount(ip, add) {
  if (useRedis) {
    const k = 'hidro:fail:' + ip;
    if (add) { const n = await cmd('INCR', k); if (n === 1) await cmd('EXPIRE', k, '900'); return n; }
    return Number(await cmd('GET', k)) || 0;
  }
  const now = Date.now(), e = memFails.get(ip);
  const cur = e && now - e.t < 900000 ? e : { n: 0, t: now };
  if (add) cur.n++; memFails.set(ip, cur); return cur.n;
}
const clearFails = (ip) => (useRedis ? cmd('DEL', 'hidro:fail:' + ip).catch(() => {}) : memFails.delete(ip));

module.exports = { useRedis, storageInfo, read, mutate, listSnapshots, readSnapshot, failCount, clearFails, PRE_RESTORE, DATA_DIR };
