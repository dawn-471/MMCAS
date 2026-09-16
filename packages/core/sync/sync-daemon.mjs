#!/usr/bin/env node
/**
 * MMCAS sync daemon v0.2
 *
 * 轮询式 git 同步守护：本地变更自动 commit+push，定时 pull 远端更新。
 * 原则：冲突/网络失败绝不静默处理——标记状态、退避重试、等待人类介入。
 *
 * ── v0.2 变更（2026-09-11 事故驱动，维护者确认）────────────────────────────
 * 事故（`621292d` 解冲突那次）复盘出的两个真实缺口：
 *
 *  ① **未解决冲突时仍会 `git add -A` + commit**。`git add` 在 UU 文件上的语义是
 *     "**以工作区当前内容标记该冲突已解决**"，于是 `commitLocal()` 会把**冲突标记直接提交进历史**，
 *     并**静默清掉 UU 状态**。已在临时 scratch 仓库实证：
 *     `git add -A; git commit` 后 `git ls-files -u` 归零、`git show HEAD:file` 返回带 `<<<<<<<` 的内容。
 *     ⇒ 修：`commitLocal()` 开头先查 `hasMergeConflict()`，非空则**拒绝提交、不动 index**。
 *
 *  ② **`conflictMode` 只存在于内存**（v0.1 只把 state 写盘、启动时不读回）。
 *     于是 daemon 若在冲突未解决时重启，下一 tick 就按"正常模式"跑 → 触发上面的①。
 *     ⇒ 修：启动时从 `sync.state.json` 读回 `mode === 'conflict'`。
 *
 *  ③ **对将要入库的内容零检查**。乱码文件（UTF-8 被按 GBK 重解码）就这样被自动提交，
 *     并成为后续 merge 的 base，污染向上游传播（实例：`t039_q4_eval.py` 32 079 B 乱码版、
 *     `a_problem/a_shrink_dbg.py:77` 的 U+FE3C）。
 *     ⇒ 修：新增**入库前体检** `healthCheck()`，在 `git add` **之前**扫描
 *     `git status --porcelain` 列出的待提交文本文件：
 *       - **硬拦截（零误报判定）**：同时出现 `<<<<<<< ` 与 `>>>>>>> ` 行（成对才是真冲突标记，
 *         避开 markdown 里合法的 `=======` 下划线）；或出现非法码点 U+FFFD / U+FE30–FE4F
 *         （`a_shrink_dbg.py` 的 U+FE3C 就在此区间）。
 *       - **告警（不拦截）**：GBK 乱码签名汉字命中 ≥3 次（启发式，故只告警；
 *         如需拦截设 `healthCheckBlockMojibake: true`）。
 *     命中即 `mode: 'blocked'`，**不动 index、不 push**，等人工处理，日志一次性打点不刷屏。
 *
 * 零 npm 依赖，Node >= 18。
 * 用法：node sync-daemon.mjs [--config <path>]
 * 配置默认：~/.mmcas/sync.config.json
 *
 * ── v0.2.1 收紧（自查发现的自伤）────────────────────────────────────────
 * v0.2 把"非法码点"一律硬拦截，实测**拦到了记录本次事故的文档**
 * （`tasks/T-042.md`、`memory/modeler/2026-09-11-E.md` 里都**引用**了那段含 U+FE3C 的乱码样例）。
 * 一个会把"事故记录"挡在门外的守卫，比没有守卫更糟（它会逼人绕过它）。
 * ⇒ 收紧为：**非法码点在代码文件里硬拦截**（那里不可能是善意的，编译/词法必崩），
 *   在散文/数据文件里**只告警**（可能是引用样例，本项目确实存在）。冲突标记的判定不变（仍然硬拦截）。
 *   v1.2 结案：数据类按扩展名豁免——JSON/JSONL/CSV 等文件即使在代码目录下（如工具日志）也只告警（见 CODE_EXT 注释）。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const MMCAS_DIR = path.join(HOME, '.mmcas');

// ---------- 配置 ----------
function loadConfig() {
  const argIdx = process.argv.indexOf('--config');
  const cfgPath = argIdx !== -1 && process.argv[argIdx + 1]
    ? process.argv[argIdx + 1]
    : path.join(MMCAS_DIR, 'sync.config.json');

  if (!existsSync(cfgPath)) {
    console.error(`[mmcas-sync] 缺少配置文件: ${cfgPath}`);
    console.error(`[mmcas-sync] 示例内容见 packages/core/config/sync.config.example.json`);
    process.exit(2);
  }
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  if (!cfg.repoDir) {
    console.error('[mmcas-sync] 配置缺少 repoDir（工作区仓本地路径）');
    process.exit(2);
  }
  // 防御：Windows 用户手写配置常带反斜杠，统一归一为正斜杠
  for (const k of ['repoDir', 'gitBin', 'logDir']) {
    if (typeof cfg[k] === 'string') cfg[k] = cfg[k].replace(/\\/g, '/');
  }
  return {
    repoDir: cfg.repoDir,
    gitBin: cfg.gitBin || 'git',
    pullIntervalSec: cfg.pullIntervalSec ?? 60,
    idleWaitSec: cfg.idleWaitSec ?? 10,
    conflictRetrySec: cfg.conflictRetrySec ?? 300,
    pushMaxRetries: cfg.pushMaxRetries ?? 5,
    authorName: cfg.authorName || 'mmcas-agent',
    authorEmail: cfg.authorEmail || 'agent@mmcas.local',
    remote: cfg.remote || 'origin',
    branch: cfg.branch || 'main',
    logDir: cfg.logDir || path.join(MMCAS_DIR, 'logs'),
    // v0.2：入库前体检（默认开；显式 false 才关）
    healthCheck: cfg.healthCheck !== false,
    healthCheckBlockMojibake: cfg.healthCheckBlockMojibake === true,
    healthCheckMaxFileMB: cfg.healthCheckMaxFileMB ?? 32,
  };
}

// ---------- 基础设施 ----------
const cfg = loadConfig();
mkdirSync(cfg.logDir, { recursive: true });
const LOG_PATH = path.join(cfg.logDir, 'sync.log');
const STATE_PATH = path.join(cfg.logDir, 'sync.state.json');
const LOCK_PATH = path.join(cfg.logDir, 'sync.lock');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_PATH, line + '\n');
}

function setState(s) {
  writeFileSync(STATE_PATH, JSON.stringify({ ...s, at: new Date().toISOString() }, null, 2));
}

// v0.2：读回上次的运行模式（冲突模式必须跨重启保持，否则重启即触发"标记入库"剧本）
function readState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// v1.2 T5.3：心跳——主循环每轮刷新状态文件（面板看门狗据新鲜度判断 daemon 存活）
function heartbeat() {
  try {
    const prev = readState() || {};
    setState({ ...prev, lastHeartbeat: new Date().toISOString() });
  } catch { /* 心跳失败不致命 */ }
}

