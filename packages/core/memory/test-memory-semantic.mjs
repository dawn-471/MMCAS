#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX_CLI = path.join(HERE, 'memory-index.mjs');
const SEARCH_CLI = path.join(HERE, 'memory-search.mjs');
const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-memory-semantic-'));
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

function writeMemory(workspace, role, name, text) {
  const dir = path.join(workspace, 'memory', role);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), text, 'utf8');
}

function vectorFor(text) {
  if (/稳定|数值/.test(text)) return [1, 0, 0, 0];
  if (/蒙特卡洛|风险/.test(text)) return [0, 1, 0, 0];
  if (/鲁棒|论文/.test(text)) return [0, 0, 1, 0];
  if (/预处理|缺失/.test(text)) return [0.7, 0.2, 0.1, 0];
  return [0.25, 0.25, 0.25, 0.25];
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

const WS = path.join(ROOT, 'ws');
writeMemory(WS, 'modeler', '2026-09-01.md', [
  '## 10:00',
  '数值模型的稳定性分析：使用龙格-库塔法，步长 h=0.01。',
  '',
  '## 11:00',
  '数据预处理：缺失值用中位数填补。',
  '',
].join('\n'));
writeMemory(WS, 'coder', '2026-09-02.md', '## 09:30\n蒙特卡洛模拟用于风险评估，采样 10000 次。\n');
writeMemory(WS, 'writer', '2026-09-03.md', '## 14:00\n论文摘要需要强调模型的鲁棒性和可复现性。\n');

let failMode = false;
const calls = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(body || '{}'); } catch {}
    calls.push({ url: req.url, auth: req.headers.authorization || '', model: payload.model, inputs: payload.input || [] });
    if (failMode) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'mock failure' }));
      return;
    }
    const data = (payload.input || []).map((text, index) => ({ index, embedding: vectorFor(String(text)) }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ model: payload.model, data, usage: { prompt_tokens: data.length * 3, total_tokens: data.length * 3 } }));
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
  apiKeyEnv: 'MMCAS_TEST_EMBED_KEY',
  batchSize: 2,
  timeoutMs: 5000,
}, null, 2));
const ENV = { MMCAS_HOME: HOME, MMCAS_TEST_EMBED_KEY: 'secret-key' };

console.log('\n[S1] 语义索引构建：批次 / 鉴权 / 向量落盘');
{
  const before = calls.length;
  const r = await run(INDEX_CLI, ['--provider', 'openai', '--backend', 'json', '--json'], ENV);
  const builtCalls = calls.slice(before);
  check('S1 exit0 + INDEX_RESULT', r.code === 0 && r.result && r.result.ok === true, r.text.slice(0, 120));
  check('S1 provider=openai / dim=4 / docs=4', r.result && r.result.provider === 'openai' && r.result.dim === 4 && r.result.docs === 4, r.result && JSON.stringify({ docs: r.result.docs, dim: r.result.dim }));
  check('S1 batchSize=2 => 2 批', r.result && r.result.batches === 2 && builtCalls.length === 2, r.result && r.result.batches);
  check('S1 批次大小 [2,2]', builtCalls.map((c) => c.inputs.length).join(',') === '2,2', builtCalls.map((c) => c.inputs.length).join(','));
  check('S1 Bearer key 已发送', builtCalls.every((c) => c.auth === 'Bearer secret-key'));
  const index = JSON.parse(readFileSync(r.result.indexPath, 'utf8'));
  check('S1 索引 v3 + 稠密向量', index.version === 3 && index.docs.every((d) => Array.isArray(d.vec) && d.vec.length === 4));
  check('S1 索引文件在 MMCAS_HOME', r.result.indexPath.startsWith(HOME));
}

console.log('\n[S2] 语义检索：查询嵌入 + 近邻命中');
{
  const before = calls.length;
  const r = await run(SEARCH_CLI, ['--mode', 'semantic', '--json', '数值稳定性'], ENV);
  check('S2 exit0 + JSON', r.code === 0 && r.json, r.text.slice(0, 120));
  check('S2 effectiveMode=semantic / 无回退', r.json && r.json.effectiveMode === 'semantic' && !r.json.fallback, r.json && r.json.effectiveMode);
  check('S2 provider=openai / backend=json', r.json && r.json.provider === 'openai' && r.json.backend === 'json', r.json && JSON.stringify({ provider: r.json.provider, backend: r.json.backend }));
  check('S2 命中稳定性条目', r.json && r.json.results[0] && /稳定性/.test(r.json.results[0].text), r.json && r.json.results[0] && r.json.results[0].text.slice(0, 24));
  check('S2 查询只嵌入 1 条', calls.length === before + 1 && calls[calls.length - 1].inputs.length === 1);
}

