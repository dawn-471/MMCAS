#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../lib/index.js';
import { createA2AServer } from '../../core/a2a/a2a-server.mjs';
import { sendMessage } from '../../core/a2a/a2a-client.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-a2a-panel-'));
const WS = path.join(ROOT, 'ws');
const LOCAL = path.join(ROOT, 'local');
mkdirSync(path.join(WS, 'tasks'), { recursive: true });
mkdirSync(LOCAL, { recursive: true });
let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : ''));
  } else {
    fail++;
    console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : ''));
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(fn, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

const peerMessages = [];
const peer = createA2AServer({
  role: 'coder',
  token: 'panel-token',
  bind: '127.0.0.1',
  port: 0,
  peerRoles: { modeler: { ip: '127.0.0.1' } },
  onMessage: async (msg) => { peerMessages.push(msg); return true; },
});
const peerAddr = await peer.start();

const injected = [];
const sessions = [{ id: 's1', title: 'test session', header: { createdAt: Date.now() } }];
const agent = {
  followup(msg) { injected.push(msg); },
  steer(msg) { injected.push(msg); },
};
const ctx = {
  logger: { info() {}, warn() {}, error() {} },
  sessions: { list: () => sessions },
  agents: { get: (id) => (id === 's1' ? agent : null) },
  sessionController: {},
  tokenMeter: { measure: () => ({ totalTokens: 0, surfaceTokens: 0 }) },
  on(event, cb) { if (event === 'dispose') ctx.dispose = cb; },
};
const panelPort = await freePort();
const a2aPort = await freePort();
const panel = apply(ctx, {
  workspaceDir: WS,
  role: 'modeler',
  localDir: LOCAL,
  port: panelPort,
  autoSync: false,
  coreDir: path.join(REPO, 'packages', 'core'),
  a2a: {
    token: 'panel-token',
    bind: '127.0.0.1',
    port: a2aPort,
    peers: { coder: { ip: '127.0.0.1', port: peerAddr.port, online: true } },
  },
});

const ready = await waitFor(() => {
  const state = panel.collectState();
  return state.a2a.running ? state.a2a : null;
});
check('AP1 面板 A2A 已启动', !!ready, ready ? ready.bind + ':' + ready.port : 'not running');

if (ready) {
  const statusRes = await fetch('http://127.0.0.1:' + panelPort + '/api/a2a/status');
  const status = await statusRes.json();
  check('AP2 /api/a2a/status', status.ok && status.running && status.peersTotal === 1, JSON.stringify(status).slice(0, 120));

  const sendRes = await fetch('http://127.0.0.1:' + panelPort + '/api/a2a/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: 'coder', kind: 'query', body: '请检查 T-201 的数值稳定性' }),
  });
  const sent = await sendRes.json();
  check('AP3 /api/a2a/send 走 A2A', sent.ok && sent.mode === 'a2a' && peerMessages.length === 1, JSON.stringify(sent));
  check('AP3 peer 收到消息', peerMessages[0] && peerMessages[0].from === 'modeler' && /T-201/.test(peerMessages[0].body), peerMessages[0] && peerMessages[0].id);

  const inbound = await sendMessage({ to: 'modeler', kind: 'query', body: '请确认模型假设' }, {
    from: 'coder',
    token: 'panel-token',
    port: ready.port,
    peers: { modeler: { ip: '127.0.0.1', online: true } },
    timeoutMs: 2000,
    retries: 0,
  });
  check('AP4 面板接收 A2A', inbound.ok, inbound.error || inbound.id);
  check('AP4 注入会话', injected.length === 1 && /请确认模型假设/.test(injected[0].content[0].text), injected.length);

  await peer.stop();
  const fallbackRes = await fetch('http://127.0.0.1:' + panelPort + '/api/a2a/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: 'coder', kind: 'stop', urgency: 'urgent', scope: 'T-201', body: '停止该方向' }),
  });
  const fallback = await fallbackRes.json();
  check('AP5 peer 离线 => notices 回落', fallback.ok && fallback.mode === 'notice' && /^N-/.test(fallback.id), JSON.stringify(fallback));
  const noticesDir = path.join(WS, 'notices');
  check('AP5 回落文件落盘', existsSync(noticesDir) && readdirSync(noticesDir).some((f) => f.startsWith(fallback.id)), fallback.id);
  const noticeText = readFileSync(path.join(noticesDir, fallback.id + '.md'), 'utf8');
  check('AP5 回落保留 urgent/stop/scope', /kind: stop/.test(noticeText) && /urgency: urgent/.test(noticeText) && /scope: T-201/.test(noticeText));
} else {
  fail += 1;
}

if (ctx.dispose) ctx.dispose();
else {
  try { await peer.stop(); } catch {}
}
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) process.exit(1);