// 单实例锁（含 stale 检测：异常退出留下的锁，若持有进程已不存在则自动接管）
// 修复记录（2026-09-09）：原实现 unlink 失败被静默吞掉 → 接管时重建锁必报 EEXIST 退出，
// daemon 异常退出后再也无法自愈（真实事故：writer 端 push 重试后进程退出，重启卡死）。
// 现在：unlink 失败显式报错 + 「删除+重建」重试 5 次；kill 仅 ESRCH 视为过期（EPERM=进程存活）。
function createLock() {
  const fd = openSync(LOCK_PATH, 'wx');
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
}

function lockHolderAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e && e.code === 'ESRCH') return false; // 进程不存在 → 过期锁
    return true; // EPERM 等：进程存在但无权限探测 → 视为存活，保守不抢
  }
}

async function acquireLock() {
  try {
    createLock();
    return;
  } catch {
    // 锁文件已存在——进入过期判定
  }
  let stale = false;
  try {
    const pid = parseInt(readFileSync(LOCK_PATH, 'utf8').trim(), 10);
    stale = !Number.isInteger(pid) || pid <= 0 || !lockHolderAlive(pid);
  } catch {
    stale = true; // 锁文件不可读 → 视为过期
  }
  if (!stale) {
    console.error('[mmcas-sync] 已有实例在运行（sync.lock 存在且进程存活），退出。');
    process.exit(1);
  }
  console.error('[mmcas-sync] 检测到过期锁（持有进程已退出），尝试接管...');
  for (let i = 1; i <= 5; i++) {
    try {
      unlinkSync(LOCK_PATH);
    } catch (e) {
      console.error(`[mmcas-sync] 删除过期锁失败（第 ${i}/5 次）: ${e.code || e.message}`);
    }
    try {
      createLock();
      console.error('[mmcas-sync] 已接管锁，继续。');
      return;
    } catch (e) {
      if (i === 5) {
        console.error(`[mmcas-sync] 接管锁失败（已重试 5 次）: ${e.code || e.message}；请手动删除 ${LOCK_PATH} 后重启`);
        process.exit(1);
      }
    }
    await sleep(1000);
  }
}

