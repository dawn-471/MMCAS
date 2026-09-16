#!/usr/bin/env node
/**
 * test-taskcard.mjs —— taskcard.mjs 护栏单测（v1.2：WIP 改可配软约束）
 *
 * 方式：临时 tasks 目录 + spawnSync 直接调用 CLI（黑盒，测的就是交付物本尊）。
 * 覆盖：
 *   W1  create 生成合法卡
 *   W2  list 按 priority 排序（P0 前）
 *   W3  todo→doing 认领（deps 满足）
 *   W4  deps 未完成 ⇒ 拒绝
 *   W5  WIP 默认（未设 MMCAS_WIP_LIMIT）⇒ 不限制（doing=3 仍可认领）
 *   W6  MMCAS_WIP_LIMIT=1 ⇒ 第 2 张被拒（提示上限 1）
 *   W7  done→doing 打回（本版保留旧语义；done→todo 修订属 v1.2 后续批次）
 *   W8  delete 被依赖卡 ⇒ 拒绝；--force ⇒ 成功
 *   W9  edit --deps "" ⇒ 清空依赖
 *   W10 validate 通过
 *
 * 运行：`node test-taskcard.mjs`
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'taskcard.mjs');
const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-taskcard-test-'));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}
function run(tasks, args, env) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MMCAS_WIP_LIMIT: undefined, ...(env || {}) },
  });
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}
function statusOf(tasks, id) {
  const m = readFileSync(path.join(tasks, `${id}.md`), 'utf8').match(/^status: (.*)$/m);
  return m ? m[1].trim() : null;
}

const T1 = path.join(ROOT, 'tasks-a');
mkdirSync(T1, { recursive: true });

console.log('\n[W1/W2] create + list 排序');
{
  let r = run(T1, ['create', T1, '一号任务', '--owner', 'coder', '--priority', 'P1', '--desc', 'x']);
  check('W1 create T-001', r.code === 0 && existsSync(path.join(T1, 'T-001.md')), r.out);
  r = run(T1, ['create', T1, '零号任务', '--owner', 'coder', '--priority', 'P0']);
  check('W1 create T-002', r.code === 0 && existsSync(path.join(T1, 'T-002.md')), r.out);
  r = run(T1, ['list', T1]);
  const order = r.out.split('\n').map((l) => (l.match(/T-\d+/) || [''])[0]).filter(Boolean);
  check('W2 P0 排在 P1 前', order[0] === 'T-002' && order[1] === 'T-001', order.join(','));
}

console.log('\n[W3/W4] 认领与依赖门控');
{
  let r = run(T1, ['update', T1, 'T-001', 'doing']);
  check('W3 todo→doing（deps 空）', r.code === 0 && statusOf(T1, 'T-001') === 'doing', r.out);
  r = run(T1, ['create', T1, '依赖任务', '--owner', 'coder', '--priority', 'P1', '--deps', 'T-002']);
  check('W4 建依赖卡 T-003', r.code === 0, r.out);
  r = run(T1, ['update', T1, 'T-003', 'doing']);
  check('W4 deps 未完成 ⇒ 拒绝', r.code !== 0 && /依赖未完成/.test(r.out), r.out);
}

console.log('\n[W5] WIP 默认不限制');
{
  let ok = true, msg = '';
  for (const id of ['T-001']) { /* 已 doing */ }
  // 再建两张并认领（doing 将达 3）——默认不拦截
  run(T1, ['create', T1, '并行二', '--owner', 'coder', '--priority', 'P2']);
  run(T1, ['create', T1, '并行三', '--owner', 'coder', '--priority', 'P2']);
  const r1 = run(T1, ['update', T1, 'T-004', 'doing']);
  const r2 = run(T1, ['update', T1, 'T-005', 'doing']);
  ok = r1.code === 0 && r2.code === 0;
  msg = r1.out + ' | ' + r2.out;
  check('W5 doing=3 仍可认领（默认不限制）', ok, msg);
}

console.log('\n[W6] MMCAS_WIP_LIMIT=1 显式拦截');
{
  const T2 = path.join(ROOT, 'tasks-b');
  mkdirSync(T2, { recursive: true });
  run(T2, ['create', T2, 'w1', '--owner', 'writer', '--priority', 'P1']);
  run(T2, ['create', T2, 'w2', '--owner', 'writer', '--priority', 'P1']);
  const r1 = run(T2, ['update', T2, 'T-001', 'doing'], { MMCAS_WIP_LIMIT: '1' });
  const r2 = run(T2, ['update', T2, 'T-002', 'doing'], { MMCAS_WIP_LIMIT: '1' });
  check('W6 第 1 张可认领', r1.code === 0 && statusOf(T2, 'T-001') === 'doing', r1.out);
  check('W6 第 2 张被拒（上限 1）', r2.code !== 0 && /WIP 超限.*上限 1/.test(r2.out), r2.out);
  check('W6 第 2 张仍 todo', statusOf(T2, 'T-002') === 'todo', statusOf(T2, 'T-002'));
}

