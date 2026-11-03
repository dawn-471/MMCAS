import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { A2A_VERSION, ROLES, isUrgent, validateMessage } from './a2a-protocol.mjs';

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function remoteIp(req) {
  return String(req.socket && req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function readBody(req, maxBytes) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        resolve({ ok: false, code: 413, error: '请求体超过上限' });
        try { req.resume(); } catch {}
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve({ ok: true, text: Buffer.concat(chunks).toString('utf8') });
    });
    req.on('error', (err) => {
      if (done) return;
      done = true;
      resolve({ ok: false, code: 400, error: err.message });
    });
  });
}

export function createA2AServer(options = {}) {
  const role = String(options.role || '');
  if (!ROLES.includes(role)) throw new Error('非法 A2A role: ' + role);
  const token = String(options.token || '');
  if (!token && !options.allowNoToken) throw new Error('缺少 A2A token');
  const bind = String(options.bind || '127.0.0.1');
  const port = Number(options.port === undefined ? 19400 : options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('非法 A2A 端口: ' + options.port);
  const stateFile = options.stateFile ? String(options.stateFile) : '';
  const maxBodyBytes = Math.max(1024, Number(options.maxBodyBytes || 65536));
  const rateLimitPerMin = Math.max(1, Number(options.rateLimitPerMin || 120));
  const onMessage = typeof options.onMessage === 'function' ? options.onMessage : async () => true;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const ipToRole = {};
  for (const [peerRole, peer] of Object.entries(options.peerRoles || {})) {
    if (peer && peer.ip) ipToRole[String(peer.ip)] = peerRole;
  }

  const state = {
    role,
    bind,
    port,
    running: false,
    received: 0,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    failures: 0,
    lastAt: null,
    lastFrom: null,
    lastError: null,
    startedAt: null,
  };
  const seen = new Map();
  const buckets = new Map();

  if (stateFile) {
    try {
      const raw = JSON.parse(readFileSync(stateFile, 'utf8'));
      const rows = Array.isArray(raw) ? raw : (Array.isArray(raw.ids) ? raw.ids : []);
      for (const row of rows.slice(-500)) {
        const id = typeof row === 'string' ? row : row && row.id;
        if (id) seen.set(id, typeof row === 'object' ? (row.at || Date.now()) : Date.now());
      }
    } catch {}
  }

  function saveSeen() {
    if (!stateFile) return;
    try {
      mkdirSync(path.dirname(stateFile), { recursive: true });
      const rows = [...seen.entries()].slice(-500).map(([id, at]) => ({ id, at }));
      writeFileSync(stateFile, JSON.stringify({ ids: rows }));
    } catch {}
  }

  function rateLimited(ip) {
    const now = Date.now();
    const bucket = buckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      buckets.set(ip, { count: 1, resetAt: now + 60000 });
      return false;
    }
    bucket.count++;
    return bucket.count > rateLimitPerMin;
  }

  function authorized(req) {
    if (!token && options.allowNoToken) return true;
    const header = String(req.headers.authorization || '');
    const got = header.startsWith('Bearer ') ? header.slice(7) : String(req.headers['x-mmcas-token'] || '');
    return safeEqual(got, token);
  }

  function sendJson(res, status, body) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(body));
  }

  const server = createServer(async (req, res) => {
    const ip = remoteIp(req);
    let url;
    try { url = new URL(req.url, 'http://a2a.local'); } catch { return sendJson(res, 400, { ok: false, error: '非法 URL' }); }
    const p = url.pathname;

    if (p === '/a2a/v1/ping' && req.method === 'GET') {
      if (!authorized(req)) {
        state.rejected++;
        return sendJson(res, 401, { ok: false, error: 'A2A 鉴权失败' });
      }
      if (rateLimited(ip)) {
        state.rejected++;
        return sendJson(res, 429, { ok: false, error: 'A2A 速率超限' });
      }
      state.received++;
      return sendJson(res, 200, { ok: true, v: A2A_VERSION, role, time: new Date().toISOString() });
    }

    if (p === '/a2a/v1/status' && req.method === 'GET') {
      if (!authorized(req)) {
        state.rejected++;
        return sendJson(res, 401, { ok: false, error: 'A2A 鉴权失败' });
      }
      return sendJson(res, 200, { ok: true, ...status() });
    }

    if (p === '/a2a/v1/messages' && req.method === 'POST') {
      if (!authorized(req)) {
        state.rejected++;
        return sendJson(res, 401, { ok: false, error: 'A2A 鉴权失败' });
      }
      if (rateLimited(ip)) {
        state.rejected++;
        return sendJson(res, 429, { ok: false, error: 'A2A 速率超限' });
      }
      const declaredLength = Number(req.headers['content-length'] || 0);
      if (declaredLength > maxBodyBytes) {
        state.rejected++;
        try { req.resume(); } catch {}
        return sendJson(res, 413, { ok: false, error: '请求体超过上限' });
      }
      const body = await readBody(req, maxBodyBytes);
      if (!body.ok) {
        state.rejected++;
        return sendJson(res, body.code, { ok: false, error: body.error });
      }
      state.received++;
      let msg;
      try {
        msg = JSON.parse(body.text || '{}');
      } catch {
        state.rejected++;
        return sendJson(res, 400, { ok: false, error: '请求体不是 JSON' });
      }
      const checked = validateMessage(msg, { maxBodyBytes });
      if (!checked.ok) {
        state.rejected++;
        return sendJson(res, checked.code, { ok: false, error: checked.error });
      }
      if (msg.to !== role && msg.to !== 'all') {
        state.rejected++;
        return sendJson(res, 403, { ok: false, error: '消息不是发给本端（to=' + msg.to + '）' });
      }
      const expectedFrom = ipToRole[ip];
      if (expectedFrom && msg.from !== expectedFrom) {
        state.rejected++;
        return sendJson(res, 403, { ok: false, error: '消息 from 与来源 IP 不匹配（' + msg.from + ' != ' + expectedFrom + '）' });
      }
      if (seen.has(msg.id)) {
        state.duplicates++;
        return sendJson(res, 200, { ok: true, duplicate: true, id: msg.id });
      }
      seen.set(msg.id, Date.now());
      if (seen.size > 500) {
        const first = seen.keys().next().value;
        seen.delete(first);
      }
      saveSeen();
      try {
        const delivered = await onMessage(msg, { ip, urgent: isUrgent(msg) });
        if (!delivered) {
          state.failures++;
          state.lastError = '投递失败';
          return sendJson(res, 503, { ok: false, id: msg.id, delivered: false, error: '投递失败' });
        }
      } catch (err) {
        state.failures++;
        state.lastError = String(err.message || err).slice(0, 200);
        return sendJson(res, 503, { ok: false, id: msg.id, delivered: false, error: state.lastError });
      }
      state.accepted++;
      state.lastAt = new Date().toISOString();
      state.lastFrom = msg.from;
      return sendJson(res, 200, { ok: true, id: msg.id, delivered: true, at: new Date().toISOString() });
    }

    return sendJson(res, 404, { ok: false, error: 'A2A 端点不存在' });
  });

  function status() {
    return {
      role: state.role,
      running: state.running,
      bind: state.bind,
      port: state.port,
      received: state.received,
      accepted: state.accepted,
      duplicates: state.duplicates,
      rejected: state.rejected,
      failures: state.failures,
      lastAt: state.lastAt,
      lastFrom: state.lastFrom,
      lastError: state.lastError,
      startedAt: state.startedAt,
    };
  }

  function start() {
    return new Promise((resolve, reject) => {
      const onError = (err) => {
        state.running = false;
        state.lastError = String(err.message || err);
        reject(err);
      };
      server.once('error', onError);
      server.listen(port, bind, () => {
        server.off('error', onError);
        const address = server.address();
        if (address && typeof address === 'object') state.port = address.port;
        state.running = true;
        state.startedAt = new Date().toISOString();
        log('info', 'A2A 服务已启动 ' + state.bind + ':' + state.port);
        resolve({ bind: state.bind, port: state.port });
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!state.running) return resolve();
      server.close(() => {
        state.running = false;
        resolve();
      });
    });
  }

  return { start, stop, status, state };
}
