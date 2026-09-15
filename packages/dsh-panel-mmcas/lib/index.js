/**
 * @mmcas/dsh-panel —— host 侧 v2
 * 回环 HTTP 数据/操作端点（127.0.0.1:3210，仅本机）:
 *   GET  /api/state   面板状态（任务卡/设备/记忆/git）
 *   GET  /api/tasks   任务卡列表
 *   POST /api/tasks   新建任务 {title, owner, desc}
 *   PUT  /api/tasks   更新 {id, status?, title?, desc?}（三状态机校验）
 *   DELETE /api/tasks 删除 {id}
 *   POST /api/exec    Slave 远程执行 {role, cmd}（ssh，仅 Master）
 */
import { createServer } from 'node:http';
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

export const name = 'mmcas-dsh-panel';
export const inject = ['clientModules', 'sessions', 'agents'];

const VALID_STATUS = ['todo', 'doing', 'done'];
const VALID_ROLES = ['modeler', 'coder', 'writer'];
const TRANSITIONS = { todo: ['doing'], doing: ['done', 'todo'], done: ['doing'] };

export function apply(ctx, config = {}) {
  const ws = (config.workspaceDir || process.env.MMCAS_WORKSPACE || '').replace(/\\/g, '/');
  const role = config.role || 'modeler'; // modeler=Master 全功能；coder/writer=Slave 仅看板+记忆
  const local = path.join(os.homedir(), 'AppData', 'Local', 'mmcas');

  // ---------- 数据采集 ----------
  function parseCard(file) {
    try {
      const text = readFileSync(file, 'utf8');
      const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!m) return null;
      const fm = {};
      for (const line of m[1].split('\n')) {
        const kv = line.split(':');
        if (kv.length >= 2) fm[kv[0].trim()] = kv.slice(1).join(':').trim();
      }
      const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
      return { ...fm, id: fm.id || path.basename(file, '.md'), body };
    } catch { return null; }
  }
  function loadCards() {
    const dir = path.join(ws, 'tasks');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md')
      .map((f) => parseCard(path.join(dir, f))).filter(Boolean);
  }
  function gitInfo() {
    const r = spawnSync('git', ['-C', ws, 'log', '--pretty=format:%h|%an|%s', '-n', '8'], { encoding: 'utf8', windowsHide: true });
    const log = r.status === 0 ? r.stdout.trim().split('\n').filter(Boolean) : [];
    const b = spawnSync('git', ['-C', ws, 'status', '-sb', '--porcelain'], { encoding: 'utf8', windowsHide: true });
    const beh = spawnSync('git', ['-C', ws, 'rev-list', '--left-right', '--count', 'origin/main...HEAD'], { encoding: 'utf8', windowsHide: true });
    let ahead = 0, behind = 0;
    if (beh.status === 0) { const [bh, ah] = beh.stdout.trim().split(/\s+/).map(Number); behind = bh || 0; ahead = ah || 0; }
    return { log, branch: b.status === 0 ? (b.stdout.split('\n')[0] || '') : '', ahead, behind };
  }
  function devices() {
    const r = spawnSync('C:/Program Files/Tailscale/tailscale.exe', ['status', '--json'], { encoding: 'utf8', windowsHide: true });
    const out = { modeler: { name: '建模手 · 本机', online: true } };
    if (r.status !== 0) return out;
    try {
      const j = JSON.parse(r.stdout);
      out.modeler.ip = j.Self?.TailscaleIPs?.[0] || '';
      for (const peer of Object.values(j.Peer || {})) {
        const n = (peer.HostName || '').toLowerCase();
        if (n.startsWith('mmcas-')) out[n.replace('mmcas-', '')] = { name: n.replace('mmcas-', ''), online: peer.Online, ip: peer.TailscaleIPs?.[0] || '' };
      }
    } catch {}
    // 合并 devices.json 的用户名
    try {
      const dj = JSON.parse(readFileSync(path.join(local, 'devices.json'), 'utf8'));
      for (const role of ['coder', 'writer']) if (dj[role]) out[role] = { ...(out[role] || {}), ...dj[role] };
    } catch {}
    return out;
  }
  function memoryEntries() {
    const root = path.join(ws, 'memory');
    const out = [];
    if (!existsSync(root)) return out;
    for (const role of ['modeler', 'coder', 'writer']) {
      const dir = path.join(root, role);
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort().reverse();
      for (const f of files.slice(0, 2)) {
        const text = readFileSync(path.join(dir, f), 'utf8');
        for (const e of text.split(/\n## /).slice(1)) {
          const [stamp, ...body] = e.split('\n');
          out.push({ role, date: f.replace('.md', ''), time: stamp.trim(), body: body.join(' ').trim().slice(0, 160) });
        }
      }
    }
    return out.slice(-14).reverse();
  }
  function collectState() {
    return { role, cards: loadCards(), git: gitInfo(), devices: devices(), memory: memoryEntries(), poller: { enabled: poller.enabled, lastRun: poller.lastRun, lastFound: poller.lastFound }, ts: new Date().toISOString() };
  }

  // ---------- 任务 CRUD ----------
  function tasksDir() { return path.join(ws, 'tasks'); }
  function cardFile(id) { return path.join(tasksDir(), `${id}.md`); }
  function parseDepsOf(card) {
    return (card.deps || '').replace(/[\[\]']/g, '').split(',').map((s) => s.trim()).filter((x) => x);
  }
  const WIP_LIMIT = 2;
  const VALID_PRIORITY = ['P0', 'P1', 'P2'];
  function checkTransition(card, to) {
    if (!VALID_STATUS.includes(to)) return { ok: false, reason: `目标状态非法: ${to}` };
    const allowed = TRANSITIONS[card.status] || [];
    if (!allowed.includes(to)) return { ok: false, reason: `非法迁移: ${card.status} -> ${to}` };
    if (to === 'doing' && card.status === 'todo') {
      const all = loadCards();
      const pending = parseDepsOf(card).filter((d) => {
        const dep = all.find((c) => c.id === d);
        return !dep || dep.status !== 'done';
      });
      if (pending.length) return { ok: false, reason: `依赖未完成，等待: ${pending.join(', ')}` };
      const doingCount = all.filter((c) => c.status === 'doing' && c.owner === card.owner).length;
      if (doingCount >= WIP_LIMIT) return { ok: false, reason: `WIP 超限：${card.owner} 已有 ${doingCount} 个进行中任务（上限 ${WIP_LIMIT}）` };
    }
    return { ok: true, reason: '' };
  }

  // ---------- 任务轮询器（模拟 AI 主动性：外部时钟触发 agent 接取） ----------
  const pollerStateFile = path.join(local, 'poller.json');
  let poller = { enabled: false, intervalSec: 120, lastRun: null, lastFound: [] };
  try { poller = { ...poller, ...JSON.parse(readFileSync(pollerStateFile, 'utf8')) }; } catch {}
  const notified = new Set(); // 已注入通知的任务（防重复；任务被接取后清除）

  function savePoller() { try { mkdirSync(path.dirname(pollerStateFile), { recursive: true }); writeFileSync(pollerStateFile, JSON.stringify(poller, null, 2)); } catch {} }

  function pollerScan() {
    const cards = loadCards();
    const doingCount = cards.filter((c) => c.status === 'doing' && c.owner === role).length;
    if (doingCount >= WIP_LIMIT) return [];
    const ready = cards.filter((c) => {
      if (c.status !== 'todo' || c.owner !== role) return false;
      const pending = parseDepsOf(c).filter((d) => {
        const dep = cards.find((x) => x.id === d);
        return !dep || dep.status !== 'done';
      });
      return pending.length === 0 && !notified.has(c.id);
    });
    // 接取顺序：priority 升序（P0→P1→P2），同优先级被他人 deps 引用的卡优先（关键路径优先）
    const refCount = (c) => cards.filter((x) => parseDepsOf(x).includes(c.id)).length;
    const pRank = (c) => (c.priority === 'P0' ? 0 : c.priority === 'P2' ? 2 : 1);
    ready.sort((a, b) => pRank(a) - pRank(b) || refCount(b) - refCount(a));
    return ready;
  }

  function findActiveAgent() {
    try {
      const list = ctx && ctx.sessions && typeof ctx.sessions.list === 'function' ? ctx.sessions.list() : [];
      for (const s of list) {
        const agent = ctx.agents && typeof ctx.agents.get === 'function' ? ctx.agents.get(s.id) : null;
        if (agent) return agent;
      }
    } catch {}
    return null;
  }

  function injectTaskPrompt(card) {
    const agent = findActiveAgent();
    if (!agent) return false;
    const msg = '任务轮询器：检测到就绪任务 ' + card.id + '「' + (card.title || '') + '」（priority ' + (card.priority || 'P1') + '，owner=你）。请按接取规则执行：读取任务卡，认领（todo→doing），开始工作。';
    try {
      agent.followup({
        id: randomUUID(), // 必须带稳定 id，否则会话持久化校验失败（seq lacks an identified message）
        role: 'user',
        content: [{ type: 'text', text: msg }],
        source: { kind: 'user', rpcId: 'mmcas-poller-' + Date.now() }
      });
      return true;
    } catch (e) {
      try { if (ctx.logger) ctx.logger.warn('[mmcas-poller] 注入失败:', String(e)); } catch {}
      return false;
    }
  }

  let pollerTimer = null;
  function tickPoller() {
    if (!poller.enabled) return;
    const ready = pollerScan();
    poller.lastRun = new Date().toISOString();
    poller.lastFound = ready.map((c) => c.id);
    for (const card of ready) {
      const ok = injectTaskPrompt(card);
      if (ok) notified.add(card.id); // 注入成功才记录，防止无活动会话时丢失通知
    }
    // 通知记录清理：卡被删除、或状态离开 todo（已接取/完成）→ 清除；退回 todo 后可重新通知
    const byId = new Map(loadCards().map((c) => [c.id, c]));
    for (const id of [...notified]) {
      const c = byId.get(id);
      if (!c || c.status !== 'todo') notified.delete(id);
    }
    savePoller();
  }

  function applyPollerState() {
    if (pollerTimer) clearInterval(pollerTimer);
    pollerTimer = null;
    if (poller.enabled) {
      tickPoller();
      pollerTimer = setInterval(tickPoller, (poller.intervalSec || 120) * 1000);
    }
  }
  applyPollerState();
  function execOnSlave(role_, cmd, timeoutSec) {
    if (role !== 'modeler') return { ok: false, error: 'exec 仅 Master（modeler）可用' };
    if (!['coder', 'writer'].includes(role_)) return { ok: false, error: '目标角色必须为 coder 或 writer' };
    const devs = devices();
    const d = devs[role_];
    if (!d || !d.ip) return { ok: false, error: `设备 ${role} 未上线` };
    if (!d.user) return { ok: false, error: `设备 ${role} 缺少用户名（%LOCALAPPDATA%\\mmcas\\devices.json 的 user 字段）` };
    const key = path.join(local, 'master-key', 'mmcas-master');
    if (!existsSync(key)) return { ok: false, error: '缺少 Master SSH 私钥' };
    const secs = Math.min(Math.max(timeoutSec || 30, 5), 300);
    const r = spawnSync('ssh', [
      '-i', key, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes',
      `${d.user}@${d.ip}`, cmd,
    ], { encoding: 'utf8', timeout: secs * 1000, windowsHide: true });
    return {
      ok: r.status === 0,
      code: r.status ?? null,
      stdout: (r.stdout || '').slice(0, 20000),
      stderr: (r.stderr || '').slice(0, 4000),
      error: r.error ? String(r.error) : null,
    };
  }

  // ---------- 环境同步（方案 B：lockfile + 三方同意 + P2P wheelhouse） ----------
  const SYNC_DIR = () => path.join(ws, 'sync');
  function syncFiles() {
    const d = SYNC_DIR();
    if (!existsSync(d)) return { requests: [], responses: [], transfer: null, done: [] };
    const requests = readdirSync(d).filter((f) => f.startsWith('request-') && f.endsWith('.json')).map((f) => {
      try { return JSON.parse(readFileSync(path.join(d, f), 'utf8')); } catch { return null; }
    }).filter(Boolean);
    const responses = readdirSync(d).filter((f) => f.startsWith('response-') && f.endsWith('.json')).map((f) => {
      try { return JSON.parse(readFileSync(path.join(d, f), 'utf8')); } catch { return null; }
    }).filter(Boolean);
    let transfer = null;
    for (const f of readdirSync(d).filter((f) => f.startsWith('transfer-') && f.endsWith('.json'))) {
      try { transfer = JSON.parse(readFileSync(path.join(d, f), 'utf8')); } catch {}
    }
    const done = readdirSync(d).filter((f) => f.startsWith('done-') && f.endsWith('.json')).map((f) => f.replace(/^done-|\.json$/g, ''));
    return { requests, responses, transfer, done };
  }
  function ownTsIp() {
    try {
      const r = spawnSync('C:/Program Files/Tailscale/tailscale.exe', ['ip', '-4'], { encoding: 'utf8', windowsHide: true });
      const ip = (r.stdout || '').trim();
      if (/^100\./.test(ip)) return ip;
    } catch {}
    return '';
  }
  function newSyncId() { return 'S-' + Date.now().toString(36); }

  let wheelServer = null; // 发起端 P2P wheelhouse 静态服务
  const wheelTokens = new Set();

  function serveWheelhouse(dir) {
    // 返回 Promise<token>：端口被占/监听失败时 reject（原实现静默"成功"，远端拉取必败且难诊断）
    if (wheelServer) { try { wheelServer.close(); } catch {} wheelServer = null; }
    const token = randomUUID().replace(/-/g, '');
    wheelTokens.add(token);
    const srv = createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      if (!p.startsWith('/' + token)) { res.writeHead(403); res.end('forbidden'); return; }
      const rel = decodeURIComponent(p.slice(('/' + token).length)) || '/';
      const target = path.join(dir, rel);
      if (!target.startsWith(path.resolve(dir))) { res.writeHead(403); res.end(); return; }
      try {
        const buf = readFileSync(target);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length });
        res.end(buf);
      } catch { res.writeHead(404); res.end('not found'); }
    });
    wheelServer = srv;
    return new Promise((resolve, reject) => {
      srv.once('error', (e) => { wheelServer = null; wheelTokens.delete(token); reject(e); });
      srv.listen(3213, '0.0.0.0', () => resolve(token));
    });
  }

  // 清理过期 wheelhouse 目录（保留当前使用的一个 + 24h 内的；几百 MB 不能无限堆积）
  function cleanupWheelhouses(keepDir) {
    const syncDir = path.join(ws, 'sync');
    if (!existsSync(syncDir)) return;
    let entries = [];
    try { entries = readdirSync(syncDir).filter((f) => f.startsWith('wheelhouse-')); } catch { return; }
    const now = Date.now();
    for (const e of entries) {
      const full = path.join(syncDir, e);
      if (keepDir && path.resolve(full) === path.resolve(keepDir)) continue;
      try {
        const st = statSync(full);
        if (st.isDirectory() && now - st.mtimeMs > 24 * 3600 * 1000) rmSync(full, { recursive: true, force: true });
      } catch {}
    }
  }

  async function prepareWheelhouse(syncId) {
    const envDir = path.join(ws, 'environment');
    if (!existsSync(path.join(envDir, 'pyproject.toml'))) return { ok: false, error: '工作区缺少 environment/pyproject.toml（环境基线未初始化）' };
    const dir = path.join(ws, 'sync', 'wheelhouse-' + syncId);
    cleanupWheelhouses(dir);
    mkdirSync(dir, { recursive: true });
    // 1. uv export → requirements（精确版本+hash）
    const reqFile = path.join(dir, 'requirements.txt');
    const r1 = spawnSync('uv', ['export', '--format', 'requirements-txt', '-o', reqFile], { encoding: 'utf8', cwd: envDir, timeout: 120000, windowsHide: true });
    if (r1.status !== 0) return { ok: false, error: 'uv export 失败: ' + (r1.stderr || '').slice(0, 300) };
    // 2. uvx pip download → wheelhouse（发起端一次性从镜像源拉取，清华镜像加速；已有 wheel 则复用）
    const existingWheels = readdirSync(dir).filter((f) => f.endsWith('.whl')).length;
    if (existingWheels === 0) {
      const r2 = spawnSync('uvx', ['pip', 'download', '-r', reqFile, '-d', dir], { encoding: 'utf8', cwd: envDir, timeout: 1800000, windowsHide: true, env: { ...process.env, PIP_INDEX_URL: 'https://pypi.tuna.tsinghua.edu.cn/simple' } });
      if (r2.status !== 0) return { ok: false, error: 'pip download 失败: ' + (r2.stderr || '').slice(0, 300) };
    }
    // 3. 起 P2P 服务（监听失败 / 无 Tailscale IP 时明确报错，杜绝"假成功"）
    const ip = ownTsIp();
    if (!ip) return { ok: false, error: '无法获取本机 Tailscale IP（tailscale 未登录/未上线）——先确认 tailscale status 在线' };
    let token;
    try { token = await serveWheelhouse(dir); } catch (e) { return { ok: false, error: 'P2P 服务启动失败（3213 端口被占用？）: ' + String(e) }; }
    return { ok: true, token, ip, dir };
  }

  function pullEnvironment(transfer) {
    // 接收端：uv sync --find-links P2P --offline（uv 精确 diff，只装差异）
    const envDir = path.join(ws, 'environment');
    const url = 'http://' + transfer.ip + ':3213/' + transfer.token + '/';
    const r = spawnSync('uv', ['sync', '--find-links', url, '--offline'], { encoding: 'utf8', cwd: envDir, timeout: 1800000, windowsHide: true });
    return { ok: r.status === 0, out: (r.stdout || '').slice(-2000), err: (r.stderr || '').slice(0, 800) };
  }
  function json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  }
  function readBody(req) {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => { data += c; if (data.length > 65536) req.destroy(); });
      req.on('end', () => {
        // 编码损坏防御：U+FFFD 说明写入链路出现非 UTF-8 字节（如 GBK 转码事故），拒绝入库
        if (data.includes('\uFFFD')) { resolve({ __badEncoding: true }); return; }
        try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
      });
    });
  }

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (p === '/api/state' && req.method === 'GET') return json(res, 200, collectState());

    if (p === '/api/tasks' && req.method === 'GET') return json(res, 200, { cards: loadCards() });

    if (p === '/api/tasks' && req.method === 'POST') {
      // 发布纪律：仅 Master（modeler）可创建任务卡
      if (role !== 'modeler') return json(res, 403, { ok: false, error: '创建任务卡仅 Master（modeler）可用' });
      const b = await readBody(req);
      if (b.__badEncoding) return json(res, 400, { ok: false, error: '请求内容编码损坏（非 UTF-8），已拒绝' });
      const title = String(b.title || '').trim();
      const owner = String(b.owner || 'coder');
      const desc = String(b.desc || '').trim();
      const priority = String(b.priority || 'P1');
      const deps = Array.isArray(b.deps) ? b.deps.map(String) : [];
      if (!title) return json(res, 400, { ok: false, error: 'title 必填' });
      if (!VALID_ROLES.includes(owner)) return json(res, 400, { ok: false, error: `非法 owner: ${owner}` });
      if (!VALID_PRIORITY.includes(priority)) return json(res, 400, { ok: false, error: `非法 priority: ${priority}` });
      mkdirSync(tasksDir(), { recursive: true });
      const cards = loadCards();
      for (const d of deps) {
        if (!cards.some((c) => c.id === d)) return json(res, 400, { ok: false, error: `依赖不存在: ${d}` });
      }
      const nums = cards.map((c) => parseInt(c.id.replace(/\D/g, ''), 10) || 0);
      const id = `T-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
      const today = new Date().toISOString().slice(0, 10);
      const card = `---\nid: ${id}\ntitle: ${title}\nstatus: todo\nowner: ${owner}\npriority: ${priority}\ncreated: ${today}\nupdated: ${today}\ndeps: [${deps.join(', ')}]\n---\n## 目标\n${desc || title}\n\n## 产出物\n- [ ]\n\n## 进度记录\n\n## 批注\n`;
      writeFileSync(cardFile(id), card);
      return json(res, 200, { ok: true, id });
    }

    if (p === '/api/tasks' && req.method === 'PUT') {
      const b = await readBody(req);
      const all = loadCards();
      const card = all.find((c) => c.id === b.id);
      if (!card) return json(res, 404, { ok: false, error: `未找到任务卡: ${b.id}` });
      // 单写者纪律：仅 owner 角色或 Master 可改卡（端点拒绝，不只是 UI 隐藏）
      if (role !== 'modeler' && card.owner !== role) {
        return json(res, 403, { ok: false, error: `仅 ${card.owner} 或 Master 可修改 ${b.id}（本端角色 ${role}）` });
      }
      let text = readFileSync(cardFile(b.id), 'utf8');
      if (b.status && b.status !== card.status) {
        const r = checkTransition(card, b.status);
        if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
        text = text.replace(/^status: .*$/m, `status: ${b.status}`).replace(/^updated: .*$/m, `updated: ${new Date().toISOString().slice(0, 10)}`);
      }
      if (b.title !== undefined) text = text.replace(/^title: .*$/m, `title: ${String(b.title).trim()}`);
      if (b.owner !== undefined) {
        if (!VALID_ROLES.includes(b.owner)) return json(res, 400, { ok: false, error: `非法 owner: ${b.owner}` });
        text = text.replace(/^owner: .*$/m, `owner: ${b.owner}`);
      }
      if (b.desc !== undefined) {
        const d = String(b.desc).trim();
        text = text.replace(/^## 目标\n[\s\S]*?(?=\n## 产出物)/, `## 目标\n${d}`);
      }
      if (b.priority !== undefined) {
        if (!VALID_PRIORITY.includes(b.priority)) return json(res, 400, { ok: false, error: `非法 priority: ${b.priority}` });
        text = text.replace(/^priority: .*$/m, `priority: ${b.priority}`);
      }
      if (b.deps !== undefined) {
        const deps = Array.isArray(b.deps) ? b.deps.map(String) : [];
        for (const d of deps) {
          if (d === b.id) return json(res, 400, { ok: false, error: '依赖不能指向自己' });
          if (!all.some((c) => c.id === d)) return json(res, 400, { ok: false, error: `依赖不存在: ${d}` });
        }
        text = text.replace(/^deps: .*$/m, `deps: [${deps.join(', ')}]`);
      }
      writeFileSync(cardFile(b.id), text);
      return json(res, 200, { ok: true });
    }

    if (p === '/api/tasks' && req.method === 'DELETE') {
      const b = await readBody(req);
      const all = loadCards();
      const card = all.find((c) => c.id === b.id);
      if (!card) return json(res, 404, { ok: false, error: `未找到任务卡: ${b.id}` });
      if (role !== 'modeler' && card.owner !== role) {
        return json(res, 403, { ok: false, error: `仅 ${card.owner} 或 Master 可删除 ${b.id}（本端角色 ${role}）` });
      }
      // 被依赖防护：删除会让下游卡永久等待（DAG 死锁）
      const dependents = all.filter((c) => c.id !== b.id && parseDepsOf(c).includes(b.id));
      if (dependents.length && !b.force) {
        return json(res, 400, { ok: false, error: `${b.id} 被 ${dependents.map((c) => c.id).join(', ')} 依赖，删除会造成依赖死锁（确认后传 force:true）` });
      }
      unlinkSync(cardFile(b.id));
      return json(res, 200, { ok: true, deletedDependents: dependents.length });
    }

    if (p === '/api/exec' && req.method === 'POST') {
      const b = await readBody(req);
      return json(res, 200, execOnSlave(String(b.role || ''), String(b.cmd || ''), Number(b.timeoutSec || 30)));
    }

    // ---- 任务轮询器开关 ----
    if (p === '/api/poller' && req.method === 'GET') {
      return json(res, 200, { ...poller, notified: [...notified] });
    }
    if (p === '/api/poller' && req.method === 'POST') {
      const b = await readBody(req);
      if (typeof b.enabled === 'boolean') poller.enabled = b.enabled;
      if (b.intervalSec) poller.intervalSec = Math.min(Math.max(Number(b.intervalSec) || 120, 30), 600);
      savePoller();
      applyPollerState();
      return json(res, 200, { ok: true, enabled: poller.enabled, intervalSec: poller.intervalSec });
    }

    // ---- 环境同步 ----
    if (p === '/api/env-sync' && req.method === 'GET') {
      return json(res, 200, syncFiles());
    }
    if (p === '/api/env-sync/request' && req.method === 'POST') {
      mkdirSync(SYNC_DIR(), { recursive: true });
      const id = newSyncId();
      const reqObj = { id, from: role, ts: new Date().toISOString(), note: `请批准环境对齐（由 ${role} 发起）` };
      writeFileSync(path.join(SYNC_DIR(), `request-${id}.json`), JSON.stringify(reqObj, null, 2));
      return json(res, 200, { ok: true, id });
    }
    if (p === '/api/env-sync/respond' && req.method === 'POST') {
      const b = await readBody(req);
      mkdirSync(SYNC_DIR(), { recursive: true });
      const resp = { id: String(b.id || ''), from: role, agree: !!b.agree, ts: new Date().toISOString() };
      writeFileSync(path.join(SYNC_DIR(), `response-${resp.id}-${role}.json`), JSON.stringify(resp, null, 2));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/env-sync/prepare' && req.method === 'POST') {
      const b = await readBody(req);
      if (role !== 'modeler') return json(res, 403, { ok: false, error: '仅 Master 可执行准备' });
      const r = await prepareWheelhouse(String(b.id || ''));
      if (r.ok) {
        const tr = { id: String(b.id || ''), from: role, ip: r.ip, token: r.token, dir: r.dir, ts: new Date().toISOString() };
        writeFileSync(path.join(SYNC_DIR(), `transfer-${tr.id}.json`), JSON.stringify(tr, null, 2));
        return json(res, 200, { ok: true, transfer: tr });
      }
      return json(res, 500, r);
    }
    if (p === '/api/env-sync/pull' && req.method === 'POST') {
      const b = await readBody(req);
      const r = pullEnvironment(b.transfer || {});
      if (r.ok) {
        writeFileSync(path.join(SYNC_DIR(), `done-${(b.transfer || {}).id || 'x'}-${role}.json`), JSON.stringify({ ts: new Date().toISOString(), role }), 'utf8');
      }
      return json(res, 200, r);
    }

    res.writeHead(404);
    res.end('not found');
  });

  const dataPort = config.port || 3210;
  server.on('error', (e) => {
    if (ctx && ctx.logger) ctx.logger.warn('[mmcas-panel] 数据服务监听失败（可能另一实例已占用）:', e.code || e.message);
  });
  server.listen(dataPort, '127.0.0.1');
  if (ctx && typeof ctx.on === 'function') ctx.on('dispose', () => server.close());
  return { collectState };
}