console.log('\n[S3] 语义检索：第二条命中 / 角色过滤 / limit');
{
  const r = await run(SEARCH_CLI, ['--mode', 'semantic', '--json', '蒙特卡洛风险'], ENV);
  check('S3 蒙特卡洛命中 coder', r.json && r.json.results[0] && r.json.results[0].role === 'coder' && /蒙特卡洛/.test(r.json.results[0].text), r.json && r.json.results[0] && r.json.results[0].text.slice(0, 24));
  const role = await run(SEARCH_CLI, ['--mode', 'semantic', '--json', '--role', 'writer', '鲁棒性'], ENV);
  check('S3 角色过滤 writer', role.json && role.json.total === 1 && role.json.results[0].role === 'writer', role.json && role.json.total);
  const one = await run(SEARCH_CLI, ['--mode', 'semantic', '--json', '--limit', '1', '数据'], ENV);
  check('S3 limit 截断', one.json && one.json.results.length === 1, one.json && one.json.results.length);
}

console.log('\n[S4] 语义回退：provider=hash / 端点失败 / 模型不匹配');
{
  const hashCfg = path.join(ROOT, 'hash-embed.json');
  writeFileSync(hashCfg, JSON.stringify({ provider: 'hash' }), 'utf8');
  const r = await run(SEARCH_CLI, ['--mode', 'semantic', '--json', '--embed-config', hashCfg, '蒙特卡洛'], ENV);
  check('S4 provider=hash => hybrid 回退', r.json && r.json.effectiveMode === 'hybrid' && /当前 hash/.test(r.json.fallback || ''), r.json && r.json.effectiveMode);
  check('S4 回退后仍有词匹配结果', r.json && r.json.total >= 1, r.json && r.json.total);

  const failed = await run(SEARCH_CLI, ['--mode', 'semantic', '--json', '--endpoint', 'http://127.0.0.1:1/v1/embeddings', '蒙特卡洛'], ENV);
  check('S4 端点失败 => hybrid 回退', failed.json && failed.json.effectiveMode === 'hybrid' && !!failed.json.fallback, failed.json && failed.json.fallback);
  check('S4 端点失败仍有结果', failed.json && failed.json.total >= 1, failed.json && failed.json.total);

  const mismatch = await run(SEARCH_CLI, ['--mode', 'semantic', '--json', '--model', 'other-model', '蒙特卡洛'], ENV);
  check('S4 模型不匹配 => hybrid 回退', mismatch.json && mismatch.json.effectiveMode === 'hybrid' && /模型不匹配/.test(mismatch.json.fallback || ''), mismatch.json && mismatch.json.fallback);
}

console.log('\n[S5] 失败不落盘 / 缺 key / dry-run / stats');
{
  const before = calls.length;
  const dry = await run(INDEX_CLI, ['--provider', 'openai', '--dry-run', '--json'], ENV);
  check('S5 dry-run 不调用 embeddings', dry.code === 0 && calls.length === before, calls.length - before);
  check('S5 dry-run 报告 2 批', dry.json && dry.json.dryRun === true && dry.json.batches === 2, dry.json && dry.json.batches);

  const HOME2 = path.join(ROOT, 'home-nokey');
  mkdirSync(HOME2, { recursive: true });
  writeFileSync(path.join(HOME2, 'memory-embed.json'), JSON.stringify({
    provider: 'openai',
    endpoint: `http://127.0.0.1:${PORT}/v1/embeddings`,
    model: 'mock-embed',
    apiKeyEnv: 'MMCAS_TEST_MISSING_KEY',
  }), 'utf8');
  const noKey = await run(INDEX_CLI, ['--provider', 'openai', '--json'], { MMCAS_HOME: HOME2 });
  check('S5 缺 key exit2 且提示', noKey.code === 2 && /缺少 embeddings API key/.test(noKey.text), noKey.text.slice(0, 120));

  failMode = true;
  const failedBuild = await run(INDEX_CLI, ['--provider', 'openai', '--json'], ENV);
  failMode = false;
  check('S5 API 失败不报 ok', failedBuild.code !== 0 && !(failedBuild.result && failedBuild.result.ok), failedBuild.text.slice(0, 120));

  const stats = await run(SEARCH_CLI, ['--stats', '--stale-days', '30', '--json'], ENV);
  check('S5 stats 含 embed/provider', stats.json && stats.json.embed && stats.json.embed.provider === 'openai', stats.json && stats.json.embed && stats.json.embed.provider);
  check('S5 过期条数 = 4', stats.json && stats.json.staleDocs === 4, stats.json && stats.json.staleDocs);
}

server.close();
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) process.exit(1);
