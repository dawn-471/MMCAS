#!/usr/bin/env node
/**
 * MMCAS taskcard v2 —— 任务卡状态机护栏（零依赖，三状态简化版）
 *
 * 用法:
 *   node taskcard.mjs validate <tasksDir>
 *   node taskcard.mjs update <tasksDir> <id> <to-status> [--reason <原因>]   # 打回（done→todo）必填原因
 *   node taskcard.mjs list <tasksDir>
 *   node taskcard.mjs create <tasksDir> <title> --owner <role> --priority <P0|P1|P2> [--deps <T-001,T-002>] [--desc <text>]
 *   node taskcard.mjs create <tasksDir> <title> --from <coder|writer> [--desc <text>] [--evidence <证据>]   # 回程卡：owner 固定 modeler/P1
 *   node taskcard.mjs edit <tasksDir> <id> [--title <t>] [--owner <role>] [--priority <P0|P1|P2>] [--deps <T-001,T-002>] [--desc <t>]
 *   node taskcard.mjs delete <tasksDir> <id> [--force]
 *
 * 状态机（specs/task-card.md v4）:
 *   todo -> doing -> done
 *   doing -> todo（退回）; done -> doing（打回，v1.2 语义修订进行中）
 *
 * v1.2：WIP 改为可配软约束——环境变量 MMCAS_WIP_LIMIT（正整数；0/缺省 = 不限制，并行以依赖门控为准）。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const VALID_STATUS = ['todo', 'doing', 'done'];
const VALID_ROLES = ['modeler', 'coder', 'writer'];
const VALID_PRIORITY = ['P0', 'P1', 'P2'];
// v1.2：0/缺省 = 不限制；仅显式配置正整数时按老语义拦截
const WIP_LIMIT = Math.max(parseInt(process.env.MMCAS_WIP_LIMIT || '0', 10) || 0, 0);
const TRANSITIONS = {
  todo: ['doing'],
  doing: ['done', 'todo'],
  done: ['todo'],
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

function checkTransition(card, to, allCards, opts) {
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
    // WIP 限制（v1.2：仅显式配置 MMCAS_WIP_LIMIT>0 时生效；默认不限制）
    const doingCount = (allCards || []).filter((c) => c.status === 'doing' && c.owner === card.owner).length;
    if (WIP_LIMIT > 0 && doingCount >= WIP_LIMIT) return { ok: false, reason: `WIP 超限：${card.owner} 已有 ${doingCount} 个进行中任务（上限 ${WIP_LIMIT}）` };
  }
  // v1.2：打回（done→todo）必须带原因；附带下游影响提示（不阻塞）
  if (to === 'todo' && card.status === 'done') {
    const reason = String((opts && opts.reason) || '').trim();
    if (!reason) return { ok: false, reason: '打回必须填写原因（--reason <原因>）' };
    const dependents = (allCards || []).filter((c) => c.id !== card.id && parseDeps(c).includes(card.id) && c.status !== 'todo');
    return { ok: true, reason: '', warning: dependents.length ? `打回影响已开始的下游卡：${dependents.map((c) => c.id).join(', ')}（请评估是否连带重做）` : '' };
  }
  return { ok: true, reason: '' };
}

// v1.2：打回辅助——原因写入批注区；rework 计数（无则置 1）
function appendReworkNote(text, reason) {
  const line = `- ${new Date().toISOString().slice(0, 10)} 打回：${reason}`;
  if (/## 批注\s*\n/.test(text)) return text.replace(/(## 批注\s*\n)/, `$1${line}\n`);
  return text.trimEnd() + `\n\n## 批注\n${line}\n`;
}
function bumpRework(text) {
  if (/^rework: \d+$/m.test(text)) return text.replace(/^rework: (\d+)$/m, (m0, n) => `rework: ${Number(n) + 1}`);
  if (/^deps: .*$/m.test(text)) return text.replace(/^(deps: .*)$/m, `$1\nrework: 1`);
  return text.replace(/^(updated: .*)$/m, `$1\nrework: 1`);
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
  const reason = arg('reason');
  const cards = loadCards(dir);
  const card = cards.find((c) => c.id === id);
  if (!card) { console.error(`未找到任务卡: ${id}`); process.exit(2); }
  const r = checkTransition(card, to, cards, { reason });
  if (!r.ok) { console.error(`拒绝: ${r.reason}`); process.exit(1); }
  let newText = readFileSync(card.file, 'utf8');
  const updated = new Date().toISOString().slice(0, 10);
  newText = newText
    .replace(/^status: .*$/m, `status: ${to}`)
    .replace(/^updated: .*$/m, `updated: ${updated}`);
  // v1.2：打回（done→todo）——原因入批注 + rework 计数
  if (card.status === 'done' && to === 'todo') {
    newText = appendReworkNote(newText, String(reason || '').trim());
    newText = bumpRework(newText);
  }
  writeFileSync(card.file, newText);
  console.log(`OK ${id}: ${card.status} -> ${to}${r.warning ? '（注意：' + r.warning + '）' : ''}`);
  process.exit(0);
}

if (cmd === 'create') {
  const title = process.argv[4];
  const fromRole = arg('from');
  // v1.2：回程卡受限通道（T3.3）——coder/writer → modeler；字段组合由护栏固定
  if (fromRole) {
    if (!['coder', 'writer'].includes(fromRole)) { console.error(`--from 非法: ${fromRole}（仅 coder|writer）`); process.exit(2); }
    if (arg('owner') || arg('priority') || arg('deps')) { console.error('回程卡通道不接受 --owner/--priority/--deps（由护栏固定为 modeler/P1/无依赖）'); process.exit(2); }
    if (!title) { console.error('用法: taskcard create <tasksDir> <标题> --from <coder|writer> [--desc <说明>] [--evidence <证据引用>]'); process.exit(2); }
    const desc0 = arg('desc') || '';
    const evidence0 = arg('evidence') || '';
    const cards0 = loadCards(dir);
    const nums0 = cards0.map((c) => parseInt(c.id.replace(/\D/g, ''), 10) || 0);
    const id0 = `T-${String((nums0.length ? Math.max(...nums0) : 0) + 1).padStart(3, '0')}`;
    const today0 = new Date().toISOString().slice(0, 10);
    const card0 = `---\nid: ${id0}\ntitle: ${title}\nstatus: todo\nowner: modeler\npriority: P1\ncreated: ${today0}\nupdated: ${today0}\ndeps: []\norigin: ${fromRole}\n---\n## 问题描述\n${desc0 || title}\n\n## 证据引用\n${evidence0 || '（待补充）'}\n\n## 进度记录\n\n## 批注\n`;
    writeFileSync(path.join(dir, `${id0}.md`), card0);
    console.log(`OK 已创建回程卡 ${id0}（origin=${fromRole} → owner=modeler, P1）`);
    process.exit(0);
  }
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
