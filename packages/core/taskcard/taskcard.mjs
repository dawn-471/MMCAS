#!/usr/bin/env node
/**
 * MMCAS taskcard v2 —— 任务卡状态机护栏（零依赖，三状态简化版）
 *
 * 用法:
 *   node taskcard.mjs validate <tasksDir>
 *   node taskcard.mjs update <tasksDir> <id> <to-status>
 *   node taskcard.mjs list <tasksDir>
 *   node taskcard.mjs create <tasksDir> <title> --owner <role> --priority <P0|P1|P2> [--deps <T-001,T-002>] [--desc <text>]
 *   node taskcard.mjs edit <tasksDir> <id> [--title <t>] [--owner <role>] [--priority <P0|P1|P2>] [--deps <T-001,T-002>] [--desc <t>]
 *   node taskcard.mjs delete <tasksDir> <id> [--force]
 *
 * 状态机（specs/task-card.md v2）:
 *   todo -> doing -> done
 *   doing -> todo（退回）; done -> doing（打回）
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const VALID_STATUS = ['todo', 'doing', 'done'];
const VALID_ROLES = ['modeler', 'coder', 'writer'];
const VALID_PRIORITY = ['P0', 'P1', 'P2'];
const WIP_LIMIT = 2; // 每角色同时 doing 上限
const TRANSITIONS = {
  todo: ['doing'],
  doing: ['done', 'todo'],
  done: ['doing'],
};

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

function parseCard(file) {
  const text = readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { id: path.basename(file, '.md'), valid: false, error: '缺少 frontmatter' };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.split(':');
    if (kv.length >= 2) fm[kv[0].trim()] = kv.slice(1).join(':').trim();
  }
  const ok = VALID_STATUS.includes(fm.status);
  return { ...fm, id: fm.id || path.basename(file, '.md'), file, valid: ok, error: ok ? null : `非法状态: ${fm.status}` };
}

function loadCards(tasksDir) {
  if (!existsSync(tasksDir)) return [];
  return readdirSync(tasksDir).filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => parseCard(path.join(tasksDir, f)));
}

function parseDeps(card) {
  return (card.deps || '').replace(/[\[\]']/g, '').split(',').map((s) => s.trim()).filter((x) => x);
}

// --deps 参数解析（逗号/中文逗号/空白分隔；返回 null 表示**未传**该参数）
//
// ⚠ 2026-09-11 修复（建模手·跨角色）：原文对 `--deps ""`（清空依赖）返回的也是 null，
//   于是 `edit --deps ""` 走到 `depsArg !== null` 分支后 `for (const d of null)` 直接崩：
//   `TypeError: parseDepsArg(...) is not iterable`。
//   根因是**把"未传参数"与"传了空值"混成同一个信号**（都是 null）。
//   现在语义清晰：null/undefined = 未传（保留原依赖）；其余值 = 已传，空值即"清空依赖"（返回 []）。
//   这也让 `--deps ""` 成为解除依赖链的合法入口。
function parseDepsArg(v) {
  if (v === null || v === undefined) return null;   // 未传
  return String(v).replace(/[\[\]']/g, '').split(/[,，\s]+/).map((s) => s.trim()).filter((x) => x);
}

function checkTransition(card, to, allCards) {
  if (!VALID_STATUS.includes(to)) return { ok: false, reason: `目标状态非法: ${to}` };
  if (!card.valid) return { ok: false, reason: card.error };
  const allowed = TRANSITIONS[card.status] || [];
  if (!allowed.includes(to)) return { ok: false, reason: `非法迁移: ${card.status} -> ${to}（允许: ${allowed.join(', ') || '无'}）` };
  // 依赖门控（v3）：todo -> doing 前所有 deps 必须 done
  if (to === 'doing' && card.status === 'todo') {
    const deps = parseDeps(card);
    const pending = deps.filter((d) => {
      const dep = (allCards || []).find((c) => c.id === d);
      return !dep || dep.status !== 'done';
    });
    if (pending.length) return { ok: false, reason: `依赖未完成，等待: ${pending.join(', ')}` };
    // WIP 限制
    const doingCount = (allCards || []).filter((c) => c.status === 'doing' && c.owner === card.owner).length;
    if (doingCount >= WIP_LIMIT) return { ok: false, reason: `WIP 超限：${card.owner} 已有 ${doingCount} 个进行中任务（上限 ${WIP_LIMIT}）` };
  }
  return { ok: true, reason: '' };
}

const cmd = process.argv[2];
const dir = process.argv[3];
if (!cmd || !dir) {
  console.error('用法: taskcard validate|list|create|delete <tasksDir> 或 taskcard update <tasksDir> <id> <to-status>');
  process.exit(2);
}

if (cmd === 'list') {
  const PRIO_ORDER = { P0: 0, P1: 1, P2: 2 };
  const cards = loadCards(dir).sort((a, b) => {
    const pa = PRIO_ORDER[a.priority] ?? 9;
    const pb = PRIO_ORDER[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
  for (const c of cards) {
    console.log(`  ${c.id.padEnd(8)} [${(c.priority || '-').padEnd(2)}] [${c.status}]  ${c.title || '(无标题)'}  owner=${c.owner || '-'}`);
  }
  process.exit(0);
}

if (cmd === 'validate') {
  const cards = loadCards(dir);
  let fail = 0;
  const ids = new Set(cards.map((c) => c.id));
  for (const c of cards) {
    if (!c.valid) { console.log(`FAIL ${c.id}: ${c.error}`); fail++; }
    if (c.owner && !VALID_ROLES.includes(c.owner)) { console.log(`FAIL ${c.id}: 非法 owner: ${c.owner}`); fail++; }
    if (c.priority && !VALID_PRIORITY.includes(c.priority)) { console.log(`FAIL ${c.id}: 非法 priority: ${c.priority}`); fail++; }
    for (const dep of parseDeps(c)) {
      if (!ids.has(dep)) { console.log(`FAIL ${c.id}: 依赖不存在 ${dep}`); fail++; }
    }
  }
  console.log(fail === 0 ? `OK 全部 ${cards.length} 张任务卡校验通过` : `${fail} 项问题`);
  process.exit(fail === 0 ? 0 : 1);
}

if (cmd === 'update') {
  const id = process.argv[4];
  const to = process.argv[5];
  const cards = loadCards(dir);
  const card = cards.find((c) => c.id === id);
  if (!card) { console.error(`未找到任务卡: ${id}`); process.exit(2); }
  const r = checkTransition(card, to, cards);
  if (!r.ok) { console.error(`拒绝: ${r.reason}`); process.exit(1); }
  const text = readFileSync(card.file, 'utf8');
  const updated = new Date().toISOString().slice(0, 10);
  const newText = text
    .replace(/^status: .*$/m, `status: ${to}`)
    .replace(/^updated: .*$/m, `updated: ${updated}`);
  writeFileSync(card.file, newText);
  console.log(`OK ${id}: ${card.status} -> ${to}`);
  process.exit(0);
}

if (cmd === 'create') {
  const title = process.argv[4];
  const owner = arg('owner') || 'coder';
  const desc = arg('desc') || '';
  const priority = arg('priority') || 'P1';
  const deps = parseDepsArg(arg('deps')) || [];
  if (!title) { console.error('用法: taskcard create <tasksDir> <标题> --owner <role> --priority <P0|P1|P2> [--deps <T-001,T-002>] [--desc <说明>]'); process.exit(2); }
  if (!VALID_ROLES.includes(owner)) { console.error(`非法 owner: ${owner}`); process.exit(2); }
  if (!VALID_PRIORITY.includes(priority)) { console.error(`非法 priority: ${priority}`); process.exit(2); }
  const cards = loadCards(dir);
  const knownIds = new Set(cards.map((c) => c.id));
  for (const d of deps) {
    if (!knownIds.has(d)) { console.error(`依赖不存在: ${d}`); process.exit(2); }
  }
  const nums = cards.map((c) => parseInt(c.id.replace(/\D/g, ''), 10) || 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  const id = `T-${String(next).padStart(3, '0')}`;
  const today = new Date().toISOString().slice(0, 10);
  const card = `---\nid: ${id}\ntitle: ${title}\nstatus: todo\nowner: ${owner}\npriority: ${priority}\ncreated: ${today}\nupdated: ${today}\ndeps: [${deps.join(', ')}]\n---\n## 目标\n${desc || title}\n\n## 产出物\n- [ ]\n\n## 进度记录\n\n## 批注\n`;
  writeFileSync(path.join(dir, `${id}.md`), card);
  console.log(`OK 已创建 ${id}（owner=${owner}${deps.length ? `, deps=[${deps.join(', ')}]` : ''}）`);
  process.exit(0);
}

if (cmd === 'edit') {
  const id = process.argv[4];
  const title = arg('title');
  const owner = arg('owner');
  const desc = arg('desc');
  const priority = arg('priority');
  const depsArg = arg('deps');
  const cards = loadCards(dir);
  const card = cards.find((c) => c.id === id);
  if (!card) { console.error(`未找到任务卡: ${id}`); process.exit(2); }
  if (owner && !VALID_ROLES.includes(owner)) { console.error(`非法 owner: ${owner}`); process.exit(2); }
  if (priority && !VALID_PRIORITY.includes(priority)) { console.error(`非法 priority: ${priority}`); process.exit(2); }
  if (depsArg !== null) {
    const knownIds = new Set(cards.map((c) => c.id));
    for (const d of parseDepsArg(depsArg)) {
      if (d === id) { console.error(`依赖不能指向自己: ${id}`); process.exit(2); }
      if (!knownIds.has(d)) { console.error(`依赖不存在: ${d}`); process.exit(2); }
    }
  }
  if (!title && !owner && !desc && !priority && depsArg === null) {
    console.error('edit 至少需要一个 --title/--owner/--priority/--deps/--desc');
    process.exit(2);
  }
  let text = readFileSync(card.file, 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  if (title) text = text.replace(/^title: .*$/m, `title: ${title}`);
  if (owner) text = text.replace(/^owner: .*$/m, `owner: ${owner}`);
  if (priority) text = text.replace(/^priority: .*$/m, `priority: ${priority}`);
  if (depsArg !== null) text = text.replace(/^deps: .*$/m, `deps: [${parseDepsArg(depsArg).join(', ')}]`);
  if (desc) text = text.replace(/^## 目标\n[\s\S]*?(?=\n## 产出物)/, `## 目标\n${desc}`);
  text = text.replace(/^updated: .*$/m, `updated: ${today}`);
  writeFileSync(card.file, text);
  const fields = [title && 'title', owner && 'owner', priority && 'priority', depsArg !== null && 'deps', desc && 'desc'].filter(Boolean);
  console.log(`OK ${id} 已更新（${fields.join(', ')}）`);
  process.exit(0);
}

if (cmd === 'delete') {
  const id = process.argv[4];
  const force = process.argv.includes('--force');
  const cards = loadCards(dir);
  const card = cards.find((c) => c.id === id);
  if (!card) { console.error(`未找到任务卡: ${id}`); process.exit(2); }
  // 被依赖防护：删除会让下游卡永久等待（DAG 死锁）
  const dependents = cards.filter((c) => c.id !== id && parseDeps(c).includes(id));
  if (dependents.length && !force) {
    console.error(`拒绝: ${id} 被以下卡依赖，删除会造成依赖死锁: ${dependents.map((c) => c.id).join(', ')}`);
    console.error(`（先解除其 deps，或确认无误后用 --force 强制删除）`);
    process.exit(1);
  }
  unlinkSync(card.file);
  console.log(`OK 已删除 ${id}${dependents.length ? `（强制，${dependents.length} 张下游卡依赖已断）` : ''}`);
  process.exit(0);
}

console.error('未知命令');
process.exit(2);
