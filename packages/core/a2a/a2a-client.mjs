import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fallbackNoticeKind, makeMessage } from './a2a-protocol.mjs';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function peerBaseUrl(peer, port = 19400) {
  const raw = typeof peer === 'string' ? peer : (peer && peer.ip);
  if (!raw) throw new Error('peer 缺少 IP');
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  const actualPort = peer && typeof peer === 'object' && peer.port ? Number(peer.port) : Number(port || 19400);
  const host = raw.includes(':') && !raw.startsWith('[') ? '[' + raw + ']' : raw;
  return 'http://' + host + ':' + actualPort;
}

async function requestJson(url, init, timeoutMs, fetchImpl) {
  const impl = fetchImpl || fetch;
  if (typeof impl !== 'function') throw new Error('当前 Node 不支持 fetch');
  const options = { ...init };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    options.signal = AbortSignal.timeout(timeoutMs);
  }
  const response = await impl(url, options);
  let body = {};
  try { body = await response.json(); } catch {}
  return { ok: response.ok, status: response.status, body };
}

function headers(token) {
  const out = { 'Content-Type': 'application/json' };
  if (token) out.Authorization = 'Bearer ' + token;
  return out;
}

async function sendOne(input, ctx) {
  const from = ctx.from;
  const to = input.to;
  const peer = ctx.peers && ctx.peers[to];
  if (!peer) return { ok: false, status: 0, error: '未知 peer: ' + to, peer: null };
  if (peer.online === false) return { ok: false, status: 0, error: 'peer 离线: ' + to, peer };
  const token = ctx.tokens && Object.keys(ctx.tokens).length ? ctx.tokens[from] : ctx.token;
  if (!token && !ctx.allowNoToken) return { ok: false, status: 0, error: '缺少本端 A2A token（' + from + '）', peer };
  let message;
  try {
    message = makeMessage({
      from,
      to,
      kind: input.kind || 'info',
      urgency: input.urgency || 'normal',
      scope: input.scope || '',
      body: input.body || '',
      ttl: input.ttl || 3600,
      replyTo: input.replyTo || '',
    });
  } catch (err) {
    return { ok: false, status: 0, error: err.message, peer };
  }
  const url = peerBaseUrl(peer, ctx.port) + '/a2a/v1/messages';
  const retries = Number(ctx.retries === undefined ? 1 : ctx.retries);
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await requestJson(url, {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify(message),
      }, Number(ctx.timeoutMs || 3000), ctx.fetchImpl);
      if (response.ok) return { ok: true, status: response.status, response: response.body, peer, id: message.id };
      last = {
        ok: false,
        status: response.status,
        error: (response.body && response.body.error) || ('HTTP ' + response.status),
        peer,
        id: message.id,
      };
      if (response.status < 500) break;
    } catch (err) {
      last = { ok: false, status: 0, error: err.message, peer, id: message.id };
    }
    if (attempt < retries) await delay(200);
  }
  return last || { ok: false, status: 0, error: '发送失败', peer, id: message.id };
}

export async function sendMessage(input, ctx = {}) {
  if (!input || !input.to) return { ok: false, error: '缺少收件方' };
  if (input.to === 'all') {
    const roles = Object.keys(ctx.peers || {}).filter((role) => role !== ctx.from);
    if (!roles.length) return { ok: false, error: '没有可用的 peer', results: [] };
    const results = [];
    for (const role of roles) results.push(await sendOne({ ...input, to: role }, ctx));
    return { ok: results.some((r) => r.ok), mode: 'broadcast', results };
  }
  return sendOne(input, ctx);
}

export async function getPeerStatus(to, ctx = {}) {
  const peer = ctx.peers && ctx.peers[to];
  if (!peer) return { ok: false, status: 0, error: '未知 peer: ' + to };
  if (peer.online === false) return { ok: false, status: 0, error: 'peer 离线: ' + to, peer };
  const token = ctx.tokens && Object.keys(ctx.tokens).length ? ctx.tokens[ctx.from] : ctx.token;
  const url = peerBaseUrl(peer, ctx.port) + '/a2a/v1/status';
  try {
    const response = await requestJson(url, { method: 'GET', headers: headers(token) }, Number(ctx.timeoutMs || 3000), ctx.fetchImpl);
    return { ok: response.ok, status: response.status, response: response.body, peer };
  } catch (err) {
    return { ok: false, status: 0, error: err.message, peer };
  }
}

export async function pingPeer(to, ctx = {}) {
  const peer = ctx.peers && ctx.peers[to];
  if (!peer) return { ok: false, status: 0, error: '未知 peer: ' + to };
  if (peer.online === false) return { ok: false, status: 0, error: 'peer 离线: ' + to, peer };
  const token = ctx.tokens && Object.keys(ctx.tokens).length ? ctx.tokens[ctx.from] : ctx.token;
  const url = peerBaseUrl(peer, ctx.port) + '/a2a/v1/ping';
  const retries = Number(ctx.retries === undefined ? 1 : ctx.retries);
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await requestJson(url, { method: 'GET', headers: headers(token) }, Number(ctx.timeoutMs || 3000), ctx.fetchImpl);
      if (response.ok) return { ok: true, status: response.status, response: response.body, peer };
      last = { ok: false, status: response.status, error: (response.body && response.body.error) || ('HTTP ' + response.status), peer };
      if (response.status < 500) break;
    } catch (err) {
      last = { ok: false, status: 0, error: err.message, peer };
    }
    if (attempt < retries) await delay(200);
  }
  return last || { ok: false, status: 0, error: 'ping 失败', peer };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function writeNoticeFallback(workspace, input, from, reason) {
  if (!workspace) throw new Error('缺少工作区，无法回落 notices');
  const now = new Date();
  const id = 'N-' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate())
    + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds())
    + '-' + Math.random().toString(36).slice(2, 4);
  const to = input.to === 'all' ? 'all' : input.to;
  const kind = fallbackNoticeKind(input.kind || 'info');
  const urgency = input.urgency === 'urgent' || input.kind === 'stop' ? 'urgent' : 'normal';
  const rec = {
    id,
    from: from || 'modeler',
    to,
    kind,
    urgency,
    scope: String(input.scope || '').trim(),
    status: 'pending',
    at: now.toISOString(),
  };
  const body = '（A2A 不可达，已回落文件通道：' + (reason || 'unknown') + '）\n' + (input.body || '');
  const dir = path.join(workspace, 'notices');
  mkdirSync(dir, { recursive: true });
  const text = '---\n' + Object.entries(rec).map(([key, value]) => key + ': ' + value).join('\n') + '\n---\n## 正文\n' + body + '\n';
  writeFileSync(path.join(dir, id + '.md'), text, 'utf8');
  return id;
}

export async function sendWithFallback(input, ctx = {}, fallback = {}) {
  const result = await sendMessage(input, ctx);
  if (result.ok) return { ...result, mode: result.mode || 'a2a' };
  if (fallback.disabled || !fallback.workspace) return result;
  try {
    const id = writeNoticeFallback(fallback.workspace, input, ctx.from, result.error);
    return { ok: true, mode: 'notice', id, error: result.error, a2a: result };
  } catch (err) {
    return { ...result, fallbackError: err.message };
  }
}