function runGit(args) {
  return new Promise((resolve) => {
    const p = spawn(cfg.gitBin, args, { cwd: cfg.repoDir, windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code: code ?? -1, out, err }));
  });
}

// ---------- git 操作 ----------
async function gitStatus() {
  const r = await runGit(['status', '--porcelain']);
  return r.code === 0 ? r.out : null;
}

async function hasMergeConflict() {
  const r = await runGit(['ls-files', '-u']);
  return r.code === 0 && r.out.trim().length > 0;
}

// ---------- 入库前体检（v0.2） ----------
// GBK 乱码签名汉字（UTF-8 字节被按 GBK 重解码后的产物）。用 \u 转义书写，
// 避免本文件自身被乱码吞掉后"检测器静默失效"。
// 锛鈥鐨涓鍒鏄绾鍏绫鈽鍚妫娴鐗鐢
const MOJIBAKE_RE = /[\u951B\u9225\u9428\u6D93\u9352\u93C4\u7EFE\u934F\u7EEB\u923D\u935A\u59AB\u5A34\u9417\u9422]/g;
// 非法码点：U+FFFD 替换字符；U+FE30–FE4F CJK 兼容形式（含 a_shrink_dbg.py 的 U+FE3C）
const BAD_CODEPOINT_RE = /[\uFFFD\uFE30-\uFE4F]/g;

const TEXT_EXT = new Set([
  '.py', '.md', '.json', '.jsonl', '.tex', '.txt', '.csv', '.tsv',
  '.mjs', '.cjs', '.js', '.ts', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.bat', '.ps1', '.sh',
]);

// v0.2.1：非法码点只有落在**代码**里才硬拦截（散文/数据可能是在引用事故样例）
// v1.2 结案（回应队友端边界疑问）：数据文件按扩展名豁免——.json/.jsonl/.csv 等不在本表，
// 代码目录下的 JSON 日志（如归档/重压工具日志）只告警、不会冻结同步轮。测试锁定：test-sync-daemon-detector.mjs [6] / guard.ps1 B5。
const CODE_EXT = new Set([
  '.py', '.mjs', '.cjs', '.js', '.ts', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.bat', '.ps1', '.sh',
]);

async function changedFiles() {
  const r = await runGit(['status', '--porcelain', '--untracked-files=all']);
  if (r.code !== 0) return null;
  const files = [];
  for (const line of r.out.split('\n')) {
    if (!line.trim()) continue;
    let p = line.slice(3).trim();
    const arrow = p.indexOf(' -> ');
    if (arrow !== -1) p = p.slice(arrow + 4); // 重命名取新名
    p = p.replace(/^"(.*)"$/, '$1');
    if (p) files.push(p);
  }
  return files;
}

