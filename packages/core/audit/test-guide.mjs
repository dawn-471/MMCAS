#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'audit-run.mjs');
const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-guide-test-'));
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

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...(env || {}) }, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => {
      const text = (out + err).trim();
      const marker = text.match(/EXPERT_RESULT=(\{.*\})/);
      let result = null;
      try { result = marker ? JSON.parse(marker[1]) : null; } catch {}
      resolve({ code, out: out.trim(), err: err.trim(), text, result });
    });
  });
}

const WS = path.join(ROOT, 'ws');
mkdirSync(path.join(WS, 'tasks'), { recursive: true });
mkdirSync(path.join(WS, 'workspace', 'modeling'), { recursive: true });
writeFileSync(path.join(WS, 'tasks', 'T-001.md'), '---\nid: T-001\nstatus: doing\nowner: coder\n---\n# 样例任务\n', 'utf8');
writeFileSync(path.join(WS, 'workspace', 'modeling', 'model.md'), '# 模型\n当前使用线性规划。\n', 'utf8');

const srv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ type: 'response.output_text.done', text: 'GUIDE-OK：建议优先攻坚问题四。' }) + '\n\n');
    res.write('data: ' + JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 100, output_tokens: 20 } } }) + '\n\n');
    res.end();
  });
});
await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
const PORT = srv.address().port;
const cfg = path.join(ROOT, 'guide.json');
writeFileSync(cfg, JSON.stringify({
  endpoint: `http://127.0.0.1:${PORT}/v1/responses`,
  model: 'guide-mock',
  protocol: 'responses',
  maxFeeCny: 10,
}, null, 2), 'utf8');

console.log('\n[G1] Guide 配置 / dry-run');
{
  const show = await run(['--mode', 'guide', '--show-config', '--guide-config', cfg]);
  check('G1 show-config 输出 guide 模式', show.code === 0 && /"mode": "guide"/.test(show.out) && /guide-mock/.test(show.out), show.out.slice(0, 160));
  const dry = await run(['--mode', 'guide', '--dimension', 'direction', '--workspace', WS, '--guide-config', cfg, '--dry-run']);
  check('G1 dry-run 成功', dry.code === 0 && dry.result && dry.result.mode === 'guide' && dry.result.dryRun === true, dry.err || JSON.stringify(dry.result));
  check('G1 configSource=guide.json', dry.result && dry.result.configSource === 'guide.json', dry.result && dry.result.configSource);
}

console.log('\n[G2] Guide 全链：direction 报告落盘');
{
  const r = await run(['--mode', 'guide', '--dimension', 'direction', '--workspace', WS, '--guide-config', cfg, '--confirm']);
  check('G2 exit0 + ok', r.code === 0 && r.result && r.result.ok === true && r.result.mode === 'guide', r.err || JSON.stringify(r.result));
  check('G2 报告路径在 guidance/', r.result && /guidance[\\/]GUIDE-direction-/.test(r.result.reportPath), r.result && r.result.reportPath);
  if (r.result && r.result.reportPath && existsSync(r.result.reportPath)) {
    const text = readFileSync(r.result.reportPath, 'utf8');
    check('G2 报告正文 + Guide 标题', /GUIDE-OK/.test(text) && /Guide 指导报告/.test(text), 'report');
    check('G2 meta 落盘', existsSync(r.result.reportPath.replace(/\.md$/, '.meta.json')));
    const meta = JSON.parse(readFileSync(r.result.reportPath.replace(/\.md$/, '.meta.json'), 'utf8'));
    check('G2 meta mode=guide', meta.mode === 'guide' && meta.dimension === 'direction', meta.mode);
  } else {
    check('G2 报告正文 + Guide 标题', false, 'no report');
    check('G2 meta 落盘', false, 'no report');
  }
}

console.log('\n[G3] Guide 维度校验');
{
  const bad = await run(['--mode', 'guide', '--dimension', 'paper', '--workspace', WS, '--guide-config', cfg, '--dry-run']);
  check('G3 guide 不接受 paper 维度', bad.code === 2 && /dimension/.test(bad.err || bad.out), bad.code);
}

srv.close();
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) process.exit(1);
