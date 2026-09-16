#!/usr/bin/env node
/**
 * test-poller.mjs —— @mmcas/dsh-panel 任务轮询器离线验收套件（v1.2 批次 B 版）
 *
 * 覆盖（自动接取 v2 + v1.2 加固 + T2.2/T2.3 会话生命周期 + T3.1/T3.2 消息层）：
 *   C1  接取写盘 + 新会话创建（标题/ cwd / card→session 映射落盘）+ 注入
 *   C2  注入文案（已自动接取）
 *   C3  deps 未完成 / owner 不符不接（且不为它们建会话）
 *   C4  注入失败 ⇒ 回滚为 todo（followup 与 prompt 双通道都失败时）
 *   C5  autoClaim=关 ⇒ 只提醒不翻牌（提醒投到新会话）
 *   C6  回退路径：无 sessionController ⇒ 注入最近活跃 + targetSessionId 钉死
 *   C7  旧版共享 poller.json 迁移 + 新字段落盘（sessions/reworkNotified）
 *   C8  单例锁：同目录双实例——第二实例停用 + 上报 + 主实例退出后接管
 *   C9  回退路径的排除规则：已处理该卡的会话不被再选
 *   C10 WIP 可配：wipLimit=1 拦截（且不建会话）；wipLimit=0 不限制
 *   C11 接取顺序：priority 升序（P0 先）
 *   C12 打回续做：rework>0 + 映射存在 ⇒ 注入原会话（不新建）；重复轮次不重注入
 *   C13 打回无映射 ⇒ 新建会话兜底
 *   C14 prompt 兜底：新会话 agent 不可用 ⇒ sessionController.prompt 被调用
 *   C15 notices：normal ⇒ queue 注入 + delivered 回写；urgent/stop ⇒ steer + scope 定向
 *
 * 运行：`node test/test-poller.mjs`（同包测试，依赖 ../lib/index.js）
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../lib/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-poller-test-'));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}
const norm = (p) => String(p).replace(/\\/g, '/');

function makeWs(dir) {
  mkdirSync(path.join(dir, 'tasks'), { recursive: true });
  mkdirSync(path.join(dir, 'memory'), { recursive: true });
  return dir;
}
function writeCard(wsDir, id, { title, status = 'todo', owner = 'coder', priority = 'P1', deps = [], rework } = {}) {
  const text = `---\nid: ${id}\ntitle: ${title || id}\nstatus: ${status}\nowner: ${owner}\npriority: ${priority}\ncreated: 2026-09-15\nupdated: 2026-09-15\ndeps: [${deps.join(', ')}]${rework ? `\nrework: ${rework}` : ''}\n---\n## 目标\n${title || id}\n\n## 产出物\n- [ ]\n\n## 进度记录\n\n## 批注\n`;
  writeFileSync(path.join(wsDir, 'tasks', `${id}.md`), text);
}
function cardStatus(wsDir, id) {
  try {
    const t = readFileSync(path.join(wsDir, 'tasks', `${id}.md`), 'utf8');
    const m = t.match(/^status: (.*)$/m);
    return m ? m[1].trim() : null;
  } catch { return null; }
}
function readPoller(local, role) {
  try { return JSON.parse(readFileSync(path.join(local, role, 'poller.json'), 'utf8')); } catch { return null; }
}
async function waitPort(port, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/state`); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
async function startInstance(opts) {
  const { ws, localDir, port, role = 'coder', wipLimit, sessions = [] } = opts;
  const disposers = [];
  const injected = [];     // { sessionId, mode, via, text }
  const created = [];      // { id, req }
  const renamed = [];      // { sessionId, title }
  const prompted = [];     // raw requests
  const sessionList = sessions.map((s) => ({ ...s }));
  const agentMap = new Map();
  const addAgent = (id) => agentMap.set(id, {
    followup: (msg) => { if (opts.failAll) throw new Error('boom'); injected.push({ sessionId: id, mode: 'queue', via: 'followup', text: msg.content[0].text }); },
    steer: (msg) => { if (opts.failAll) throw new Error('boom'); injected.push({ sessionId: id, mode: 'steer', via: 'steer', text: msg.content[0].text }); },
  });
  for (const s of sessionList) addAgent(s.id);
  if (opts.tweakAgents) opts.tweakAgents(agentMap, injected);
  let seq = 0;
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    sessions: { list: () => sessionList },
    agents: { get: (id) => agentMap.get(id) || null },
    tokenMeter: { measure: () => ({ totalTokens: 1234, surfaceTokens: 1234, nodes: [] }) },
    on: (ev, fn) => { if (ev === 'dispose') disposers.push(fn); },
  };
  if (!opts.noController) {
    ctx.sessionController = {
      create: async (req) => {
        const id = `sess-new-${port}-${++seq}`;
        sessionList.push({ id, updatedAt: Date.now() });
        created.push({ id, req });
        if (!opts.controllerNoAgent) addAgent(id);
        return { sessionId: id };
      },
      rename: async (r) => { renamed.push({ sessionId: r.sessionId, title: r.title }); return { title: r.title, seq: 1 }; },
      prompt: async (r) => {
        prompted.push(r);
        if (opts.failAll) throw new Error('boom');
        injected.push({ sessionId: r.sessionId, mode: r.mode, via: 'prompt', text: r.content[0].text });
        return { accepted: true };
      },
    };
  }
  const cfg = { workspaceDir: ws, localDir, role, port, autoSync: false };
  if (wipLimit !== undefined) cfg.wipLimit = wipLimit;
  apply(ctx, cfg);
  if (!(await waitPort(port))) throw new Error('instance not up on port ' + port);
  return {
    port, injected, created, renamed, prompted, sessionList,
    async post(p, body) {
      const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      return r.json();
    },
    async get(p) { const r = await fetch(`http://127.0.0.1:${port}${p}`); return r.json(); },
    dispose() { for (const d of disposers) { try { d(); } catch {} } },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- C1 + C2：接取写盘 / 新会话 / 文案 ----------
console.log('\n[C1/C2] 接取写盘 + 新会话 + 注入文案');
{
  const ws = makeWs(path.join(ROOT, 'c1ws'));
  const local = path.join(ROOT, 'c1local');
  writeCard(ws, 'T-001', { title: '样例任务一' });
  const inst = await startInstance({ ws, localDir: local, port: 3291, sessions: [{ id: 's-legacy', updatedAt: Date.now() }] });
  const r = await inst.post('/api/poller/now');
  check('C1 卡 todo→doing 已写盘', cardStatus(ws, 'T-001') === 'doing', cardStatus(ws, 'T-001'));
  check('C1 tick.claimed 含 T-001', !!(r.tick && r.tick.claimed && r.tick.claimed.includes('T-001')));
  check('C1 已创建新会话', inst.created.length === 1, JSON.stringify(inst.created.map((c) => c.id)));
  check('C1 会话 cwd=工作区', inst.created[0] && norm(inst.created[0].req.cwd) === norm(ws), inst.created[0] && inst.created[0].req.cwd);
  check('C1 会话标题=T-xxx 标题', inst.renamed.length === 1 && inst.renamed[0].title === 'T-001 样例任务一', inst.renamed[0] && inst.renamed[0].title);
  const newSid = inst.created[0] && inst.created[0].id;
  check('C1 注入到新会话', inst.injected.length === 1 && inst.injected[0].sessionId === newSid, JSON.stringify(inst.injected.map((i) => i.sessionId)));
  const pj = readPoller(local, 'coder');
  check('C1 claims 记 card→session', !!(pj && pj.claims && pj.claims.some((c) => c.id === 'T-001' && c.sessionId === newSid)));
  check('C1 sessions 映射落盘', !!(pj && pj.sessions && pj.sessions['T-001'] === newSid), JSON.stringify(pj && pj.sessions));
  const msg = inst.injected.length ? inst.injected[0].text : '';
  check('C2 文案含"已**自动接取**"+卡号', msg.includes('已**自动接取**') && msg.includes('T-001'), msg.slice(0, 50));
  inst.dispose();
}

// ---------- C3：deps / owner 不接（且不建会话） ----------
console.log('\n[C3] deps 未完成 / owner 不符不接');
{
  const ws = makeWs(path.join(ROOT, 'c3ws'));
  const local = path.join(ROOT, 'c3local');
  writeCard(ws, 'T-001', { title: '前置', status: 'doing' });
  writeCard(ws, 'T-002', { title: '依赖未完成', deps: ['T-001'] });
  writeCard(ws, 'T-003', { title: '别人的卡', owner: 'writer' });
  const inst = await startInstance({ ws, localDir: local, port: 3292, sessions: [{ id: 's1', updatedAt: Date.now() }] });
  const r = await inst.post('/api/poller/now');
  check('C3 依赖未完成/owner 不符均未动', cardStatus(ws, 'T-002') === 'todo' && cardStatus(ws, 'T-003') === 'todo');
  check('C3 ready 列表不含二者', !!(r.tick && !r.tick.ready.includes('T-002') && !r.tick.ready.includes('T-003')));
  check('C3 未为它们建会话', inst.created.length === 0);
  inst.dispose();
}

// ---------- C4：注入失败回滚（双通道都失败） ----------
console.log('\n[C4] 注入失败 ⇒ 回滚为 todo');
{
  const ws = makeWs(path.join(ROOT, 'c4ws'));
  const local = path.join(ROOT, 'c4local');
  writeCard(ws, 'T-004', { title: '回滚测试' });
  const inst = await startInstance({ ws, localDir: local, port: 3293, sessions: [{ id: 's1', updatedAt: Date.now() }], failAll: true });
  const r = await inst.post('/api/poller/now');
  check('C4 卡已回滚为 todo', cardStatus(ws, 'T-004') === 'todo', cardStatus(ws, 'T-004'));
  check('C4 tick.note 含"已回滚"', !!(r.tick && /已回滚/.test(r.tick.note)), r.tick && r.tick.note);
  const pj = readPoller(local, 'coder');
  check('C4 claims 无残留', !(pj && pj.claims && pj.claims.some((c) => c.id === 'T-004')));
  inst.dispose();
}

// ---------- C5：autoClaim 关 ----------
console.log('\n[C5] autoClaim=关 ⇒ 只提醒不翻牌（提醒投到新会话）');
{
  const ws = makeWs(path.join(ROOT, 'c5ws'));
  const local = path.join(ROOT, 'c5local');
  writeCard(ws, 'T-005', { title: '提醒模式' });
  const inst = await startInstance({ ws, localDir: local, port: 3294, sessions: [{ id: 's1', updatedAt: Date.now() }] });
  await inst.post('/api/poller', { autoClaim: false });
  await inst.post('/api/poller/now');
  check('C5 卡仍 todo（未翻牌）', cardStatus(ws, 'T-005') === 'todo');
  check('C5 提醒投到新会话', inst.created.length === 1 && inst.injected.length === 1);
  const msg = inst.injected.length ? inst.injected[0].text : '';
  check('C5 文案为"检测到就绪任务"', msg.includes('检测到就绪任务') && msg.includes('T-005'), msg.slice(0, 40));
  inst.dispose();
}

// ---------- C6：回退路径（无 sessionController） ----------
console.log('\n[C6] 回退：无 sessionController ⇒ 最近活跃 + 钉死');
{
  const ws = makeWs(path.join(ROOT, 'c6ws'));
  const local = path.join(ROOT, 'c6local');
  writeCard(ws, 'T-006', { title: '回退一' });
  const inst = await startInstance({ ws, localDir: local, port: 3295, noController: true, sessions: [
    { id: 's-old', updatedAt: 1000 }, { id: 's-new', updatedAt: 9999999999 },
  ] });
  await inst.post('/api/poller/now');
  check('C6 注入到最近活跃会话 s-new', inst.injected.length === 1 && inst.injected[0].sessionId === 's-new', JSON.stringify(inst.injected.map((i) => i.sessionId)));
  writeCard(ws, 'T-007', { title: '回退二' });
  await inst.post('/api/poller', { targetSessionId: 's-old' });
  await inst.post('/api/poller/now');
  const second = inst.injected[inst.injected.length - 1];
  check('C6 targetSessionId 钉死 s-old', second && second.sessionId === 's-old', JSON.stringify(second && second.sessionId));
  inst.dispose();
}

// ---------- C7：迁移 + 新字段 ----------
console.log('\n[C7] 旧版状态迁移 / 新字段持久化');
{
  const ws = makeWs(path.join(ROOT, 'c7ws'));
  const local = path.join(ROOT, 'c7local');
  mkdirSync(local, { recursive: true });
  writeFileSync(path.join(local, 'poller.json'), JSON.stringify({ enabled: false, intervalSec: 45, lastRun: null }));
  writeCard(ws, 'T-008', { title: '迁移后任务' });
  const inst = await startInstance({ ws, localDir: local, port: 3296, sessions: [{ id: 's1', updatedAt: Date.now() }] });
  const pj = readPoller(local, 'coder');
  check('C7 新位置已生成 + intervalSec=45 迁移', !!(pj && pj.intervalSec === 45));
  await inst.post('/api/poller/now');
  const pj2 = readPoller(local, 'coder');
  check('C8 claims/history/sessions/reworkNotified 落盘', !!(pj2 && Array.isArray(pj2.claims) && Array.isArray(pj2.history) && pj2.sessions && pj2.reworkNotified), 'claims=' + (pj2 && pj2.claims.length));
  inst.dispose();
}

// ---------- C8：单例锁 ----------
console.log('\n[C8] 单例锁：双实例');
{
  const ws = makeWs(path.join(ROOT, 'c8ws'));
  const local = path.join(ROOT, 'c8local');
  writeCard(ws, 'T-009', { title: '锁测试' });
  const A = await startInstance({ ws, localDir: local, port: 3297, sessions: [{ id: 'sA', updatedAt: Date.now() }] });
  const B = await startInstance({ ws, localDir: local, port: 3298, sessions: [{ id: 'sB', updatedAt: Date.now() }] });
  const stB = await B.get('/api/state');
  check('C8 A 持锁', (await A.get('/api/state')).poller.lock.ok === true);
  check('C8 B 被封锁 + 上报', stB.poller.lock && stB.poller.lock.ok === false && /另一个实例/.test(stB.poller.lock.note));
  const rB = await B.post('/api/poller/now');
  check('C8 B tick 被拒且未建会话', rB.tick && /locked/.test(String(rB.tick.skipped || '')) && B.created.length === 0);
  A.dispose();
  await sleep(150);
  await B.post('/api/poller/now');
  check('C8 A 退出后 B 接管并接取', cardStatus(ws, 'T-009') === 'doing', cardStatus(ws, 'T-009'));
  B.dispose();
}

// ---------- C9：回退路径排除 ----------
console.log('\n[C9] 回退路径：排除已处理该卡的会话');
{
  const ws = makeWs(path.join(ROOT, 'c9ws'));
  const local = path.join(ROOT, 'c9local');
  mkdirSync(path.join(local, 'coder'), { recursive: true });
  writeFileSync(path.join(local, 'coder', 'poller.json'), JSON.stringify({
    enabled: false, intervalSec: 120, autoClaim: true, claimStaleMin: 0, targetSessionId: '',
    claims: [{ id: 'T-010', by: 'poller', sessionId: 's-new', at: '2026-09-14T00:00:00Z' }], history: [], notified: [], sessions: {}, reworkNotified: {},
  }));
  writeCard(ws, 'T-010', { title: '排除测试' });
  const inst = await startInstance({ ws, localDir: local, port: 3299, noController: true, sessions: [
    { id: 's-old', updatedAt: 1000 }, { id: 's-new', updatedAt: 9999999999 },
  ] });
  await inst.post('/api/poller/now');
  check('C9 改投未被排除的 s-old', inst.injected.length === 1 && inst.injected[0].sessionId === 's-old', JSON.stringify(inst.injected.map((i) => i.sessionId)));
  inst.dispose();
}

// ---------- C10：WIP 可配 ----------
console.log('\n[C10] WIP：wipLimit=1 拦截 / wipLimit=0 不限制');
{
  const ws = makeWs(path.join(ROOT, 'c10ws'));
  writeCard(ws, 'T-011', { title: '进行中', status: 'doing' });
  writeCard(ws, 'T-012', { title: '受限新卡' });
  const instA = await startInstance({ ws, localDir: path.join(ROOT, 'c10local-a'), port: 3301, wipLimit: 1, sessions: [{ id: 's1', updatedAt: Date.now() }] });
  const r = await instA.post('/api/poller/now');
  check('C10 wipLimit=1：新卡被拦且未建会话', cardStatus(ws, 'T-012') === 'todo' && instA.created.length === 0, JSON.stringify(r.tick && r.tick.blocked));
  instA.dispose();
  const instB = await startInstance({ ws, localDir: path.join(ROOT, 'c10local-b'), port: 3302, wipLimit: 0, sessions: [{ id: 's1', updatedAt: Date.now() }] });
  await instB.post('/api/poller/now');
  check('C10 wipLimit=0：不受限（新卡已接）', cardStatus(ws, 'T-012') === 'doing');
  instB.dispose();
}

// ---------- C11：优先级顺序 ----------
console.log('\n[C11] 接取顺序：P0 先于 P2');
{
  const ws = makeWs(path.join(ROOT, 'c11ws'));
  writeCard(ws, 'T-013', { title: '低优先', priority: 'P2' });
  writeCard(ws, 'T-014', { title: '高优先', priority: 'P0' });
  const inst = await startInstance({ ws, localDir: path.join(ROOT, 'c11local'), port: 3303, sessions: [{ id: 's1', updatedAt: Date.now() }] });
  await inst.post('/api/poller/now');
  check('C11 首建会话为 P0 卡 T-014', inst.renamed.length >= 1 && inst.renamed[0].title.includes('T-014'), JSON.stringify(inst.renamed.map((r) => r.title)));
  inst.dispose();
}

// ---------- C12：打回续做（原会话） ----------
console.log('\n[C12] 打回续做：注入原会话 + 轮次去重');
{
  const ws = makeWs(path.join(ROOT, 'c12ws'));
  const local = path.join(ROOT, 'c12local');
  mkdirSync(path.join(local, 'coder'), { recursive: true });
  writeFileSync(path.join(local, 'coder', 'poller.json'), JSON.stringify({
    enabled: false, intervalSec: 120, autoClaim: true, claimStaleMin: 0, targetSessionId: '',
    claims: [{ id: 'T-012', by: 'poller', sessionId: 's-orig', at: '2026-09-14T00:00:00Z' }], history: [], notified: [],
    sessions: { 'T-012': 's-orig' }, reworkNotified: {},
  }));
  writeCard(ws, 'T-012', { title: '被打回的任务', rework: 2 });
  const inst = await startInstance({ ws, localDir: local, port: 3304, sessions: [{ id: 's-orig', updatedAt: 1000 }, { id: 's-other', updatedAt: 9999999999 }] });
  const r = await inst.post('/api/poller/now');
  check('C12 注入原会话 s-orig（未新建）', inst.injected.length === 1 && inst.injected[0].sessionId === 's-orig' && inst.created.length === 0, JSON.stringify(inst.injected.map((i) => i.sessionId)));
  check('C12 文案为续做（"被打回"）', /被打回/.test(inst.injected[0].text) && inst.injected[0].text.includes('T-012'), inst.injected[0].text.slice(0, 50));
  check('C12 卡已 autoClaim 为 doing', cardStatus(ws, 'T-012') === 'doing');
  check('C12 tick.rework 含卡号', !!(r.tick && r.tick.rework && r.tick.rework.includes('T-012')));
  const pj = readPoller(local, 'coder');
  check('C12 reworkNotified=2 落盘', !!(pj && pj.reworkNotified && pj.reworkNotified['T-012'] === 2), JSON.stringify(pj && pj.reworkNotified));
  // 再次 tick：卡已 doing，不应重复注入（无新注入）
  const before = inst.injected.length;
  await inst.post('/api/poller/now');
  check('C12 不重复注入', inst.injected.length === before);
  inst.dispose();
}

// ---------- C13：打回无映射 ⇒ 新建兜底 ----------
console.log('\n[C13] 打回无映射 ⇒ 新建会话兜底');
{
  const ws = makeWs(path.join(ROOT, 'c13ws'));
  writeCard(ws, 'T-020', { title: '打回兜底', rework: 1 });
  const inst = await startInstance({ ws, localDir: path.join(ROOT, 'c13local'), port: 3305, sessions: [{ id: 's1', updatedAt: Date.now() }] });
  await inst.post('/api/poller/now');
  check('C13 已新建会话并注入', inst.created.length === 1 && inst.injected.length === 1 && inst.injected[0].sessionId === inst.created[0].id);
  check('C13 文案为续做', /被打回/.test(inst.injected[0].text));
  inst.dispose();
}

// ---------- C14：prompt 兜底通道 ----------
console.log('\n[C14] 新会话 agent 不可用 ⇒ sessionController.prompt');
{
  const ws = makeWs(path.join(ROOT, 'c14ws'));
  writeCard(ws, 'T-021', { title: 'prompt 兜底' });
  const inst = await startInstance({ ws, localDir: path.join(ROOT, 'c14local'), port: 3306, controllerNoAgent: true, sessions: [] });
  await inst.post('/api/poller/now');
  check('C14 prompt 被调用', inst.prompted.length === 1 && inst.prompted[0].mode === 'queue', JSON.stringify(inst.prompted.map((p) => p.mode)));
  check('C14 注入内容经 prompt 通道', inst.injected.length === 1 && inst.injected[0].via === 'prompt');
  inst.dispose();
}

// ---------- C15：notices 消费 ----------
console.log('\n[C15] notices：normal ⇒ queue / urgent+stop ⇒ steer + scope 定向 + delivered 回写');
{
  const ws = makeWs(path.join(ROOT, 'c15ws'));
  const local = path.join(ROOT, 'c15local');
  mkdirSync(path.join(local, 'coder'), { recursive: true });
  writeFileSync(path.join(local, 'coder', 'poller.json'), JSON.stringify({
    enabled: false, intervalSec: 120, autoClaim: true, claimStaleMin: 0, targetSessionId: '',
    claims: [], history: [], notified: [], sessions: { 'T-030': 's-orig' }, reworkNotified: {},
  }));
  const nDir = path.join(ws, 'notices');
  mkdirSync(nDir, { recursive: true });
  writeFileSync(path.join(nDir, 'N-20260915-0001-aa.md'), '---\nid: N-20260915-0001-aa\nfrom: modeler\nto: coder\nkind: info\nurgency: normal\nscope: \nstatus: pending\nat: 2026-09-15T00:00:00Z\n---\n## 正文\n普通通知正文\n');
  writeFileSync(path.join(nDir, 'N-20260915-0002-bb.md'), '---\nid: N-20260915-0002-bb\nfrom: modeler\nto: coder\nkind: stop\nurgency: urgent\nscope: T-030\nstatus: pending\nat: 2026-09-15T00:00:01Z\n---\n## 正文\n停止该方向\n');
  const inst = await startInstance({ ws, localDir: local, port: 3307, sessions: [{ id: 's-live', updatedAt: 9999999999 }, { id: 's-orig', updatedAt: 1000 }] });
  const r = await inst.post('/api/poller/now');
  const normalInj = inst.injected.find((i) => i.text.includes('N-20260915-0001-aa'));
  const urgentInj = inst.injected.find((i) => i.text.includes('N-20260915-0002-bb'));
  check('C15 normal 消息已注入（queue）', !!(normalInj && normalInj.mode === 'queue'), normalInj && normalInj.sessionId);
  check('C15 urgent/stop steer 到 scope 指向的原会话 s-orig', !!(urgentInj && urgentInj.mode === 'steer' && urgentInj.sessionId === 's-orig'), JSON.stringify(urgentInj));
  const f1 = readFileSync(path.join(nDir, 'N-20260915-0001-aa.md'), 'utf8');
  const f2 = readFileSync(path.join(nDir, 'N-20260915-0002-bb.md'), 'utf8');
  check('C15 delivered 回写（两条）', /^status: delivered$/m.test(f1) && /^status: delivered$/m.test(f2) && /deliveredAt/m.test(f1));
  check('C15 tick.notices 记录两条', !!(r.tick && r.tick.notices && r.tick.notices.length === 2), JSON.stringify(r.tick && r.tick.notices));
  inst.dispose();
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await sleep(200);
try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
process.exit(fail === 0 ? 0 : 1);