function scanFile(file) {
  const abs = path.join(cfg.repoDir, file);
  const isCode = CODE_EXT.has(path.extname(file).toLowerCase());
  let buf;
  try {
    const st = statSync(abs);
    if (!st.isFile()) return null;
    if (st.size > cfg.healthCheckMaxFileMB * 1024 * 1024) return { skipped: `>${cfg.healthCheckMaxFileMB}MB` };
    buf = readFileSync(abs);
  } catch {
    return null; // 已删除/无权限：交给 git 自己报错
  }
  if (buf.includes(0)) return null; // 二进制
  const text = buf.toString('utf8');

  const blocks = [];
  const warns = [];

  // ① 冲突标记：**成对**出现才算（`<<<<<<< ` 与 `>>>>>>> `），避开 markdown 的 `=======` 下划线
  const hasOpen = /^<{7}[ \t]/m.test(text);
  const hasClose = /^>{7}[ \t]/m.test(text);
  if (hasOpen && hasClose) blocks.push('含成对冲突标记（<<<<<<< / >>>>>>>）');

  // ② 非法码点：代码文件里必定是缺陷 ⇒ 硬拦截；散文/数据里可能是引用样例 ⇒ 只告警
  const bad = text.match(BAD_CODEPOINT_RE);
  if (bad) {
    const cps = [...new Set(bad.map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')))];
    const msg = `含非法码点 ${cps.slice(0, 4).join(' ')}（共 ${bad.length} 处）`;
    if (isCode) blocks.push(msg);
    else warns.push(msg + '（非代码文件，仅告警）');
  }

  // ③ GBK 乱码签名（启发式 → 默认只告警）
  const moj = text.match(MOJIBAKE_RE);
  if (moj && moj.length >= 3) {
    warns.push(`疑似 GBK 乱码签名 ${moj.length} 处`);
  }

  if (blocks.length === 0 && warns.length === 0) return null;
  return { file, blocks, warns };
}

async function healthCheck() {
  if (!cfg.healthCheck) return { ok: true, skipped: true };
  const files = await changedFiles();
  if (files === null) return { ok: true, note: 'git status 失败，跳过体检' };

  const blockHits = [];
  const warnHits = [];
  let scanned = 0;
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (ext && !TEXT_EXT.has(ext)) continue;
    const r = scanFile(f);
    if (!r || r.skipped) continue;
    scanned += 1;
    if (r.blocks.length) blockHits.push(`${r.file} :: ${r.blocks.join('；')}`);
    if (r.warns.length) warnHits.push(`${r.file} :: ${r.warns.join('；')}`);
  }

  if (warnHits.length) {
    log(`入库前体检告警（不拦截，仅提示）：${warnHits.join(' | ')}`);
  }
  if (blockHits.length) {
    return { ok: false, msg: `入库前体检拦截 ${blockHits.length} 个文件：${blockHits.join(' | ')}` };
  }
  if (cfg.healthCheckBlockMojibake && warnHits.length) {
    return { ok: false, msg: `入库前体检拦截（mojibake 拦截已开启）：${warnHits.join(' | ')}` };
  }
  return { ok: true, scanned };
}

async function ensureAuthor() {
  await runGit(['config', 'user.name', cfg.authorName]);
  await runGit(['config', 'user.email', cfg.authorEmail]);
}

async function commitLocal() {
  // ★ v0.2 硬守卫：未解决冲突时**绝不**动 index。
  // `git add` 会以工作区内容"标记冲突已解决"，从而把冲突标记提交进历史并静默清掉 UU 状态。
  if (await hasMergeConflict()) {
    return {
      ok: false,
      blocked: true,
      msg: '存在未解决的合并冲突（git ls-files -u 非空）⇒ 拒绝提交、不动 index；请人工解决后自行 git add + git commit',
    };
  }

  const status = await gitStatus();
  if (status === null) return { ok: false, msg: 'git status 失败' };
  if (status.trim() === '') return { ok: true, changed: false };

  // ★ v0.2：体检放在 `git add` **之前** —— 命中则本次不提交，工作区与 index 保持原样
  const hc = await healthCheck();
  if (!hc.ok) return { ok: false, blocked: true, msg: hc.msg };

  await ensureAuthor();
  const add = await runGit(['add', '-A']);
  if (add.code !== 0) return { ok: false, msg: `git add 失败: ${add.err.trim()}` };

  const commit = await runGit([
    'commit', '-m',
    `mmcas-sync: auto commit (${new Date().toISOString().slice(0, 19).replace('T', ' ')})`,
  ]);
  if (commit.code !== 0) return { ok: false, msg: `git commit 失败: ${commit.err.trim()}` };
  return { ok: true, changed: true };
}

async function fetchAndMerge() {
  const f = await runGit(['fetch', cfg.remote, cfg.branch]);
  if (f.code !== 0) {
    // fetch 失败两种可能：网络问题 / 空远端仓无此 ref。二者都不致命：
    // 空仓时 push 会创建分支；网络问题时 push 会退避。交给 push 环节判定。
    return { ok: true, merged: false, note: `fetch 未成功（网络或空仓）: ${f.err.trim().slice(0, 100)}` };
  }
  const m = await runGit(['merge', '--no-edit', 'FETCH_HEAD']);
  if (m.code === 0) return { ok: true, merged: true, note: 'merge 成功' };
  if (await hasMergeConflict()) {
    return { ok: false, conflict: true, msg: `merge 产生冲突: ${m.err.trim().slice(0, 200)}` };
  }
  return { ok: false, conflict: false, msg: `merge 失败: ${m.err.trim().slice(0, 200)}` };
}

async function pushWithBackoff() {
  let attempt = 0;
  while (attempt < cfg.pushMaxRetries) {
    attempt += 1;
    const r = await runGit(['push', cfg.remote, cfg.branch]);
    if (r.code === 0) return { ok: true, msg: 'push 成功' };
    const wait = Math.min(60, 10 * 2 ** (attempt - 1));
    log(`push 失败（第 ${attempt}/${cfg.pushMaxRetries} 次）: ${r.err.trim().slice(0, 120)}，${wait}s 后重试`);
    await sleep(wait * 1000);
  }
  return { ok: false, msg: `push 连续 ${cfg.pushMaxRetries} 次失败，保留本地 commit，等待网络恢复` };
}

// ---------- 主循环 ----------
let conflictMode = false;
let lastBlockMsg = null;

async function tick() {
  if (conflictMode) {
    // 冲突模式：只尝试 fetch+merge（人类可能已在外解决冲突），不自动 commit/push
    const p = await fetchAndMerge();
    if (p.ok) {
      conflictMode = false;
      log('冲突已解除，恢复正常同步。');
      setState({ mode: 'normal', lastEvent: 'conflict-resolved' });
    } else {
      setState({ mode: 'conflict', lastEvent: p.msg });
    }
    return;
  }

  // 1. 提交本地变更
  const c = await commitLocal();
  if (!c.ok) {
    if (c.blocked) {
      // v0.2：把"不提交坏内容/不吞冲突"放在优先级更高的位置 —— 整轮停下，只打点一次不刷屏
      if (lastBlockMsg !== c.msg) {
        log(`!! 入库前把关拦下本轮提交：${c.msg}`);
        lastBlockMsg = c.msg;
      }
      setState({ mode: 'blocked', lastEvent: c.msg });
      return;
    }
    log(`commit 环节异常: ${c.msg}`);
    setState({ mode: 'error', lastEvent: c.msg });
    return;
  }
  lastBlockMsg = null;
  if (c.changed) {
    log('本地变更已提交。');
  }

  // 2. 拉取远端并合并（merge 策略；冲突显式保留，绝不静默处理）
  const m = await fetchAndMerge();
  if (!m.ok) {
    if (m.conflict) {
      conflictMode = true;
      log(`!! 检测到合并冲突，暂停自动提交/push，等待人类介入。${m.msg}`);
      setState({ mode: 'conflict', lastEvent: m.msg });
    } else {
      log(`merge 异常: ${m.msg}`);
      setState({ mode: 'degraded', lastEvent: m.msg });
    }
    return;
  }

  // 3. 推送
  const pushRes = await pushWithBackoff();
  if (pushRes.ok) {
    setState({ mode: 'normal', lastEvent: `synced at ${new Date().toISOString()}` });
  } else {
    setState({ mode: 'degraded', lastEvent: pushRes.msg });
  }
}

async function main() {
  await acquireLock();

  // v0.2：读回上次的运行模式 —— 冲突模式必须跨重启保持
  const prev = readState();
  if (prev && prev.mode === 'conflict') {
    conflictMode = true;
    log('启动时读到 sync.state.json 的 mode=conflict ⇒ 继续暂停自动提交/push（等人工解决冲突）。');
  } else if (prev && prev.mode === 'blocked') {
    log(`启动时读到 mode=blocked（上次被入库前体检拦下）：${prev.lastEvent || ''}`);
  }

  log(`mmcas-sync 启动：repo=${cfg.repoDir} pull间隔=${cfg.pullIntervalSec}s 入库前体检=${cfg.healthCheck ? '开' : '关'}`);
  while (true) {
    const t0 = Date.now();
    try {
      await tick();
    } catch (e) {
      log(`循环异常: ${e.message}`);
      setState({ mode: 'error', lastEvent: String(e.message) });
    }
    const elapsed = Date.now() - t0;
    heartbeat();   // v1.2 T5.3：每轮刷新心跳（面板看门狗依据）
    const wait = conflictMode ? cfg.conflictRetrySec : Math.max(1, cfg.pullIntervalSec - Math.floor(elapsed / 1000));
    await sleep(wait * 1000);
  }
}

process.on('SIGINT', () => {
  log('收到退出信号，结束。');
  process.exit(0);
});

main();
