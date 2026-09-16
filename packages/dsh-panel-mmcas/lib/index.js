/**
 * @mmcas/dsh-panel —— host 侧 v2
 * 回环 HTTP 数据/操作端点（127.0.0.1:3210，仅本机）:
 *   GET  /api/state   面板状态（任务卡/设备/记忆/git/同步水位）
 *   GET  /api/tasks   任务卡列表
 *   POST /api/tasks   新建任务 {title, owner, desc}
 *   PUT  /api/tasks   更新 {id, status?, title?, desc?}（三状态机校验）
 *   DELETE /api/tasks 删除 {id}
 *   POST /api/exec    Slave 远程执行 {role, cmd}（ssh，仅 Master）
 *   GET  /api/refresh 看板刷新：按需 git 同步后返回 {cards, git, sync}（?force=1 强制同步）
 *   POST /api/sync    立即 git 同步，返回 {ok, sync, cards, git}
 *
 * 看板刷新与三方同步（2026-09-10 修）:
 *   本插件此前只读本地文件，git 水位靠 `git status` 与已过期的 origin/main 比对，
 *   因此在 coder/writer 端已 push 的情况下仍报"已同步"、看板长期停在旧状态
 *   （实测：本端落后 origin/main 10 个提交，T-016 本地 doing / 远端 done）。
 *   现每 30 秒（config.syncIntervalSec，默认 30）对工作区仓执行：fetch → 落后则
 *   merge（快进优先）→ 领先则 push；coder/writer 的任务卡变更即由此进入本端看板。
 *   默认不 add/commit（commit 归 sync-daemon，避免双进程争抢 .git/index.lock）；
 *   无 daemon 的机器可置 config.autoCommit=true 由本插件代提交。
 *   同步全程单飞（定时器与 HTTP 请求共用一次），冲突/失败显式上报给看板，绝不静默。
 *
 * v1.2（2026-09-15 实战修订）：合并两种实战分支（自动接取 v2 × 看板 30s git 同步），并新增：
 *   poller 单例锁（同角色双实例防重复派发）、派发前二次读卡（防过期快照）、
 *   目标会话排除已处理该卡的会话、WIP 改可配软约束（config.wipLimit，0=不限制）、
 *   config.localDir 可配（测试/演示隔离）。
 */
import { createServer } from 'node:http';
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const name = 'mmcas-dsh-panel';
export const inject = ['clientModules', 'sessions', 'agents', 'sessionController', 'tokenMeter'];

const VALID_STATUS = ['todo', 'doing', 'done'];
const VALID_ROLES = ['modeler', 'coder', 'writer'];
const TRANSITIONS = { todo: ['doing'], doing: ['done', 'todo'], done: ['todo'] };

