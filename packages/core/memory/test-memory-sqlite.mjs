#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchSqliteVec, sqliteReady } from './memory-vec-sqlite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX_CLI = path.join(HERE, 'memory-index.mjs');
const SEARCH_CLI = path.join(HERE, 'memory-search.mjs');
const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-memory-sqlite-'));
let pass = 0;
let fail = 0;
let skipped = 0;

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : ''));
  } else {
    fail++;
    console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : ''));
  }
}

function writeMemory(workspace, role, name, text) {
  const dir = path.join(workspace, 'memory', role);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), text, 'utf8');
}

function vectorFor(text) {
  if (/稳定|数值/.test(text)) return [1, 0, 0];
  if (/蒙特卡洛|风险/.test(text)) return [0, 1, 0];
  if (/鲁棒|论文/.test(text)) return [0, 0, 1];
  return [0.3, 0.3, 0.3];
}

function run(cli, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, '--workspace', env.MMCAS_TEST_WS || WS, ...args], {
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => {
      const text = (out + err).trim();
      const marker = text.match(/INDEX_RESULT=(\{.*\})/);
      let result = null;
      try { result = marker ? JSON.parse(marker[1]) : null; } catch {}
      let json = null;
      try { json = JSON.parse(out.trim()); } catch {}
      resolve({ code, out: out.trim(), err: err.trim(), text, result, json });
    });
  });
}

const ready = await sqliteReady();
if (!ready.ok) {
  skipped++;
  console.log('  SKIP  sqlite-vec 不可用：' + ready.reason);
  console.log(`\n==== ${pass} passed, ${fail} failed, ${skipped} skipped ====`);
  rmSync(ROOT, { recursive: true, force: true });
  process.exit(0);
}

