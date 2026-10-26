// MemberKit API — backup + crash log. Dependensi: pg saja.
// Env: DATABASE_URL, DEVICE_TOKEN (wajib), PORT (default 3000)
const http = require('http');
const { Pool } = require('pg');

const PORT = parseInt(process.env.PORT || '3000', 10);
const TOKEN = process.env.DEVICE_TOKEN || '';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

const SCHEMA = `
create table if not exists mk_backup (
  device_id   text primary key,
  updated_at  timestamptz not null default now(),
  app_version text,
  member_count int not null default 0,
  payload     jsonb not null
);
create table if not exists mk_log (
  id          bigserial primary key,
  device_id   text not null,
  created_at  timestamptz not null default now(),
  app_version text,
  level       text not null default 'ERROR',
  kind        text not null default 'error',
  tag         text,
  message     text,
  stack       text
);
create index if not exists mk_log_device_idx on mk_log (device_id, created_at desc);
`;

let ready = false;
async function init() {
  await pool.query(SCHEMA);
  ready = true;
  console.log('schema ready');
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

const s = (v, max) => (v == null ? null : String(v).slice(0, max));

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && (path === '/' || path === '/health')) {
    let db = 'down';
    try {
      await pool.query('select 1');
      db = 'up';
    } catch (_) {}
    return send(res, 200, { ok: true, service: 'memberkit-api', db, ready });
  }

  if (TOKEN && req.headers['x-device-token'] !== TOKEN) {
    return send(res, 401, { ok: false, error: 'unauthorized' });
  }
  if (!ready) return send(res, 503, { ok: false, error: 'schema not ready' });

  // POST /backup  {deviceId, appVersion, members:[...]}
  if (req.method === 'POST' && path === '/backup') {
    const b = await readBody(req);
    const deviceId = s(b.deviceId, 120);
    if (!deviceId) return send(res, 400, { ok: false, error: 'deviceId required' });
    const members = Array.isArray(b.members) ? b.members : [];
    await pool.query(
      `insert into mk_backup (device_id, updated_at, app_version, member_count, payload)
       values ($1, now(), $2, $3, $4)
       on conflict (device_id) do update
         set updated_at = now(), app_version = excluded.app_version,
             member_count = excluded.member_count, payload = excluded.payload`,
      [deviceId, s(b.appVersion, 40), members.length, JSON.stringify({ members })]
    );
    return send(res, 200, { ok: true, count: members.length });
  }

  // GET /backup?deviceId=xxx  → payload terakhir
  if (req.method === 'GET' && path === '/backup') {
    const deviceId = s(url.searchParams.get('deviceId'), 120);
    if (!deviceId) return send(res, 400, { ok: false, error: 'deviceId required' });
    const r = await pool.query(
      'select updated_at, app_version, member_count, payload from mk_backup where device_id = $1',
      [deviceId]
    );
    if (!r.rowCount) return send(res, 404, { ok: false, error: 'no backup' });
    const row = r.rows[0];
    return send(res, 200, {
      ok: true,
      updatedAt: row.updated_at,
      appVersion: row.app_version,
      memberCount: row.member_count,
      members: row.payload.members || [],
    });
  }

  // POST /logs  {deviceId, appVersion, logs:[{level,kind,tag,message,stack}]}
  if (req.method === 'POST' && path === '/logs') {
    const b = await readBody(req);
    const deviceId = s(b.deviceId, 120);
    if (!deviceId) return send(res, 400, { ok: false, error: 'deviceId required' });
    const logs = Array.isArray(b.logs) ? b.logs.slice(0, 50) : [];
    for (const l of logs) {
      await pool.query(
        `insert into mk_log (device_id, app_version, level, kind, tag, message, stack)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          deviceId,
          s(b.appVersion, 40),
          s(l.level || 'ERROR', 16),
          s(l.kind || 'error', 24),
          s(l.tag, 80),
          s(l.message, 4000),
          s(l.stack, 20000),
        ]
      );
    }
    return send(res, 200, { ok: true, saved: logs.length });
  }

  // GET /logs?limit=50&deviceId=xxx
  if (req.method === 'GET' && path === '/logs') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
    const deviceId = s(url.searchParams.get('deviceId'), 120);
    const r = deviceId
      ? await pool.query(
          'select * from mk_log where device_id=$1 order by created_at desc limit $2',
          [deviceId, limit]
        )
      : await pool.query('select * from mk_log order by created_at desc limit $1', [limit]);
    return send(res, 200, { ok: true, count: r.rowCount, logs: r.rows });
  }

  send(res, 404, { ok: false, error: 'not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    send(res, 500, { ok: false, error: e.message });
  });
});

init()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => console.log('listening on ' + PORT));
  })
  .catch((e) => {
    console.error('init failed', e);
    // tetap listen supaya /health bisa melaporkan db down
    server.listen(PORT, '0.0.0.0', () => console.log('listening (degraded) on ' + PORT));
  });
