#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../lib/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-guide-panel-'));
const WS = path.join(ROOT, 'ws');
const LOCAL = path.join(ROOT, 'local');
mkdirSync(path.join(WS, 'tasks'), { recursive: true });
mkdirSync(path.join(WS, 'workspace', 'modeling'), { recursive: true });
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

async function waitFor(fn, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return null;
}

const srv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ type: 'response.output_text.done', text: 'GUIDE-PANEL-OK：优先攻坚问题四。' }) + '\n\n');
    res.write('data: ' + JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 80, output_tokens: 20 } } }) + '\n\n');
    res.end();
  });
});
await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
const upstream = `http://127.0.0.1:${srv.address().port}/v1/responses`;

function writeFile(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

writeFile(path.join(WS, 'tasks', 'T-001.md'), '---\nid: T-001\nstatus: doing\nowner: coder\n---\n# 任务\n');
writeFile(path.join(WS, 'workspace', 'modeling', 'm.md'), '# 模型\n当前使用线性规划。\n');

const guideJson = {
  endpoint: upstream,
  model: 'guide-panel-mock',
  protocol: 'responses',
  maxFeeCny: 10,
};
writeFile(path.join(LOCAL, 'guide.json'), JSON.stringify(guideJson, null, 2));

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
});

console.log('\n[GP1] 面板 Guide 配置');
{
  const r = await fetch('http://127.0.0.1:' + port + '/api/guide/config');
  const cfg = await r.json();
  check('GP1 config 可读', cfg.ok && cfg.mode === 'guide' && cfg.model === 'guide-panel-mock', JSON.stringify(cfg).slice(0, 140));
}

console.log('\n[GP2] 面板 Guide 全链');
{
  const start = await fetch('http://127.0.0.1:' + port + '/api/guide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dimension: 'direction', note: '请判断剩余时间优先级' }),
  });
  const started = await start.json();
  check('GP2 启动成功', started.ok && started.started, JSON.stringify(started));
  const final = await waitFor(async () => {
    const r = await fetch('http://127.0.0.1:' + port + '/api/guide/status');
    const s = await r.json();
    return s.running ? null : (s.result ? s : null);
  });
  check('GP2 状态完成', !!final && final.result.ok === true, final && JSON.stringify(final.result).slice(0, 200));
  check('GP2 报告在 guidance/', !!final && /guidance[\\/]GUIDE-direction-/.test(final.result.reportPath), final && final.result.reportPath);
  if (final && final.result.reportPath && existsSync(final.result.reportPath)) {
    const text = readFileSync(final.result.reportPath, 'utf8');
    check('GP2 报告正文', /GUIDE-PANEL-OK/.test(text) && /Guide 指导报告/.test(text));
  } else {
    check('GP2 报告正文', false, 'no report');
  }
  const notices = path.join(WS, 'notices');
  check('GP2 完成通知', existsSync(notices) && readdirSync(notices).some((f) => f.startsWith('N-')), notices);
}

console.log('\n[GP3] 面板 Reviewer 维度收敛');
{
  const paper = await fetch('http://127.0.0.1:' + port + '/api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dimension: 'paper' }),
  });
  const body = await paper.json();
  check('GP3 paper 被拒绝', paper.status === 400 && /model\|code/.test(body.error || ''), paper.status);
}

if (ctx.dispose) ctx.dispose();
srv.close();
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) process.exit(1);