console.log('\n[W7] v1.2 状态机：done→doing 已废除；done→todo 打回需原因');
{
  let r = run(T1, ['update', T1, 'T-001', 'done']);
  check('W7 先置 done', r.code === 0 && statusOf(T1, 'T-001') === 'done', r.out);
  r = run(T1, ['update', T1, 'T-001', 'doing']);
  check('W7 done→doing 被拒绝（非法迁移）', r.code !== 0 && /非法迁移/.test(r.out), r.out.slice(0, 60));
  r = run(T1, ['update', T1, 'T-001', 'todo']);
  check('W7 打回缺原因 ⇒ 拒绝', r.code !== 0 && /原因/.test(r.out), r.out.slice(0, 60));
  r = run(T1, ['update', T1, 'T-001', 'todo', '--reason', '结果不达标，需重做']);
  check('W7 打回（带原因）⇒ OK', r.code === 0 && statusOf(T1, 'T-001') === 'todo', r.out);
  const t1 = readFileSync(path.join(T1, 'T-001.md'), 'utf8');
  check('W7 批注记录原因', /打回：结果不达标/.test(t1));
  check('W7 rework=1', /^rework: 1$/m.test(t1), (t1.match(/rework: \d+/) || [''])[0]);
}

console.log('\n[W8] 删除被依赖卡防护');
{
  let r = run(T1, ['delete', T1, 'T-002']);
  check('W8 被 T-003 依赖 ⇒ 拒绝', r.code !== 0 && /依赖/.test(r.out), r.out.slice(0, 80));
  r = run(T1, ['delete', T1, 'T-003']);
  check('W8 先删下游 T-003', r.code === 0, r.out);
  r = run(T1, ['delete', T1, 'T-002']);
  check('W8 无依赖后删除成功', r.code === 0, r.out);
}

console.log('\n[W9] edit --deps "" 清空依赖');
{
  const T3 = path.join(ROOT, 'tasks-c');
  mkdirSync(T3, { recursive: true });
  run(T3, ['create', T3, 'a', '--owner', 'coder']);
  run(T3, ['create', T3, 'b', '--owner', 'coder', '--deps', 'T-001']);
  let r = run(T3, ['edit', T3, 'T-002', '--deps', '']);
  const txt = readFileSync(path.join(T3, 'T-002.md'), 'utf8');
  check('W9 deps 清空为 []', r.code === 0 && /^deps: \[\]$/m.test(txt), r.out);
  r = run(T3, ['edit', T3, 'T-002', '--deps', 'T-001']);
  check('W9 deps 重新设置', r.code === 0 && /^deps: \[T-001\]$/m.test(readFileSync(path.join(T3, 'T-002.md'), 'utf8')), r.out);
}

console.log('\n[W11/W12] 打回轮次与再流动');
{
  let r = run(T1, ['update', T1, 'T-001', 'doing']);
  check('W11 重新认领', r.code === 0, r.out);
  r = run(T1, ['update', T1, 'T-001', 'done']);
  check('W11 完成', r.code === 0, r.out);
  r = run(T1, ['update', T1, 'T-001', 'todo', '--reason', '第二次打回']);
  const t1 = readFileSync(path.join(T1, 'T-001.md'), 'utf8');
  check('W12 二轮打回 OK 且 rework=2', r.code === 0 && /^rework: 2$/m.test(t1), (t1.match(/rework: \d+/) || [''])[0]);
}

console.log('\n[W13] 回程卡受限通道');
{
  const T4 = path.join(ROOT, 'tasks-d');
  mkdirSync(T4, { recursive: true });
  let r = run(T4, ['create', T4, '需要裁决：模型口径冲突', '--from', 'coder', '--desc', '两个口径结果不一致', '--evidence', 'T-001 批注']);
  const f = path.join(T4, 'T-001.md');
  const t = readFileSync(f, 'utf8');
  check('W13 回程卡创建成功', r.code === 0 && existsSync(f), r.out);
  check('W13 owner=modeler / P1 / origin=coder', /^owner: modeler$/m.test(t) && /^priority: P1$/m.test(t) && /^origin: coder$/m.test(t));
  check('W13 含问题描述/证据引用区', /## 问题描述/.test(t) && /## 证据引用/.test(t));
  r = run(T4, ['create', T4, 'x', '--from', 'coder', '--owner', 'writer']);
  check('W13 --owner 被拒', r.code !== 0 && /不接受/.test(r.out), r.out.slice(0, 60));
  r = run(T4, ['create', T4, 'x', '--from', 'modeler', '--desc', 'd']);
  check('W13 --from modeler 被拒', r.code !== 0, r.out.slice(0, 60));
}

console.log('\n[W10] validate');
{
  const r = run(T1, ['validate', T1]);
  check('W10 validate 通过', r.code === 0 && /OK/.test(r.out), r.out.slice(0, 80));
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
process.exit(fail === 0 ? 0 : 1);
