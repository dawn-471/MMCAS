#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../lib/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-terminal-panel-'));
const WS = path.join(ROOT, 'ws');
const LOCAL = path.join(ROOT, 'local');
mkdirSync(WS, { recursive: true });
mkdirSync(LOCAL, { recursive: true });
process.env.MMCAS_HOME = path.join(ROOT, 'mmcas');
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
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(fn, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return null;
}

const ctx = {
  logger: { info() {}, warn() {}, error() {} },
  sessions: { list: () => [] },
  agents: { get: () => null },
  sessionController: {},
  tokenMeter: { measure: () => ({ totalTokens: 0, surfaceTokens: 0 }) },
  on(event, cb) { if (event === 'dispose') ctx.dispose = cb; },
};
const port = await freePort();
apply(ctx, {
  workspaceDir: WS,
  role: 'modeler',
  localDir: LOCAL,
  port,
  autoSync: false,
  coreDir: path.join(REPO, 'packages', 'core'),
  a2a: { enabled: false },
  terminal: {
    shell: process.execPath,
    args: ['-i'],
    pty: true,
    ptyModule: path.join(REPO, 'vendor', 'node-pty', 'package'),
  },
});

const base = 'http://127.0.0.1:' + port;

console.log('\n[TP1] 半交互终端：打开 / 输入 / 轮询 / 审计');
{
  const open = await (await fetch(base + '/api/terminal/open', { method: 'POST' })).json();
  check('TP1 打开终端', open.ok && open.running, JSON.stringify(open).slice(0, 120));
  const ptyAvailable = existsSync(path.join(REPO, 'vendor', 'node-pty', 'package', 'prebuilds', 'win32-x64', 'conpty.node'));
  check('TP1 PTY/回退类型', open.kind === (ptyAvailable ? 'pty' : 'pipe'), open.kind);
  const input = await (await fetch(base + '/api/terminal/input', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: "console.log('TERM-OK')\n" }),
  })).json();
  check('TP1 输入成功', input.ok, JSON.stringify(input));
  const output = await waitFor(async () => {
    const status = await (await fetch(base + '/api/terminal/poll?since=0')).json();
    const text = (status.chunks || []).map((c) => c.text).join('');
    return text.includes('TERM-OK') ? status : null;
  });
  check('TP1 输出回传', !!output, output ? output.seq : 'timeout');
  const audit = path.join(LOCAL, 'terminal-audit.log');
  check('TP1 命令审计落盘', existsSync(audit) && /TERM-OK/.test(readFileSync(audit, 'utf8')));
  const closed = await (await fetch(base + '/api/terminal/close', { method: 'POST' })).json();
  check('TP1 关闭终端', closed.ok && closed.running === false, JSON.stringify(closed));
}

console.log('\n[TP2] 终端状态');
{
  const status = await (await fetch(base + '/api/terminal/poll?since=0')).json();
  check('TP2 状态可读且未运行', status.ok && status.running === false, JSON.stringify(status).slice(0, 120));
}

if (ctx.dispose) ctx.dispose();
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) process.exit(1);
