#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleMemorySearch, memoryStatsFromWorkspace, resolveMemoryModulePath, searchMemoryFromWorkspace } from '../lib/memory-api.mjs';

const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-panel-memory-'));
process.env.MMCAS_HOME = path.join(ROOT, 'home');
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

const WS = path.join(ROOT, 'ws');
writeMemory(WS, 'modeler', '2026-09-01.md', '## 10:00\n数值模型的稳定性分析。\n');
writeMemory(WS, 'coder', '2026-09-02.md', '## 09:30\n蒙特卡洛模拟用于风险评估。\n');
writeMemory(WS, 'writer', '2026-09-03.md', '## 14:00\n论文摘要强调鲁棒性。\n');

console.log('\n[P1] 面板 memory-api：模块解析与混合检索');
{
  const modulePath = resolveMemoryModulePath();
  check('P1 解析到 core memory-index', !!modulePath && existsSync(modulePath) && /memory-index\.mjs$/.test(modulePath), modulePath);
  const out = await searchMemoryFromWorkspace(WS, { query: '数值稳定性', mode: 'hybrid' });
  check('P1 混合检索命中', out.total >= 1 && /稳定性/.test(out.results[0].text), out.total);
  check('P1 provider=hash / backend=json', out.provider === 'hash' && out.backend === 'json', out.provider + '/' + out.backend);
  check('P1 返回有效 index 元数据', out.indexPath && out.docs === 3, out.docs);
}

console.log('\n[P2] 角色过滤 / word 模式 / limit / semantic 回退');
{
  const word = await searchMemoryFromWorkspace(WS, { query: '蒙特卡洛', mode: 'word', role: 'coder' });
  check('P2 word 模式命中 coder', word.total === 1 && word.results[0].role === 'coder', word.total);
  const limit = await searchMemoryFromWorkspace(WS, { query: '数值', mode: 'hybrid', limit: '1' });
  check('P2 limit 截断', limit.results.length === 1, limit.results.length);
  const semantic = await searchMemoryFromWorkspace(WS, { query: '鲁棒性', mode: 'semantic' });
  check('P2 无嵌入配置时 semantic 回退', semantic.effectiveMode === 'hybrid' && !!semantic.fallback, semantic.effectiveMode);
  check('P2 回退后仍命中', semantic.total >= 1, semantic.total);
}

console.log('\n[P3] 参数校验 / 空工作区 / stats');
{
  let badMode = null;
  try { await searchMemoryFromWorkspace(WS, { query: 'x', mode: 'nope' }); } catch (err) { badMode = err.message; }
  check('P3 非法 mode 拒绝', /非法 mode/.test(badMode || ''), badMode);
  let noWs = null;
  try { await searchMemoryFromWorkspace('', { query: 'x' }); } catch (err) { noWs = err.message; }
  check('P3 空工作区拒绝', /未配置工作区/.test(noWs || ''), noWs);
  const empty = path.join(ROOT, 'empty');
  mkdirSync(empty, { recursive: true });
  const out = await searchMemoryFromWorkspace(empty, { query: '任意' });
  check('P3 空工作区返回 0 条', out.total === 0 && out.docs === 0, out.total + '/' + out.docs);
  const stats = await memoryStatsFromWorkspace(empty, { staleDays: '30' });
  check('P3 stats 可读', stats.docs === 0 && stats.embed && stats.embed.provider === 'hash', stats.embed && stats.embed.provider);
}

console.log('\n[P4] /api/memory/search 处理器');
{
  const missing = await handleMemorySearch(WS, new URLSearchParams());
  check('P4 缺 q => 400', missing.status === 400 && /缺少 q/.test(missing.body.error || ''), missing.status);
  const ok = await handleMemorySearch(WS, new URLSearchParams({ q: '数值稳定性', mode: 'hybrid', role: 'all', limit: '5' }));
  check('P4 正常查询 => 200 + results', ok.status === 200 && ok.body.ok === true && ok.body.total >= 1, ok.status + '/' + (ok.body && ok.body.total));
  const bad = await handleMemorySearch(WS, new URLSearchParams({ q: 'x', mode: 'nope' }));
  check('P4 非法 mode => 400', bad.status === 400 && /非法 mode/.test(bad.body.error || ''), bad.status);
  const noWs = await handleMemorySearch('', new URLSearchParams({ q: 'x' }));
  check('P4 空工作区 => 400', noWs.status === 400 && /未配置工作区/.test(noWs.body.error || ''), noWs.status);
}

rmSync(ROOT, { recursive: true, force: true });
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) process.exit(1);