export function apply(ctx, config = {}) {
  const ws = (config.workspaceDir || process.env.MMCAS_WORKSPACE || '').replace(/\\/g, '/');
  const role = config.role || 'modeler'; // modeler=Master 全功能；coder/writer=Slave 仅看板+记忆
  const local = String(config.localDir || path.join(os.homedir(), 'AppData', 'Local', 'mmcas')).replace(/\\/g, '/');

  // ---------- git 同步（看板刷新的数据来源：coder/writer 端的卡变更经远端仓进来） ----------
  const syncCfg = {
    gitBin: config.gitBin || 'git',
    remote: config.remote || 'origin',
    branch: config.branch || 'main',
    intervalSec: Math.min(Math.max(Number(config.syncIntervalSec ?? 30) || 30, 10), 600),
    auto: config.autoSync !== false,
    autoCommit: config.autoCommit === true,
    timeoutMs: Math.min(Math.max(Number(config.gitTimeoutMs) || 20000, 5000), 60000),
  };
  const syncState = {
    ok: null, note: '尚未同步', lastRunAt: null, lastRunMs: 0,
    ahead: 0, behind: 0, conflict: false, reason: '', durationMs: 0,
  };
  let syncInFlight = null;
  let syncTimer = null;

  function log(level, msg) {
    try { if (ctx && ctx.logger && typeof ctx.logger[level] === 'function') ctx.logger[level](`[mmcas-panel] ${msg}`); } catch {}
  }

  function runGit(args) {
    const r = spawnSync(syncCfg.gitBin, args, {
      cwd: ws, encoding: 'utf8', windowsHide: true, timeout: syncCfg.timeoutMs,
      // 无凭据时必须快速失败：绝不让 git 挂在交互式用户名/密码提示上阻塞事件循环
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return {
      code: r.status,
      out: r.stdout || '',
      err: r.stderr || '',
      timedOut: !!(r.error && (r.error.code === 'ETIMEDOUT' || r.signal)),
    };
  }
  // 网络型 git 命令走异步：fetch 一次约 4~5 秒，spawnSync 会把整个 host（含 /api/tasks、
  // 轮询器）钉死同样久，且让"单飞"失效（先到的请求跑完，后到的又各起一次）
  function runGitAsync(args) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(syncCfg.gitBin, args, {
          cwd: ws, windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
      } catch (e) {
        resolve({ code: -1, out: '', err: String(e), timedOut: false });
        return;
      }
      let out = '', err = '', settled = false, timedOut = false;
      const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch {} }, syncCfg.timeoutMs);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        resolve({ code: -1, out, err: err + String(e), timedOut });
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        resolve({ code, out, err, timedOut });
      });
    });
  }
  const shortErr = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 180);

  function aheadBehind(ref) {
    const r = runGit(['rev-list', '--left-right', '--count', `${ref}...HEAD`]);
    if (r.code !== 0) return null;
    const [b, a] = r.out.trim().split(/\s+/).map(Number);
    return { behind: b || 0, ahead: a || 0 };
  }
  async function aheadBehindAsync(ref) {
    const r = await runGitAsync(['rev-list', '--left-right', '--count', `${ref}...HEAD`]);
    if (r.code !== 0) return null;
    const [b, a] = r.out.trim().split(/\s+/).map(Number);
    return { behind: b || 0, ahead: a || 0 };
  }

  // 单飞：定时器与 HTTP 刷新共用同一次同步，避免并发 git 进程互抢 .git/index.lock
  function gitSync(reason) {
    if (syncInFlight) return syncInFlight;
    syncInFlight = (async () => {
      const t0 = Date.now();
      const finish = (patch) => {
        Object.assign(syncState, { ahead: 0, behind: 0 }, patch, {
          lastRunAt: new Date().toISOString(), lastRunMs: Date.now(),
          durationMs: Date.now() - t0, reason,
        });
        return { ...syncState };
      };
      try {
        // 0. 遗留冲突：自动合并只会放大事故，显式停手等人工介入
        const unmerged = await runGitAsync(['ls-files', '-u']);
        if (unmerged.code === 0 && unmerged.out.trim()) {
          return finish({ ok: false, conflict: true, note: '工作区存在未解决的合并冲突，已停止自动同步（请人工处理）' });
        }
        // 1.（可选）代 sync-daemon 提交本地变更；默认关闭
        if (syncCfg.autoCommit) {
          const st = await runGitAsync(['status', '--porcelain']);
          if (st.code === 0 && st.out.trim()) {
            await runGitAsync(['add', '-A']);
            await runGitAsync(['commit', '-m', `mmcas-panel: auto commit (${new Date().toISOString().slice(0, 19).replace('T', ' ')})`]);
          }
        }
        // 2. 取远端：coder/writer 已 push 的卡变更由此进来
        const f = await runGitAsync(['fetch', syncCfg.remote, syncCfg.branch]);
        if (f.code !== 0) {
          return finish({
            ok: false,
            note: f.timedOut ? 'fetch 超时（网络不通或凭据未就绪）' : `fetch 失败: ${shortErr(f.err)}`,
          });
        }
        const ref = `${syncCfg.remote}/${syncCfg.branch}`;
        let ab = (await aheadBehindAsync(ref)) || { ahead: 0, behind: 0 };
        let merged = 0;
        // 3. 落后 → 合并（纯快进时不产生合并提交）
        if (ab.behind > 0) {
          merged = ab.behind;
          const m = await runGitAsync(['merge', '--no-edit', 'FETCH_HEAD']);
          if (m.code !== 0) {
            const c = await runGitAsync(['ls-files', '-u']);
            const conflict = c.code === 0 && c.out.trim().length > 0;
            return finish({
              ok: false, conflict, ahead: ab.ahead, behind: ab.behind,
              note: conflict
                ? `合并冲突（落后 ${ab.behind} 个提交），已停止自动同步，请人工处理`
                : `合并失败: ${shortErr(m.err || m.out)}`,
            });
          }
          ab = (await aheadBehindAsync(ref)) || { ahead: 0, behind: 0 };
        }
        // 4. 领先 → 推送（sync-daemon 停摆时本端提交也要出得去；不代它 commit）
        let pushed = false;
        if (ab.ahead > 0) {
          const p = await runGitAsync(['push', syncCfg.remote, syncCfg.branch]);
          if (p.code !== 0) {
            return finish({ ok: false, ahead: ab.ahead, note: `拉取成功，推送失败: ${shortErr(p.err)}` });
          }
          pushed = true;
        }
        const note = merged > 0 ? `已同步：并入远端 ${merged} 个提交` : pushed ? '已同步：本端提交已推送' : '已是最新';
        return finish({ ok: true, conflict: false, note });
      } catch (e) {
        return finish({ ok: false, note: `同步异常: ${String((e && e.message) || e).slice(0, 160)}` });
      }
    })().finally(() => { syncInFlight = null; });
    return syncInFlight;
  }

  function applySyncTimer() {
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
    if (!syncCfg.auto) return;
    syncTimer = setInterval(() => {
      gitSync('timer').then((s) => { if (!s.ok) log('warn', `定时同步未成功: ${s.note}`); }).catch(() => {});
    }, syncCfg.intervalSec * 1000);
    if (typeof syncTimer.unref === 'function') syncTimer.unref();
    // 启动后补一次：dsh 重启后不必干等满一个周期才看到队友的卡
    const kick = setTimeout(() => { gitSync('startup').catch(() => {}); }, 3000);
    if (typeof kick.unref === 'function') kick.unref();
  }
  applySyncTimer();

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
    const r = runGit(['log', '--pretty=format:%h|%an|%s', '-n', '8']);
    const log = r.code === 0 ? r.out.trim().split('\n').filter(Boolean) : [];
    const b = runGit(['status', '-sb', '--porcelain']);
    // 水位对比对象用已 fetch 的远端跟踪分支：刷新时刚同步过，读数才是真的
    const beh = runGit(['rev-list', '--left-right', '--count', `${syncCfg.remote}/${syncCfg.branch}...HEAD`]);
    let ahead = 0, behind = 0;
    if (beh.code === 0) { const [bh, ah] = beh.out.trim().split(/\s+/).map(Number); behind = bh || 0; ahead = ah || 0; }
    return { log, branch: b.code === 0 ? (b.out.split('\n')[0] || '') : '', ahead, behind };
  }
  function devices() {
    const r = spawnSync('C:/Program Files/Tailscale/tailscale.exe', ['status', '--json'], { encoding: 'utf8', windowsHide: true });
    // 本机按自身角色登记：writer 机上再写"建模手 · 本机"会把队友端与本机混为一谈
    const LOCAL_LABEL = { modeler: '建模手', coder: '编程手', writer: '论文手' };
    const out = { [role]: { name: `${LOCAL_LABEL[role] || role} · 本机`, online: true } };
    if (r.status !== 0) return out;
    try {
      const j = JSON.parse(r.stdout);
      out[role].ip = j.Self?.TailscaleIPs?.[0] || '';
      for (const peer of Object.values(j.Peer || {})) {
        const n = (peer.HostName || '').toLowerCase();
        if (n.startsWith('mmcas-')) out[n.replace('mmcas-', '')] = { name: n.replace('mmcas-', ''), online: peer.Online, ip: peer.TailscaleIPs?.[0] || '' };
      }
    } catch {}
    // 合并 devices.json 的用户名
    try {
      const dj = JSON.parse(readFileSync(path.join(local, 'devices.json'), 'utf8'));
      for (const r2 of ['coder', 'writer']) if (dj[r2]) out[r2] = { ...(out[r2] || {}), ...dj[r2] };
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
  // v1.2 T5.3：同步守护心跳（读 daemon 的 sync.state.json；新鲜度 ≤180s 视为存活）
  function syncHeartbeat() {
    try {
      const mmcasHome = process.env.MMCAS_HOME || path.join(os.homedir(), 'AppData', 'Local', 'mmcas');
      const sp = path.join(mmcasHome, 'logs', 'sync.state.json');
      const st = statSync(sp);
      const j = JSON.parse(readFileSync(sp, 'utf8'));
      const hb = j.lastHeartbeat ? Date.parse(j.lastHeartbeat) : st.mtimeMs;
      const age = Math.max(0, Math.round((Date.now() - hb) / 1000));
      return { alive: age <= 180, ageSec: age, mode: j.mode || null, at: j.lastHeartbeat || new Date(st.mtimeMs).toISOString() };
    } catch {
      return { alive: false, ageSec: null, mode: null, at: null };
    }
  }

  function collectState() {
    return {
      role, cards: loadCards(), git: gitInfo(), devices: devices(), memory: memoryEntries(),
      sync: { ...syncState, heartbeat: syncHeartbeat() }, syncIntervalSec: syncCfg.intervalSec,
      wipLimit: WIP_LIMIT,                                        // v1.2：面板徽标（0=不限制）
      poller: { enabled: poller.enabled, intervalSec: poller.intervalSec, autoClaim: poller.autoClaim,
        claimStaleMin: poller.claimStaleMin, targetSessionId: poller.targetSessionId || '',
        lastRun: poller.lastRun, lastFound: poller.lastFound, lastBlocked: poller.lastBlocked,
        lastTargetSessionId: poller.lastTargetSessionId || '', claims: poller.claims.slice(-5),
        notified: [...notified], lock: { ...pollerLock },         // v1.2：单例锁状态显性上报
        sessionsCount: Object.keys(poller.sessions || {}).length },
      tokens: tokenWatermarks(),                                  // v1.2：上下文水位（T2.4）
      ts: new Date().toISOString(),
    };
  }

  // ---------- 任务 CRUD ----------
  function tasksDir() { return path.join(ws, 'tasks'); }
  function cardFile(id) { return path.join(tasksDir(), `${id}.md`); }
  function parseDepsOf(card) {
    return (card.deps || '').replace(/[\[\]']/g, '').split(',').map((s) => s.trim()).filter((x) => x);
  }
  // v1.2：WIP 为可配软约束——config.wipLimit，0/缺省 = 不限制（并行以依赖门控为准）
  const WIP_LIMIT = Math.max(Number(config.wipLimit ?? 0) || 0, 0);
  const wipAllowed = (doingCount) => WIP_LIMIT === 0 || doingCount < WIP_LIMIT;
  const VALID_PRIORITY = ['P0', 'P1', 'P2'];
  function checkTransition(card, to, opts) {
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
      if (!wipAllowed(doingCount)) return { ok: false, reason: `WIP 超限：${card.owner} 已有 ${doingCount} 个进行中任务（上限 ${WIP_LIMIT}；wipLimit=0 表示不限制）` };
    }
    // v1.2：打回（done→todo）必须带原因；附带下游影响提示（不阻塞）
    if (to === 'todo' && card.status === 'done') {
      const reason = String((opts && opts.reason) || '').trim();
      if (!reason) return { ok: false, reason: '打回必须填写原因（reason 字段 / --reason 参数）' };
      const dependents = loadCards().filter((c) => c.id !== card.id && parseDepsOf(c).includes(card.id) && c.status !== 'todo');
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

  // ---------- 任务轮询器（**自动接取 + 派发**） ----------
  //
  // 设计目标（2026-09-11 维护者要求）：面板上"开启自动接取派发"之后，**本角色任务不需要人再手动认领**。
  // 每个 tick 依次做四件事：
  //   1) 挑就绪卡：owner=本角色、status=todo、deps 全部 done、本轮次未被通知过；
  //   2) WIP 闸：该 owner 的 doing 数 < WIP_LIMIT（与 /api/tasks PUT 同一常量）；
  //   3) **自动接取**：直接把卡写成 doing（复用 checkTransition 的同一套校验，绝不绕过 deps/WIP）；
  //   4) **派发**：向"最近活跃的可用会话"注入一条提示，内容按是否已接取而不同
  //      （已接取 ⇒ 直接开工；未接取 ⇒ 先认领再开工）。注入失败 ⇒ **把卡回滚为 todo**，
  //      绝不把卡挂在"没人干"的 doing 上。
  //
  // 相对旧版修掉的三件事（旧版缺陷见 memory/coder/2026-09-11.md 20:1x 诊断）：
  //   a) 注入目标不再取"会话列表第一个"（实测：14 条提示全飞进同一个长驻会话，新开的会话一条都收不到），
  //      改为**最近活跃 + 可用 agent**，并支持 `targetSessionId` 钉死；
  //   b) `notified` 与 tick 历史**落盘**（旧版只在内存、且 lastFound 是快照 ⇒ "就绪却没注入"完全无痕）；
  //   c) 状态文件**按角色分目录** `%LOCALAPPDATA%\mmcas\<role>\poller.json`（旧版全角色共用一份，互相覆盖），
  //      并自动迁移旧文件。
  const stateDir = path.join(local, role);
  const pollerStateFile = path.join(stateDir, 'poller.json');
  const legacyPollerFile = path.join(local, 'poller.json');
  const POLLER_DEFAULTS = {
    enabled: false, intervalSec: 120, autoClaim: true, claimStaleMin: 0, targetSessionId: '',
    lastRun: null, lastFound: [], lastBlocked: [], lastAutoClaim: [], history: [], claims: [], notified: [],
    sessions: {}, reworkNotified: {},
  };
  let poller = { ...POLLER_DEFAULTS };
  try { poller = { ...poller, ...JSON.parse(readFileSync(pollerStateFile, 'utf8')) }; }
  catch {
    try { poller = { ...poller, ...JSON.parse(readFileSync(legacyPollerFile, 'utf8')) }; }   // 迁移旧版共享文件
    catch {}
  }
  if (!Array.isArray(poller.claims)) poller.claims = [];
  if (!Array.isArray(poller.history)) poller.history = [];
  if (!poller.sessions || typeof poller.sessions !== 'object') poller.sessions = {};
  if (!poller.reworkNotified || typeof poller.reworkNotified !== 'object') poller.reworkNotified = {};
  let notified = new Set(Array.isArray(poller.notified) ? poller.notified : []);   // 已注入通知的卡（持久化去重）

  // ---------- v1.2：轮询器单例锁（同角色双实例防重复派发） ----------
  // 多实例共用同一 local 目录时（如 3199 主实例 + 3200 演示实例），第二个实例读到
  // 活锁后自动停用 tick，并在 /api/state 的 poller.lock 显性上报；主实例退出（锁释放或
  // pid 消失）后，被封锁实例下一 tick 自动接管。
  const pollerLockFile = path.join(stateDir, 'poller.lock');
  let pollerLock = { ok: true, note: '', holder: '' };
  function acquirePollerLock() {
    const me = { pid: process.pid, port: config.port || 3210, role, at: new Date().toISOString() };
    try {
      if (existsSync(pollerLockFile)) {
        let holder = null;
        try { holder = JSON.parse(readFileSync(pollerLockFile, 'utf8')); } catch {}
        const pid = Number(holder && holder.pid) || 0;
        const holderPort = Number(holder && holder.port) || 0;
        let alive = false;
        if (pid > 0) { try { process.kill(pid, 0); alive = true; } catch (e) { alive = e && e.code === 'EPERM'; } }
        // 同 pid 且同端口 = 自己；同 pid 不同端口 / 不同 pid（活）= 另一实例（后者覆盖多进程的真实部署）
        if (alive && (pid !== process.pid || (holderPort && holderPort !== me.port))) {
          pollerLock = { ok: false, note: `另一个实例（pid ${pid}，端口 ${holderPort || '?'}）持有轮询器锁，本实例已停用自动派发`, holder: String(pid) };
          return false;
        }
      }
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(pollerLockFile, JSON.stringify(me, null, 2));
      pollerLock = { ok: true, note: '', holder: String(process.pid) };
      return true;
    } catch (e) {
      pollerLock = { ok: true, note: `锁读写失败（放行）：${String(e).slice(0, 80)}`, holder: '' };
      return true;
    }
  }
  function releasePollerLock() {
    try {
      if (!existsSync(pollerLockFile)) return;
      const holder = JSON.parse(readFileSync(pollerLockFile, 'utf8'));
      if (Number(holder && holder.pid) === process.pid) unlinkSync(pollerLockFile);
    } catch {}
  }
  acquirePollerLock();
  savePoller();   // 启动即落盘一次：把旧版共享 poller.json 迁移转正到 <local>/<role>/poller.json

  function savePoller() {
    try {
      mkdirSync(path.dirname(pollerStateFile), { recursive: true });
      poller.notified = [...notified];
      writeFileSync(pollerStateFile, JSON.stringify(poller, null, 2));
    } catch {}
  }

  function depsPending(card, cards) {
    return parseDepsOf(card).filter((d) => {
      const dep = cards.find((x) => x.id === d);
      return !dep || dep.status !== 'done';
    });
  }
  function priorityRank(c) { return c.priority === 'P0' ? 0 : c.priority === 'P2' ? 2 : 1; }

  function pollerScan() {
    const cards = loadCards();
    const doingCount = cards.filter((c) => c.status === 'doing' && c.owner === role).length;
    const candidates = cards.filter((c) => c.status === 'todo' && c.owner === role
      && depsPending(c, cards).length === 0 && !notified.has(c.id));
    // 接取顺序：priority 升序（P0→P1→P2），同优先级被他人 deps 引用的卡优先（关键路径优先）
    const refCount = (c) => cards.filter((x) => parseDepsOf(x).includes(c.id)).length;
    candidates.sort((a, b) => priorityRank(a) - priorityRank(b) || refCount(b) - refCount(a));
    const open = wipAllowed(doingCount);
    return { ready: open ? candidates : [], blocked: open ? [] : candidates, doingCount, wipOpen: open };
  }

  // 目标会话：最近活跃 + 有可用 agent（fallback：列表末尾，因为列表通常按创建先后排列）
  // v1.2：可传入 excludeIds（Set）——排除已处理过该卡的会话（防同卡重复注入）
  function pickTargetAgent(excludeIds) {
    const list = (ctx && ctx.sessions && typeof ctx.sessions.list === 'function') ? ctx.sessions.list() : [];
    let live = [];
    for (const s of list) {
      const a = ctx && ctx.agents && typeof ctx.agents.get === 'function' ? ctx.agents.get(s.id) : null;
      if (a) live.push({ s, a });
    }
    if (excludeIds && excludeIds.size) live = live.filter((x) => !(x.s && excludeIds.has(x.s.id)));
    if (!live.length) return null;
    if (poller.targetSessionId) {
      const hit = live.find((x) => x.s && x.s.id === poller.targetSessionId);
      if (hit) return hit;
    }
    const ts = (x) => Number((x.s && (x.s.updatedAt || x.s.lastActiveAt || x.s.lastActivityAt || x.s.modifiedAt)) || 0);
    const newest = live.slice().sort((a, b) => ts(b) - ts(a))[0];
    return ts(newest) > 0 ? newest : live[live.length - 1];
  }

  // v1.2：某卡历史上被派往过的会话集合（防重复派发；claims 为持久化 card→session 映射）
  function sessionsProcessedCard(cardId) {
    const ids = new Set();
    for (const c of (poller.claims || [])) if (c.id === cardId && c.sessionId) ids.add(c.sessionId);
    return ids;
  }

  function setCardStatus(card, to) {
    const f = cardFile(card.id);
    let text = readFileSync(f, 'utf8');
    text = text.replace(/^status: .*$/m, `status: ${to}`)
      .replace(/^updated: .*$/m, `updated: ${new Date().toISOString().slice(0, 10)}`);
    writeFileSync(f, text);
  }

  // ---------- v1.2：注入与建会话（T2.2/T2.3） ----------

  // 统一注入通道：活会话直接 followup/steer；冷会话经 sessionController.prompt（含 resume）
  async function injectToSession(sessionId, text, mode) {
    if (!sessionId) return false;
    const msg = {
      id: randomUUID(),   // 必须带稳定 id，否则会话持久化校验失败（seq lacks an identified message）
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user', rpcId: 'mmcas-poller-' + Date.now() },
    };
    try {
      const agent = ctx && ctx.agents && typeof ctx.agents.get === 'function' ? ctx.agents.get(sessionId) : null;
      if (agent) {
        if (mode === 'steer' && typeof agent.steer === 'function') { agent.steer(msg); return true; }
        if (typeof agent.followup === 'function') { agent.followup(msg); return true; }
      }
    } catch (e) {
      try { if (ctx.logger) ctx.logger.warn('[mmcas-poller] agent 注入失败，尝试 prompt 通道:', String(e)); } catch {}
    }
    try {
      if (ctx && ctx.sessionController && typeof ctx.sessionController.prompt === 'function') {
        await ctx.sessionController.prompt({
          requestId: randomUUID(), sessionId,
          mode: mode === 'steer' ? 'steer' : 'queue',
          content: [{ type: 'text', text }],
        });
        return true;
      }
    } catch (e) {
      try { if (ctx.logger) ctx.logger.warn('[mmcas-poller] prompt 注入失败:', String(e)); } catch {}
    }
    return false;
  }

  // 新卡开新会话（T2.2）：标题 = "T-xxx 标题"、cwd = 工作区；尽力归入已注册的 MMCAS workspace
  function findWorkspaceId() {
    try {
      const home = process.env.DSH_HOME || path.join(local, 'dsh-home');
      const wj = JSON.parse(readFileSync(path.join(home, 'storages', 'workspace.json'), 'utf8'));
      const rows = (wj && wj.tables && wj.tables.workspaces) || {};
      for (const id of Object.keys(rows)) {
        const r = rows[id];
        if (r && String(r.path || '').replace(/\\/g, '/') === ws) return id;
      }
    } catch {}
    return null;
  }
  async function createSessionForCard(card) {
    try {
      if (!ctx || !ctx.sessionController || typeof ctx.sessionController.create !== 'function') return null;
      // dsh 校验：workspaceId 与 cwd 二选一（"accepts workspaceId or cwd, not both"）——
      // 优先 workspaceId（会话归入 MMCAS workspace），拿不到再退回 cwd。
      const req = {};
      const wid = findWorkspaceId();
      if (wid) req.workspaceId = wid; else req.cwd = ws;
      const created = await ctx.sessionController.create(req);
      const sid = created && created.sessionId;
      if (!sid) return null;
      try { await ctx.sessionController.rename({ sessionId: sid, title: card.id + ' ' + (card.title || '') }); } catch {}
      return sid;
    } catch (e) {
      try { if (ctx.logger) ctx.logger.warn('[mmcas-poller] 新会话创建失败（回退最近活跃注入）:', String(e)); } catch {}
      return null;
    }
  }

  // 可选：回收"僵死认领"（逾期未动 + 卡未被编辑 + 持有会话已不在活跃列表）——默认关闭（claimStaleMin=0）
  function releaseStaleClaims() {
    const ttlMin = Number(poller.claimStaleMin || 0);
    if (!(ttlMin > 0)) return [];
    const released = [];
    const cards = loadCards();
    let activeIds = new Set();
    try {
      activeIds = new Set(((ctx && ctx.sessions && typeof ctx.sessions.list === 'function' ? ctx.sessions.list() : []) || []).map((s) => s.id));
    } catch {}
    for (const cl of [...poller.claims]) {
      const c = cards.find((x) => x.id === cl.id);
      if (!c || c.status !== 'doing') { poller.claims = poller.claims.filter((x) => x !== cl); continue; }
      const at = Date.parse(cl.at) || 0;
      const ageMin = (Date.now() - at) / 60000;
      let mtime = 0;
      try { mtime = statSync(cardFile(c.id)).mtimeMs; } catch {}
      const edited = mtime > at + 1000;
      const holderGone = cl.sessionId ? !activeIds.has(cl.sessionId) : true;
      if (ageMin >= ttlMin && !edited && holderGone) {
        try {
          setCardStatus(c, 'todo');
          released.push(cl.id);
          poller.claims = poller.claims.filter((x) => x !== cl);
          notified.delete(cl.id);
        } catch {}
      }
    }
    return released;
  }

  // ---------- v1.2：跨端消息层（notices/ 文件通道，T3.1/T3.2） ----------
  const NOTICES_DIR = () => path.join(ws, 'notices');
  function parseNoticeFile(fp) {
    try {
      const t = readFileSync(fp, 'utf8');
      const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!m) return null;
      const fm = {};
      for (const line of m[1].split('\n')) {
        const i = line.indexOf(':');
        if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      const bodyM = t.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
      return { ...fm, body: (bodyM ? bodyM[1] : '').replace(/^##\s*正文\s*\n?/, '').trim(), file: fp };
    } catch { return null; }
  }
  function writeNoticeStatus(fp, status, extra) {
    try {
      let t = readFileSync(fp, 'utf8');
      t = t.replace(/^status: .*$/m, 'status: ' + status);
      const adds = [];
      if (extra) for (const [k, v] of Object.entries(extra)) {
        if (!new RegExp('^' + k + ': ', 'm').test(t)) adds.push(k + ': ' + v);
      }
      if (adds.length) t = t.replace(/^(status: .*)$/m, (line0) => line0 + '\n' + adds.join('\n'));
      writeFileSync(fp, t);
      return true;
    } catch { return false; }
  }
  function resolveNoticeTargets(rec) {
    // scope 中的 T-xxx（逗号/空白分隔）→ 对应会话映射；无映射返回 []
    const ids = String(rec.scope || '').split(/[,\s，]+/).filter((x) => /^T-\d+$/.test(x));
    const out = [];
    for (const tid of ids) { const sid = (poller.sessions || {})[tid]; if (sid && !out.includes(sid)) out.push(sid); }
    return out;
  }
  const NOTICE_KIND_LABEL = { ruling: '裁决请求', error: '错误上报', stop: '停止指令', info: '一般' };
  async function consumeNotices() {
    const res = { delivered: [], skipped: [] };
    try {
      const dir = NOTICES_DIR();
      if (!existsSync(dir)) return res;
      const files = readdirSync(dir).filter((f) => /^N-[\w-]+\.md$/.test(f)).sort();
      for (const f of files) {
        const fp = path.join(dir, f);
        const rec = parseNoticeFile(fp);
        if (!rec || rec.status !== 'pending') continue;
        if (rec.to !== role && rec.to !== 'all') continue;
        const label = NOTICE_KIND_LABEL[rec.kind] || rec.kind || '消息';
        const text = '【MMCAS 消息 ' + rec.id + '｜' + label + (rec.urgency === 'urgent' ? '｜紧急' : '') + '】来自 ' + rec.from + '：\n' +
          (rec.body || '') + (rec.scope ? '\n（相关：' + rec.scope + '）' : '') +
          '\n处理完成后请在面板「消息」区或 notice.mjs 回执（ack）。';
        let ok = false;
        if (rec.urgency === 'urgent') {
          const targets = resolveNoticeTargets(rec);
          if (!targets.length) { const t = pickTargetAgent(); if (t) targets.push(t.s.id); }
          for (const sid of targets) { if (await injectToSession(sid, text, 'steer')) { ok = true; break; } }
        } else {
          const targets = resolveNoticeTargets(rec);
          let sid = targets[0];
          if (!sid) { const t = pickTargetAgent(); sid = t && t.s.id; }
          if (sid) ok = await injectToSession(sid, text, 'queue');
        }
        if (ok) { writeNoticeStatus(fp, 'delivered', { deliveredAt: new Date().toISOString() }); res.delivered.push(rec.id); }
        else res.skipped.push(rec.id);
      }
    } catch (e) {
      try { if (ctx.logger) ctx.logger.warn('[mmcas-notices] 消费异常:', String(e)); } catch {}
    }
    return res;
  }

  // ---------- v1.2：独立审计（W4：经本地桥的第三方专家审计） ----------
  function findAuditRunner() {
    try {
      if (config.coreDir) {
        const p = path.join(String(config.coreDir), 'audit', 'audit-run.mjs');
        if (existsSync(p)) return p;
      }
    } catch {}
    try {
      const LIB = path.dirname(fileURLToPath(import.meta.url));
      for (const rel of ['../../core', '../../../core']) {
        const p = path.resolve(LIB, rel, 'audit', 'audit-run.mjs');
        if (existsSync(p)) return p;
      }
    } catch {}
    return null;
  }
  const auditState = { running: false, id: '', dimension: '', startedAt: '', result: null };
  // ---- v1.2.x：Reviewer 配置（settings.yaml reviewer 段读写 + 缓存） ----
  let reviewerCfgCache = { at: 0, data: null };
  function reviewerSection(settingsPath) {
    try {
      if (!existsSync(settingsPath)) return null;
      const lines = readFileSync(settingsPath, 'utf8').split('\n');
      let inSec = false;
      const cfg = {};
      for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        if (!inSec) { if (/^reviewer\s*:/.test(line)) inSec = true; continue; }
        if (/^\S/.test(line) && line.trim() !== '') break;
        const m = line.match(/^\s+([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/);
        if (m) cfg[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
      return Object.keys(cfg).length ? cfg : null;
    } catch { return null; }
  }
  function writeReviewerSection(settingsPath, cfg) {
    try {
      const s = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '';
      const eol = s.includes('\r\n') ? '\r\n' : '\n';
      const out = [];
      let inSec = false;
      for (const raw of s.split('\n')) {
        const line = raw.replace(/\r$/, '');
        const isTop = /^\S/.test(line) && line.trim() !== '';
        if (!inSec && /^reviewer\s*:/.test(line)) { inSec = true; continue; }
        if (inSec) { if (isTop) inSec = false; else continue; }
        out.push(line);
      }
      while (out.length && out[out.length - 1].trim() === '') out.pop();
      const block = [
        '# Reviewer（审阅人）——MMCAS 第四方审阅实例配置。换专家模型：改 endpoint/model/protocol；key 存入 .credentials.yaml 的 refs（apiKeyEnv 指向）',
        'reviewer:',
        '  endpoint: ' + cfg.endpoint,
        '  apiKeyEnv: ' + cfg.apiKeyEnv,
        '  model: ' + cfg.model,
        '  protocol: ' + cfg.protocol,
        '  maxFeeCny: ' + cfg.maxFeeCny,
      ];
      writeFileSync(settingsPath, (out.join('\n') + '\n' + block.join('\n') + '\n').replace(/\n/g, eol));
      return true;
    } catch { return false; }
  }
  function runAuditCli(dimension, opts) {
    return new Promise((resolve) => {
      const runner = findAuditRunner();
      if (!runner) { resolve({ ok: false, error: '未找到 audit-run.mjs（在 profile patch 的 mmcas-panel.config 配 coreDir，或使用含 packages/core 的布局）' }); return; }
      const args = [runner, '--dimension', dimension, '--workspace', ws];
      if (opts && opts.dryRun) args.push('--dry-run');
      if (opts && opts.confirm) args.push('--confirm');
      if (opts && opts.model) args.push('--model', String(opts.model));
      if (opts && opts.note) args.push('--note', String(opts.note));
      const child = spawn(process.execPath, args, { cwd: ws, windowsHide: true });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      child.on('error', (e) => resolve({ ok: false, error: String((e && e.message) || e) }));
      child.on('close', (code) => {
        const m = out.match(/AUDIT_RESULT=(\{.*\})/);
        let parsed = null;
        try { parsed = m ? JSON.parse(m[1]) : null; } catch {}
        if (parsed) resolve({ ...parsed, exitCode: code });
        else resolve({ ok: false, error: '审计进程无结果（exit ' + code + '）：' + out.trim().slice(-300) });
      });
    });
  }

  // ---------- v1.2：上下文水位（T2.4；60s 缓存，最多 3 个最近会话） ----------
  let wmCache = { at: 0, data: [] };
  function tokenWatermarks() {
    if (Date.now() - wmCache.at < 60000) return wmCache.data;
    const out = [];
    try {
      if (ctx && ctx.tokenMeter && typeof ctx.tokenMeter.measure === 'function' && ctx.sessions && typeof ctx.sessions.list === 'function') {
        const list = ctx.sessions.list() || [];
        for (const s of list.slice(0, 3)) {
          try {
            const m = ctx.tokenMeter.measure(s);
            out.push({ id: s.id, title: s.title || '', total: m.totalTokens || 0, surface: m.surfaceTokens || 0 });
          } catch {}
        }
      }
    } catch {}
    wmCache = { at: Date.now(), data: out };
    return out;
  }

  async function tickPoller(force) {
    if (!poller.enabled && !force) return { skipped: 'poller disabled' };
    // v1.2 单例锁：被其他实例持锁时不动作（每 tick 顺带重试获取，主实例退出后可自动接管）
    if (!pollerLock.ok) { acquirePollerLock(); if (!pollerLock.ok) return { skipped: 'locked by another instance', lock: pollerLock.note }; }
    const released = releaseStaleClaims();
    const scan = pollerScan();
    poller.lastRun = new Date().toISOString();
    poller.lastFound = scan.ready.map((c) => c.id);
    poller.lastBlocked = scan.blocked.map((c) => c.id);
    const tick = { at: poller.lastRun, ready: poller.lastFound, blocked: poller.lastBlocked,
      claimed: [], dispatched: [], released, note: '', target: '', newSessions: [], rework: [] };
    for (const card of scan.ready) {
      // v1.2：派发前二次读卡（只认文件最末状态——防重编号/打回/并发接取后的过期快照派发）
      const fresh = loadCards().find((c) => c.id === card.id);
      if (!fresh || fresh.status !== 'todo') {
        tick.note = card.id + ' 状态已变化（' + (fresh ? fresh.status : '已删除') + '），跳过派发';
        continue;
      }
      const reworkCount = Number(fresh.rework || 0) || 0;
      const isRework = reworkCount > 0 && reworkCount > Number((poller.reworkNotified || {})[fresh.id] || 0);
      if (isRework) {
        // T2.3：打回续做——优先原会话（card→session 映射），不存在则新建会话兜底
        const prev = poller.sessions[fresh.id] || '';
        let targetId = null;
        let viaNew = false;
        if (prev) {
          let exists = false;
          try { exists = ((ctx.sessions && typeof ctx.sessions.list === 'function' ? ctx.sessions.list() : []) || []).some((s) => s && s.id === prev); } catch {}
          if (exists) targetId = prev;
        }
        if (!targetId) { targetId = await createSessionForCard(fresh); viaNew = true; }
        if (!targetId) { tick.note = fresh.id + ' 续做失败：原会话不存在且新建会话失败（下轮重试）'; continue; }
        let claimed = false;
        if (poller.autoClaim) {
          const chk = checkTransition(fresh, 'doing');
          if (!chk.ok) { tick.note = fresh.id + ' 未能接取: ' + chk.reason; continue; }
          try {
            setCardStatus(fresh, 'doing');
            claimed = true;
            poller.claims = poller.claims.concat([{ id: fresh.id, by: 'poller-rework', sessionId: targetId, at: poller.lastRun }]).slice(-50);
            fresh.status = 'doing';
          } catch (e) { tick.note = fresh.id + ' 接取写盘失败: ' + String(e); continue; }
        }
        const text = '任务轮询器：' + fresh.id + '「' + (fresh.title || '') + '」被打回（第 ' + reworkCount + ' 轮），请继续处理——打回原因见卡面批注。完成后按纪律置 done。';
        const ok = await injectToSession(targetId, text, 'queue');
        if (ok) {
          poller.sessions[fresh.id] = targetId;
          poller.reworkNotified[fresh.id] = reworkCount;
          tick.dispatched.push(fresh.id);
          if (claimed) tick.claimed.push(fresh.id);
          tick.rework.push(fresh.id);
          if (viaNew) tick.newSessions.push(targetId);
          tick.target = targetId;
        } else {
          if (claimed) { try { setCardStatus(fresh, 'todo'); } catch {} }
          tick.note = fresh.id + ' 续做注入失败，已回滚（下轮重试）';
        }
        continue;
      }
      // 新卡路径（T2.2）：新建会话（失败回退"最近活跃"）→ 认领 → 注入
      let targetId = await createSessionForCard(fresh);
      const viaNew = !!targetId;
      if (!targetId) {
        const excl = sessionsProcessedCard(fresh.id);
        const tgt = pickTargetAgent(excl);
        if (!tgt) { tick.note = '没有可注入的活跃会话（提示已保留，下轮重试）'; break; }
        targetId = tgt.s && tgt.s.id;
      }
      let claimed = false;
      if (poller.autoClaim) {
        const chk = checkTransition(fresh, 'doing');
        if (!chk.ok) { tick.note = fresh.id + ' 未能接取: ' + chk.reason; continue; }   // 不加 notified ⇒ 下轮再试
        try {
          setCardStatus(fresh, 'doing');
          claimed = true;
          poller.claims = poller.claims.concat([{ id: fresh.id, by: 'poller', sessionId: targetId || '', at: poller.lastRun }]).slice(-50);
          fresh.status = 'doing';                                                    // 本地视图同步，避免同 tick 重复处理
        } catch (e) {
          tick.note = fresh.id + ' 接取写盘失败: ' + String(e);
          continue;
        }
      }
      const text = claimed
        ? '任务轮询器：已**自动接取** ' + fresh.id + '「' + (fresh.title || '') + '」（todo→doing，owner=你）。请直接读取任务卡开始工作（不要重复认领）；完成后按纪律置 done。'
        : '任务轮询器：检测到就绪任务 ' + fresh.id + '「' + (fresh.title || '') + '」（priority ' + (fresh.priority || 'P1') + '，owner=你）。请按接取规则执行：读取任务卡，认领（todo→doing），开始工作。';
      const ok = await injectToSession(targetId, text, 'queue');
      if (ok) {
        poller.sessions[fresh.id] = targetId;
        notified.add(fresh.id);
        tick.dispatched.push(fresh.id);
        if (claimed) tick.claimed.push(fresh.id);
        if (viaNew) tick.newSessions.push(targetId);
        tick.target = targetId || '';
      } else {
        if (claimed) {                                                               // 回滚，绝不把卡挂在没人干的状态
          try { setCardStatus(fresh, 'todo'); } catch {}
          poller.claims = poller.claims.filter((x) => x.id !== fresh.id);
          tick.note = fresh.id + ' 派发失败，已回滚为 todo';
        } else {
          tick.note = fresh.id + ' 派发失败';
        }
      }
    }
    // v1.2：notices 消息层消费（T3.1/T3.2——normal=queue、urgent/stop=steer）
    try {
      const nres = await consumeNotices();
      if (nres && nres.delivered && nres.delivered.length) tick.notices = nres.delivered;
    } catch (e) {
      tick.note = (tick.note ? tick.note + '；' : '') + 'notices 消费异常: ' + String(e).slice(0, 80);
    }
    // 通知记录清理：卡消失、或状态离开 todo（已接取/完成）⇒ 清除；退回 todo 后可重新通知
    const byId = new Map(loadCards().map((c) => [c.id, c]));
    for (const id of [...notified]) {
      const c = byId.get(id);
      if (!c || c.status !== 'todo') notified.delete(id);
    }
    // v1.2：卡删除时清理 rework 去重与映射（打回场景卡仍在，不清理）
    for (const id of Object.keys(poller.reworkNotified || {})) {
      if (!byId.get(id)) { delete poller.reworkNotified[id]; delete poller.sessions[id]; }
    }
    poller.history = poller.history.concat([tick]).slice(-20);
    savePoller();
    return tick;
  }

  let pollerTimer = null;
  function applyPollerState() {
    if (pollerTimer) clearInterval(pollerTimer);
    pollerTimer = null;
    if (poller.enabled) {
      setTimeout(() => tickPoller().catch(() => {}), 1500);       // 启动后稍等再跑，避免与面板首帧抢 IO
      pollerTimer = setInterval(() => tickPoller().catch(() => {}), (poller.intervalSec || 120) * 1000);
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
      const chunks = [];
      let total = 0;
      req.on('data', (c) => {
        // v1.2.x：按字节收集（Buffer），解码在 end 统一做——消除逐 chunk 字符串拼接在
        // 多字节字符跨 chunk 边界时产出 U+FFFD 的可能
        const buf = Buffer.isBuffer(c) ? c : Buffer.from(String(c), 'utf8');
        chunks.push(buf);
        total += buf.length;
        if (total > 262144) { try { req.destroy(); } catch {} }
      });
      req.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        if (data.includes('\uFFFD')) { resolve({ __badEncoding: true, rawLen: data.length, rawHead: data.slice(0, 80) }); return; }
        try { resolve(JSON.parse(data || '{}')); }
        catch { resolve({ __parseFail: true, rawLen: data.length, rawHead: data.slice(0, 120) }); }
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

    // ---- 看板刷新（含 git 同步；coder/writer 的卡变更由此进入本端） ----
    if (p === '/api/refresh' && req.method === 'GET') {
      const force = url.searchParams.get('force') === '1';
      // 定时器正常时这里直接复用；超过 2 个周期仍是陈的（定时器被关/进程刚起）则兜底补一次
      const stale = Date.now() - (syncState.lastRunMs || 0) > syncCfg.intervalSec * 2000;
      if (syncCfg.auto && force) {
        // 手动刷新：等同步落地再回卡，点一下就能看到 coder/writer 的最新卡
        try { await gitSync('manual'); } catch {}
      } else if (syncCfg.auto && stale) {
        // 自动轮询：同步放后台跑（fetch 一次约 4~5 秒），先回当前卡，不把看板卡住
        gitSync('poll').catch(() => {});
      }
      return json(res, 200, {
        ok: true, cards: loadCards(), git: gitInfo(),
        sync: { ...syncState, running: !!syncInFlight },
        syncIntervalSec: syncCfg.intervalSec, ts: new Date().toISOString(),
      });
    }
    if (p === '/api/sync' && req.method === 'POST') {
      try { await gitSync('manual'); } catch {}
      return json(res, 200, {
        ok: syncState.ok === true, sync: { ...syncState, running: false },
        cards: loadCards(), git: gitInfo(), ts: new Date().toISOString(),
      });
    }

    // ---- v1.2：消息层（notices） ----
    if (p === '/api/notices' && req.method === 'GET') {
      const dir = NOTICES_DIR();
      const items = [];
      try {
        if (existsSync(dir)) {
          for (const f of readdirSync(dir).filter((x) => /^N-[\w-]+\.md$/.test(x)).sort().reverse().slice(0, 50)) {
            const rec = parseNoticeFile(path.join(dir, f));
            if (rec) items.push({ id: rec.id, from: rec.from, to: rec.to, kind: rec.kind, urgency: rec.urgency, scope: rec.scope, status: rec.status, at: rec.at, body: (rec.body || '').slice(0, 400) });
          }
        }
      } catch {}
      return json(res, 200, { items });
    }
    if (p === '/api/notices' && req.method === 'POST') {
      const b = await readBody(req);
      if (b.__badEncoding) return json(res, 400, { ok: false, error: '请求内容编码损坏（非 UTF-8），已拒绝' });
      const to = String(b.to || '').trim();
      if (!['modeler', 'coder', 'writer', 'all'].includes(to)) return json(res, 400, { ok: false, error: `非法收件方: ${to}（modeler|coder|writer|all）` });
      // 权限：Master 可对任意端；Slave 只能对 Modeler
      if (role !== 'modeler' && to !== 'modeler') return json(res, 403, { ok: false, error: 'Slave 端只能向 Modeler 发送消息' });
      const kind = ['ruling', 'error', 'stop', 'info'].includes(String(b.kind)) ? String(b.kind) : 'info';
      const urgency = b.urgency === 'urgent' ? 'urgent' : 'normal';
      const scope = String(b.scope || '').trim();
      const body = String(b.body || '').trim();
      if (!body) return json(res, 400, { ok: false, error: 'body 必填' });
      const dir = NOTICES_DIR();
      mkdirSync(dir, { recursive: true });
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const id = 'N-' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + '-' + Math.random().toString(36).slice(2, 4);
      const rec = { id, from: role, to, kind, urgency, scope, status: 'pending', at: now.toISOString() };
      const text = '---\n' + Object.entries(rec).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\n## 正文\n' + body + '\n';
      writeFileSync(path.join(dir, id + '.md'), text);
      return json(res, 200, { ok: true, id });
    }
    if (p === '/api/notices/ack' && req.method === 'POST') {
      const b = await readBody(req);
      const id = String(b.id || '');
      if (!/^N-[\w-]+$/.test(id)) return json(res, 400, { ok: false, error: '非法消息 id' });
      const fp = path.join(NOTICES_DIR(), id + '.md');
      if (!existsSync(fp)) return json(res, 404, { ok: false, error: `消息不存在: ${id}` });
      const rec = parseNoticeFile(fp);
      if (rec && rec.to !== role && rec.to !== 'all' && role !== 'modeler') return json(res, 403, { ok: false, error: '仅收件方可回执' });
      let t = readFileSync(fp, 'utf8');
      t = t.replace(/^status: .*$/m, 'status: acked');
      if (!/^ackedAt: /m.test(t)) t = t.replace(/^(status: .*)$/m, (line0) => line0 + '\nackedAt: ' + new Date().toISOString() + '\nackedBy: ' + role);
      writeFileSync(fp, t);
      return json(res, 200, { ok: true });
    }

    // ---- v1.2：独立审计（W4） ----
    if (p === '/api/audit' && req.method === 'POST') {
      const b = await readBody(req);
      if (b.__badEncoding) return json(res, 400, { ok: false, error: '请求内容编码损坏（非 UTF-8）', rawLen: b.rawLen, rawHead: b.rawHead });
      if (b.__parseFail) return json(res, 400, { ok: false, error: '请求体解析失败', rawLen: b.rawLen, rawHead: b.rawHead });
      const dim = ['model', 'code', 'paper'].includes(String(b.dimension)) ? String(b.dimension) : '';
      if (!dim) return json(res, 400, { ok: false, error: '非法审计维度（model|code|paper）' });
      if (auditState.running) return json(res, 409, { ok: false, error: '已有审计在运行（本端串行执行）' });
      const dry = await runAuditCli(dim, { dryRun: true, model: b.model, note: b.note });
      if (!dry.ok) return json(res, 400, { ok: false, error: dry.error || '材料预检失败' });
      if (dry.estFee > (dry.limit || 30) && !b.confirm) {
        return json(res, 200, { ok: false, needsConfirm: true, est: { estFee: dry.estFee, estTokens: dry.estTokens, chars: dry.chars, files: dry.files } });
      }
      auditState.running = true;
      auditState.id = 'AUD-' + Date.now().toString(36);
      auditState.dimension = dim;
      auditState.startedAt = new Date().toISOString();
      auditState.result = null;
      const aid = auditState.id;
      runAuditCli(dim, { confirm: !!b.confirm, model: b.model, note: b.note }).then((r) => {
        auditState.running = false;
        auditState.result = r;
        if (r && r.ok && r.reportPath) {
          // 通知（T3.1 联动）：审计报告就绪 → notices 一条给 modeler
          try {
            const dir = NOTICES_DIR();
            mkdirSync(dir, { recursive: true });
            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const nid = 'N-' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + '-' + Math.random().toString(36).slice(2, 4);
            const rec = { id: nid, from: role, to: 'modeler', kind: 'info', urgency: 'normal', scope: '', status: 'pending', at: now.toISOString() };
            const text = '---\n' + Object.entries(rec).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\n## 正文\nReviewer 审阅（' + dim + '）完成：报告 ' + r.reportPath + '（耗时 ' + r.elapsedS + 's，估算 ¥' + r.estFee + '）\n';
            writeFileSync(path.join(dir, nid + '.md'), text);
            auditState.result = { ...r, notice: nid };
          } catch {}
        }
      });
      return json(res, 200, { ok: true, started: true, id: aid, dimension: dim });
    }
    if (p === '/api/audit/status' && req.method === 'GET') {
      return json(res, 200, { ...auditState });
    }

    // ---- v1.2 T5.4：桥健康代理（面板展示上游额度/鉴权状态） ----
    if (p === '/api/bridge/health' && req.method === 'GET') {
      try {
        const r = await fetch('http://127.0.0.1:3220/health', { signal: AbortSignal.timeout(3000) });
        const j = await r.json();
        return json(res, 200, { ok: true, bridge: j });
      } catch (e) {
        return json(res, 200, { ok: false, error: '桥不可达（未运行或已换端口）', detail: String((e && e.message) || e).slice(0, 200) });
      }
    }

    // ---- v1.2.x：Reviewer 配置读写（settings.yaml 的 reviewer 段 + credentials 的 key） ----
    if (p === '/api/audit/config' && req.method === 'GET') {
      if (Date.now() - reviewerCfgCache.at < 30000 && reviewerCfgCache.data) return json(res, 200, reviewerCfgCache.data);
      const runner = findAuditRunner();
      if (!runner) return json(res, 200, { ok: false, error: '未找到 audit-run.mjs（配置 coreDir）' });
      const r2 = spawnSync(process.execPath, [runner, '--show-config'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
      let cfg = null;
      try { cfg = JSON.parse((r2.stdout || '').trim()); } catch {}
      const data = cfg ? { ok: true, ...cfg } : { ok: false, error: ('解析失败: ' + String(r2.stderr || r2.stdout || '').trim()).slice(0, 220) };
      reviewerCfgCache = { at: Date.now(), data };
      return json(res, 200, data);
    }
    if (p === '/api/audit/config' && req.method === 'PUT') {
      try {
        const b = await readBody(req);
        const mmcasHome = process.env.MMCAS_HOME || path.join(os.homedir(), 'AppData', 'Local', 'mmcas');
        const settingsPath = path.join(mmcasHome, 'dsh-home', 'settings.yaml');
        const credPath = path.join(mmcasHome, 'dsh-home', '.credentials.yaml');
        const cur = reviewerSection(settingsPath) || {};
        const nxt = {
          endpoint: b.endpoint !== undefined ? String(b.endpoint).trim() : (cur.endpoint || 'http://127.0.0.1:3220/v1/responses'),
          apiKeyEnv: b.apiKeyEnv !== undefined ? String(b.apiKeyEnv).trim() : (cur.apiKeyEnv || 'REVIEWER_API_KEY'),
          model: b.model !== undefined ? String(b.model).trim() : (cur.model || 'gpt-6-astra'),
          protocol: String(b.protocol !== undefined ? b.protocol : (cur.protocol || 'responses')) === 'chat' ? 'chat' : 'responses',
          maxFeeCny: Number(b.maxFeeCny !== undefined ? b.maxFeeCny : (cur.maxFeeCny || 30)) || 30,
        };
        const okWrite = writeReviewerSection(settingsPath, nxt);
        if (!okWrite) return json(res, 500, { ok: false, error: 'settings.yaml 写入失败' });
        if (b.apiKey && String(b.apiKey).trim()) {
          const k = String(b.apiKey).trim();
          let c = existsSync(credPath) ? readFileSync(credPath, 'utf8') : 'version: 1\nrefs:\n';
          if (/REVIEWER_API_KEY\s*:/.test(c)) c = c.replace(/(REVIEWER_API_KEY\s*:\s*)([^\r\n]+)/, (mm, p1) => p1 + k);
          else if (/^refs:\s*$/m.test(c)) c = c.replace(/^refs:\s*$/m, 'refs:\n  REVIEWER_API_KEY: ' + k);
          else c = c.trimEnd() + '\nrefs:\n  REVIEWER_API_KEY: ' + k + '\n';
          writeFileSync(credPath, c);
        }
        reviewerCfgCache = { at: 0, data: null };
        return json(res, 200, { ok: true });
      } catch (e) {
        return json(res, 500, { ok: false, error: String((e && e.message) || e).slice(0, 220) });
      }
    }

    // ---- v1.2：回程卡（coder/writer → modeler 受限建卡通道，T3.3） ----
    if (p === '/api/backcard' && req.method === 'POST') {
      if (!['coder', 'writer'].includes(role)) return json(res, 403, { ok: false, error: '回程卡仅 coder/writer 端可创建' });
      const b = await readBody(req);
      if (b.__badEncoding) return json(res, 400, { ok: false, error: '请求内容编码损坏（非 UTF-8），已拒绝' });
      const title = String(b.title || '').trim();
      const desc = String(b.desc || '').trim();
      const evidence = String(b.evidence || '').trim();
      if (!title) return json(res, 400, { ok: false, error: 'title 必填' });
      mkdirSync(tasksDir(), { recursive: true });
      const cards = loadCards();
      const nums = cards.map((c) => parseInt(c.id.replace(/\D/g, ''), 10) || 0);
      const id = `T-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
      const today = new Date().toISOString().slice(0, 10);
      const card = `---\nid: ${id}\ntitle: ${title}\nstatus: todo\nowner: modeler\npriority: P1\ncreated: ${today}\nupdated: ${today}\ndeps: []\norigin: ${role}\n---\n## 问题描述\n${desc || title}\n\n## 证据引用\n${evidence || '（待补充）'}\n\n## 进度记录\n\n## 批注\n`;
      writeFileSync(cardFile(id), card);
      return json(res, 200, { ok: true, id });
    }

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
      let transitionWarning = '';
      if (b.status && b.status !== card.status) {
        const r = checkTransition(card, b.status, { reason: b.reason });
        if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
        if (r.warning) transitionWarning = r.warning;
        text = text.replace(/^status: .*$/m, `status: ${b.status}`).replace(/^updated: .*$/m, `updated: ${new Date().toISOString().slice(0, 10)}`);
        // v1.2：打回（done→todo）——原因入批注 + rework 计数 + 允许重新派发（清 notified）
        if (card.status === 'done' && b.status === 'todo') {
          text = appendReworkNote(text, String(b.reason || '').trim());
          text = bumpRework(text);
          notified.delete(card.id);
        }
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
      return json(res, 200, Object.assign({ ok: true }, transitionWarning ? { warning: transitionWarning } : {}));
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

    // ---- 任务轮询器开关（自动接取 + 派发） ----
    if (p === '/api/poller' && req.method === 'GET') {
      return json(res, 200, { ...poller, notified: [...notified] });
    }
    if (p === '/api/poller' && req.method === 'POST') {
      const b = await readBody(req);
      if (typeof b.enabled === 'boolean') poller.enabled = b.enabled;
      if (typeof b.autoClaim === 'boolean') poller.autoClaim = b.autoClaim;
      if (b.intervalSec) poller.intervalSec = Math.min(Math.max(Number(b.intervalSec) || 120, 30), 600);
      if (b.claimStaleMin !== undefined) poller.claimStaleMin = Math.max(Number(b.claimStaleMin) || 0, 0);
      if (b.targetSessionId !== undefined) poller.targetSessionId = String(b.targetSessionId || '');
      savePoller();
      acquirePollerLock();   // v1.2：开关操作时重试获取锁（主实例退出后本实例可接管）
      applyPollerState();
      return json(res, 200, { ok: true, enabled: poller.enabled, intervalSec: poller.intervalSec,
        autoClaim: poller.autoClaim, claimStaleMin: poller.claimStaleMin,
        targetSessionId: poller.targetSessionId });
    }
    // 手动踢一脚：立刻跑一个 tick（diagnostics + "不想等 120 秒"）
    if (p === '/api/poller/now' && req.method === 'POST') {
      const tick = await tickPoller(true);
      return json(res, 200, { ok: true, tick });
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
  if (ctx && typeof ctx.on === 'function') ctx.on('dispose', () => {
    if (syncTimer) clearInterval(syncTimer);
    if (pollerTimer) clearInterval(pollerTimer);
    releasePollerLock();
    server.close();
  });
  return { collectState, gitSync };
}
