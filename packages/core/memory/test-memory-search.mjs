#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'memory-search.mjs');
const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-memory-test-'));
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

function run(workspace, home, args) {
  const r = spawnSync(process.execPath, [CLI, '--workspace', workspace, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MMCAS_HOME: home },
  });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  let json = null;
  try { json = JSON.parse((r.stdout || '').trim()); } catch {}
  return { code: r.status, out, json, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const WS = path.join(ROOT, 'ws');
const HOME = path.join(ROOT, 'home');
writeMemory(WS, 'modeler', '2026-09-01.md', [
  '## 10:00',
  '数值模型的稳定性分析：使用龙格-库塔法，步长 h=0.01。',
  '',
  '## 11:00',
  '数据预处理：缺失值用中位数填补。',
  '',
  '## 12:00',
  '数据可视化使用 matplotlib 输出图表。',
  '',
].join('\n'));
writeMemory(WS, 'coder', '2026-09-02.md', '## 09:30\nThe optimizer uses Adam with learning rate 1e-3; loss converged.\n');
writeMemory(WS, 'writer', '2026-09-03.md', '## 14:00\n论文摘要需要强调模型的鲁棒性和可复现性。\n');

console.log('\n[M1] 向量检索：中文近邻匹配');
{
  const r = run(WS, HOME, ['--mode', 'vector', '--json', '数值稳定性']);
  check('M1 exit0 + JSON', r.code === 0 && r.json && Array.isArray(r.json.results), r.code);
  check('M1 命中稳定性条目', r.json && r.json.results[0] && /稳定性/.test(r.json.results[0].text), r.json && r.json.results[0] && r.json.results[0].text.slice(0, 30));
  check('M1 余弦分数 > 0', r.json && r.json.results[0] && r.json.results[0].vectorScore > 0, r.json && r.json.results[0] && r.json.results[0].vectorScore);
}

console.log('\n[M2] 词匹配 vs 混合检索');
{
  const word = run(WS, HOME, ['--mode', 'word', '--json', '数值稳定性']);
  check('M2 词匹配无法命中跨词查询', word.code === 0 && word.json.total === 0, word.json && word.json.total);
  const hybrid = run(WS, HOME, ['--mode', 'hybrid', '--json', '数值稳定性']);
  check('M2 混合检索命中', hybrid.code === 0 && hybrid.json.total > 0, hybrid.json && hybrid.json.total);
  check('M2 混合分数包含向量与词匹配', hybrid.json && hybrid.json.results[0] && hybrid.json.results[0].score >= hybrid.json.results[0].vectorScore, hybrid.json && hybrid.json.results[0] && hybrid.json.results[0].score);
}

console.log('\n[M3] 角色 / 日期过滤');
{
  const role = run(WS, HOME, ['--mode', 'word', '--json', '--role', 'coder', 'optimizer']);
  check('M3 角色过滤命中 coder', role.code === 0 && role.json.total === 1 && role.json.results[0].role === 'coder', role.json && role.json.total);
  const date = run(WS, HOME, ['--mode', 'word', '--json', '--role', 'writer', '--since', '2026-09-03', '--until', '2026-09-03', '鲁棒性']);
  check('M3 日期过滤命中 writer', date.code === 0 && date.json.total === 1, date.json && date.json.total);
  const outside = run(WS, HOME, ['--mode', 'word', '--json', '--since', '2026-09-04', '鲁棒性']);
  check('M3 日期窗外无命中', outside.code === 0 && outside.json.total === 0, outside.json && outside.json.total);
}

console.log('\n[M4] limit 与排序');
{
  const all = run(WS, HOME, ['--mode', 'hybrid', '--json', '数据']);
  check('M4 同一查询多条命中', all.code === 0 && all.json.total >= 2, all.json && all.json.total);
  const one = run(WS, HOME, ['--mode', 'hybrid', '--json', '--limit', '1', '数据']);
  check('M4 limit 截断但 total 保留', one.code === 0 && one.json.results.length === 1 && one.json.total === all.json.total, one.json && one.json.results.length + '/' + one.json.total);
}

console.log('\n[M5] 索引缓存与增量重建');
{
  const stats1 = run(WS, HOME, ['--stats', '--json']);
  check('M5 索引落盘在 MMCAS_HOME', stats1.code === 0 && stats1.json.indexPath.startsWith(HOME), stats1.json && stats1.json.indexPath);
  check('M5 首次统计 5 条文档', stats1.json && stats1.json.docs === 5, stats1.json && stats1.json.docs);
  check('M5 缓存命中不重建', stats1.json && stats1.json.rebuilt === false, stats1.json && stats1.json.rebuilt);
  check('M5 工作区不落索引文件', !existsSync(path.join(WS, '.mmcas')));
  appendFileSync(path.join(WS, 'memory', 'modeler', '2026-09-01.md'), '\n## 13:00\n蒙特卡洛模拟用于风险评估。\n', 'utf8');
  const added = run(WS, HOME, ['--mode', 'hybrid', '--json', '蒙特卡洛']);
  check('M5 文件变更后自动重建并命中', added.code === 0 && added.json.total === 1 && added.json.rebuilt === true, added.json && added.json.total);
  check('M5 重建后文档数 6', added.json && added.json.docs === 6, added.json && added.json.docs);
  const stats2 = run(WS, HOME, ['--stats', '--json']);
  check('M5 重建后再次命中缓存', stats2.json && stats2.json.rebuilt === false, stats2.json && stats2.json.rebuilt);
  rmSync(path.join(WS, 'memory', 'coder', '2026-09-02.md'));
  const removed = run(WS, HOME, ['--mode', 'word', '--json', '--role', 'coder', 'optimizer']);
  check('M5 删除文件后索引同步移除', removed.code === 0 && removed.json.total === 0, removed.json && removed.json.total);
}

console.log('\n[M6] 词匹配模式不依赖索引');
{
  const WS2 = path.join(ROOT, 'ws-word');
  const HOME2 = path.join(ROOT, 'home-word');
  writeMemory(WS2, 'coder', '2026-09-05.md', '## 08:00\nalpha beta gamma\n');
  const r = run(WS2, HOME2, ['--mode', 'word', '--json', 'alpha']);
  check('M6 词匹配命中', r.code === 0 && r.json.total === 1, r.json && r.json.total);
  check('M6 未创建索引目录', !existsSync(path.join(HOME2, 'memory-index')));
}

console.log('\n[M7] BOM 与空工作区');
{
  const WS3 = path.join(ROOT, 'ws-bom');
  writeMemory(WS3, 'coder', '2026-09-06.md', '\uFEFF## 08:00\nalpha beta\n');
  const bom = run(WS3, path.join(ROOT, 'home-bom'), ['--mode', 'word', '--json', 'alpha']);
  check('M7 UTF-8 BOM 不影响首条', bom.code === 0 && bom.json.total === 1, bom.json && bom.json.total);
  const WS4 = path.join(ROOT, 'ws-empty');
  mkdirSync(WS4, { recursive: true });
  const empty = run(WS4, path.join(ROOT, 'home-empty'), ['--json', '任意']);
  check('M7 空工作区正常返回 0 条', empty.code === 0 && empty.json.total === 0 && empty.json.docs === 0, empty.json && empty.json.total);
}

console.log('\n[M8] 参数校验与 CLI 兼容');
{
  const noQuery = run(WS, HOME, []);
  check('M8 缺查询词 exit2', noQuery.code === 2 && /用法/.test(noQuery.out), noQuery.code);
  const badMode = run(WS, HOME, ['--mode', 'nope', '数据']);
  check('M8 非法 mode exit2', badMode.code === 2 && /非法 mode/.test(badMode.out), badMode.out);
  const badRole = run(WS, HOME, ['--role', 'nobody', '数据']);
  check('M8 非法 role exit2', badRole.code === 2 && /非法 role/.test(badRole.out), badRole.out);
  const defaultMode = run(WS, HOME, ['--json', '数据']);
  check('M8 默认 hybrid', defaultMode.code === 0 && defaultMode.json.mode === 'hybrid', defaultMode.json && defaultMode.json.mode);
  const legacy = run(WS, HOME, ['--mode', 'word', '数据']);
  check('M8 词匹配文本输出兼容', legacy.code === 0 && /共 .* 条命中/.test(legacy.out), legacy.out.split('\n').pop());
}

rmSync(ROOT, { recursive: true, force: true });
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) process.exit(1);
