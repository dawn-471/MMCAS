#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, 'memory-archive.mjs');
const SEARCH = path.join(HERE, 'memory-search.mjs');
const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-memory-archive-'));
const WS = path.join(ROOT, 'ws');
const HOME = path.join(ROOT, 'home');
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

function writeMemory(role, name, text) {
  const dir = path.join(WS, 'memory', role);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), text, 'utf8');
}

function run(cli, args) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MMCAS_HOME: HOME },
  });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  let json = null;
  try { json = JSON.parse((r.stdout || '').trim()); } catch {}
  return { code: r.status, out, json };
}

writeMemory('modeler', '2026-01-10.md', '## 10:00\n早期模型：线性规划。\n');
writeMemory('modeler', '2026-06-10.md', '## 11:00\n近期模型：鲁棒优化。\n');
writeMemory('coder', '2025-12-20.md', '## 09:00\n旧代码：蒙特卡洛。\n');
writeMemory('writer', '2026-06-11.md', '## 12:00\n论文摘要。\n');

console.log('\n[MA1] dry-run 不移动');
{
  const r = run(ARCHIVE, ['--workspace', WS, '--before', '2026-05-01', '--json']);
  check('MA1 dry-run exit0', r.code === 0 && r.json && r.json.apply === false, r.out.slice(0, 120));
  check('MA1 待归档 2 个', r.json && r.json.count === 2 && r.json.moved === 0, r.json && JSON.stringify({ count: r.json.count, moved: r.json.moved }));
  check('MA1 文件未移动', existsSync(path.join(WS, 'memory', 'modeler', '2026-01-10.md')) && existsSync(path.join(WS, 'memory', 'coder', '2025-12-20.md')));
}

console.log('\n[MA2] apply 移动 + 搜索排除/包含');
{
  const r = run(ARCHIVE, ['--workspace', WS, '--before', '2026-05-01', '--apply', '--json']);
  check('MA2 apply 移动 2 个', r.code === 0 && r.json && r.json.moved === 2, r.json && r.json.moved);
  check('MA2 archive 文件存在', existsSync(path.join(WS, 'memory', 'modeler', 'archive', '2026-01-10.md')) && existsSync(path.join(WS, 'memory', 'coder', 'archive', '2025-12-20.md')));
  const excluded = run(SEARCH, ['--workspace', WS, '--mode', 'word', '--json', '线性规划']);
  check('MA2 默认搜索不含归档', excluded.code === 0 && excluded.json && excluded.json.total === 0, excluded.json && excluded.json.total);
  const included = run(SEARCH, ['--workspace', WS, '--mode', 'word', '--json', '--include-archive', '线性规划']);
  check('MA2 --include-archive 可搜索', included.code === 0 && included.json && included.json.total === 1, included.json && included.json.total);
  const recent = run(SEARCH, ['--workspace', WS, '--mode', 'word', '--json', '鲁棒优化']);
  check('MA2 近期文件仍在默认搜索', recent.code === 0 && recent.json && recent.json.total === 1, recent.json && recent.json.total);
}

console.log('\n[MA3] 角色过滤 / 参数校验');
{
  const role = run(ARCHIVE, ['--workspace', WS, '--before', '2027-01-01', '--role', 'writer', '--json']);
  check('MA3 角色过滤只列 writer', role.code === 0 && role.json && role.json.count === 1 && role.json.items[0].role === 'writer', role.json && role.json.count);
  const bad = run(ARCHIVE, ['--workspace', WS, '--before', 'bad', '--json']);
  check('MA3 非法日期 exit2', bad.code === 2 && /用法/.test(bad.out), bad.code);
}

rmSync(ROOT, { recursive: true, force: true });
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) process.exit(1);