const WS = path.join(ROOT, 'ws');
writeMemory(WS, 'modeler', '2026-09-01.md', '## 10:00\n数值模型的稳定性分析：龙格-库塔法。\n');
writeMemory(WS, 'coder', '2026-09-02.md', '## 09:30\n蒙特卡洛模拟用于风险评估。\n');
writeMemory(WS, 'writer', '2026-09-03.md', '## 14:00\n论文摘要强调鲁棒性和可复现性。\n');

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(body || '{}'); } catch {}
    const data = (payload.input || []).map((text, index) => ({ index, embedding: vectorFor(String(text)) }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ model: payload.model, data }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;
const HOME = path.join(ROOT, 'home');
mkdirSync(HOME, { recursive: true });
writeFileSync(path.join(HOME, 'memory-embed.json'), JSON.stringify({
  provider: 'openai',
  endpoint: `http://127.0.0.1:${PORT}/v1/embeddings`,
  model: 'mock-embed',
  apiKeyEnv: '',
  batchSize: 8,
  timeoutMs: 5000,
}, null, 2));
const ENV = { MMCAS_HOME: HOME };

console.log('\n[B1] sqlite-vec 建库：元数据 / 向量 / 原子落盘');
{
  const r = await run(INDEX_CLI, ['--provider', 'openai', '--backend', 'sqlite', '--json'], ENV);
  check('B1 exit0 + INDEX_RESULT', r.code === 0 && r.result && r.result.ok === true, r.text.slice(0, 120));
  check('B1 sqlite 文件已生成', r.result && r.result.sqlite && existsSync(r.result.sqlite.file), r.result && r.result.sqlite && r.result.sqlite.file);
  check('B1 无 sqliteError', r.result && !r.result.sqliteError, r.result && r.result.sqliteError);
  const index = JSON.parse(readFileSync(r.result.indexPath, 'utf8'));
  check('B1 索引记录 sqlite 元数据', index.embed && index.embed.sqlite && index.embed.sqlite.dim === 3, index.embed && JSON.stringify(index.embed.sqlite));
}

console.log('\n[B2] 语义检索走 sqlite-vec KNN');
{
  const r = await run(SEARCH_CLI, ['--mode', 'semantic', '--backend', 'sqlite', '--json', '数值稳定性'], ENV);
  check('B2 backend=sqlite', r.json && r.json.backend === 'sqlite', r.json && r.json.backend);
  check('B2 effectiveMode=semantic / 无回退', r.json && r.json.effectiveMode === 'semantic' && !r.json.fallback, r.json && r.json.effectiveMode);
  check('B2 命中稳定性条目', r.json && r.json.results[0] && /稳定性/.test(r.json.results[0].text), r.json && r.json.results[0] && r.json.results[0].text.slice(0, 24));
  check('B2 相似度 > 0.9', r.json && r.json.results[0] && r.json.results[0].vectorScore > 0.9, r.json && r.json.results[0] && r.json.results[0].vectorScore);
  const role = await run(SEARCH_CLI, ['--mode', 'semantic', '--backend', 'sqlite', '--json', '--role', 'writer', '鲁棒性'], ENV);
  check('B2 sqlite 元数据角色过滤', role.json && role.json.total === 1 && role.json.results[0].role === 'writer', role.json && role.json.total);
  const date = await run(SEARCH_CLI, ['--mode', 'semantic', '--backend', 'sqlite', '--json', '--since', '2026-09-03', '鲁棒性'], ENV);
  check('B2 sqlite 元数据日期过滤', date.json && date.json.total === 1 && date.json.results[0].role === 'writer', date.json && date.json.total);
}

console.log('\n[B3] JSON 后端对照 / DB 缺失回退 / 元数据校验');
{
  const jsonBackend = await run(SEARCH_CLI, ['--mode', 'semantic', '--backend', 'json', '--json', '数值稳定性'], ENV);
  check('B3 --backend json 走 JSON 向量', jsonBackend.json && jsonBackend.json.backend === 'json' && jsonBackend.json.total >= 1, jsonBackend.json && jsonBackend.json.backend);

  const stats = await run(SEARCH_CLI, ['--stats', '--json'], ENV);
  const index = JSON.parse(readFileSync(stats.json.indexPath, 'utf8'));
  const dbFile = index.embed.sqlite.file;
  const wrong = await searchSqliteVec(dbFile, [1, 0, 0], { meta: { builtAt: 'wrong' } });
  check('B3 元数据不匹配返回 null', wrong === null, wrong);
  const right = await searchSqliteVec(dbFile, [1, 0, 0], { meta: { builtAt: index.embed.builtAt, model: index.embed.model, dim: index.embed.dim, docs: index.docs.length } });
  check('B3 元数据匹配返回 KNN', Array.isArray(right) && right.length === 3 && right[0].docIndex === 0, right && JSON.stringify(right[0]));

  const moved = dbFile + '.moved';
  renameSync(dbFile, moved);
  const fallback = await run(SEARCH_CLI, ['--mode', 'semantic', '--backend', 'sqlite', '--json', '数值稳定性'], ENV);
  check('B3 DB 缺失自动回退 JSON', fallback.json && fallback.json.backend === 'json' && fallback.json.total >= 1, fallback.json && fallback.json.backend);
  renameSync(moved, dbFile);
}

console.log('\n[B4] sqlite-vec 不可用时的建库降级');
{
  const HOME2 = path.join(ROOT, 'home-noext');
  mkdirSync(HOME2, { recursive: true });
  writeFileSync(path.join(HOME2, 'memory-embed.json'), JSON.stringify({
    provider: 'openai',
    endpoint: `http://127.0.0.1:${PORT}/v1/embeddings`,
    model: 'mock-embed',
    apiKeyEnv: '',
    batchSize: 8,
  }), 'utf8');
  const r = await run(INDEX_CLI, ['--provider', 'openai', '--backend', 'sqlite', '--vec-ext', path.join(ROOT, 'missing-vec0.dll'), '--json'], { MMCAS_HOME: HOME2 });
  check('B4 缺扩展仍写出 JSON 索引', r.code === 0 && r.result && r.result.ok === true, r.text.slice(0, 160));
  check('B4 记录 sqliteError 但不失败', r.result && !!r.result.sqliteError && !r.result.sqlite, r.result && r.result.sqliteError);
  const search = await run(SEARCH_CLI, ['--mode', 'semantic', '--backend', 'sqlite', '--vec-ext', path.join(ROOT, 'missing-vec0.dll'), '--json', '数值稳定性'], { MMCAS_HOME: HOME2 });
  check('B4 搜索回退 JSON 向量', search.json && search.json.backend === 'json' && search.json.total >= 1, search.json && search.json.backend);
}

server.close();
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n==== ${pass} passed, ${fail} failed, ${skipped} skipped ====`);
if (fail) process.exit(1);
