#!/usr/bin/env node
/**
 * MMCAS panel v3 —— 指挥中心 SPA（本地渲染器，无服务器）
 * 视图: 看板 Kanban / 产物文件树 / 设备状态 / 记忆时间线 / 聊天入口
 * 设计语言: 跟随宿主 dsh 主题的卡片体系（CSS 变量驱动，明暗自适应）
 *
 * 用法: node panel.mjs --workspace <工作区路径> [--out <panel.html>] [--dsh-url <带token地址>]
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}
const WS = arg('workspace') || path.join(process.cwd(), 'workspace');
const OUT = arg('out') || path.join(WS, '..', 'panel.html');
const DSH_URL = arg('dsh-url') || '';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- 数据采集 ----------
function parseCard(file) {
  const text = readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.split(':');
    if (kv.length >= 2) fm[kv[0].trim()] = kv.slice(1).join(':').trim();
  }
  return { ...fm, id: fm.id || path.basename(file, '.md') };
}
function loadCards(tasksDir) {
  if (!existsSync(tasksDir)) return [];
  return readdirSync(tasksDir).filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => parseCard(path.join(tasksDir, f))).filter(Boolean);
}

function gitInfo() {
  const r = spawnSync('git', ['-C', WS, 'log', '--pretty=format:%h|%an|%s', '-n', '10'], { encoding: 'utf8', windowsHide: true });
  const log = r.status === 0 ? r.stdout.trim().split('\n').filter(Boolean) : [];
  const b = spawnSync('git', ['-C', WS, 'status', '-sb', '--porcelain'], { encoding: 'utf8', windowsHide: true });
  const br = b.status === 0 ? (b.stdout.split('\n')[0] || '') : '';
  const beh = spawnSync('git', ['-C', WS, 'rev-list', '--left-right', '--count', 'origin/main...HEAD'], { encoding: 'utf8', windowsHide: true });
  let ahead = 0, behind = 0;
  if (beh.status === 0) {
    const [bh, ah] = beh.stdout.trim().split(/\s+/).map(Number);
    behind = bh || 0; ahead = ah || 0;
  }
  return { log, branch: br, ahead, behind };
}

function devices() {
  const r = spawnSync('C:/Program Files/Tailscale/tailscale.exe', ['status', '--json'], { encoding: 'utf8', windowsHide: true });
  const out = { modeler: { name: '建模手 · 本机', online: true } };
  if (r.status !== 0) return out;
  try {
    const j = JSON.parse(r.stdout);
    out.modeler.ip = j.Self?.TailscaleIPs?.[0] || '';
    for (const peer of Object.values(j.Peer || {})) {
      const name = (peer.HostName || '').toLowerCase();
      if (name.startsWith('mmcas-')) {
        out[name.replace('mmcas-', '')] = { name: name.replace('mmcas-', ''), online: peer.Online, ip: peer.TailscaleIPs?.[0] || '' };
      }
    }
  } catch {}
  return out;
}

function walkTree(dir, depth, maxDepth) {
  if (depth > maxDepth || !existsSync(dir)) return [];
  const out = [];
  try {
    for (const f of readdirSync(dir)) {
      if (f === '.git' || f === 'README.md' && depth === 0) continue;
      const full = path.join(dir, f);
      let isDir = false;
      try { isDir = statSync(full).isDirectory(); } catch {}
      out.push({ name: f, dir: isDir, children: isDir && depth < maxDepth ? walkTree(full, depth + 1, maxDepth) : [] });
    }
  } catch {}
  return out;
}
function treeHtml(nodes, indent) {
  return nodes.map((n) => {
    const pad = `style="padding-left:${indent * 14}px"`;
    if (n.dir) {
      return `<div class="tree-row dir" ${pad}><span class="tw">▾</span>${esc(n.name)}</div>` +
        treeHtml(n.children || [], indent + 1);
    }
    return `<div class="tree-row file" ${pad}><span class="tw">·</span>${esc(n.name)}</div>`;
  }).join('');
}

function memoryEntries() {
  const root = path.join(WS, 'memory');
  const out = [];
  if (!existsSync(root)) return out;
  for (const role of ['modeler', 'coder', 'writer']) {
    const dir = path.join(root, role);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort().reverse();
    for (const f of files.slice(0, 2)) {
      const text = readFileSync(path.join(dir, f), 'utf8');
      const entries = text.split(/\n## /).slice(1);
      for (const e of entries) {
        const [stamp, ...body] = e.split('\n');
        out.push({ role, date: f.replace('.md', ''), time: stamp.trim(), body: body.join(' ').trim().slice(0, 160) });
      }
    }
  }
  return out.slice(-12).reverse();
}

// ---------- 采集 ----------
const cards = loadCards(path.join(WS, 'tasks'));
const git = gitInfo();
const devs = devices();
const mems = memoryEntries();
const tree = walkTree(path.join(WS, 'workspace'), 0, 3);

const COLS = [
  ['todo', '待办', '#8a94a6'], ['doing', '进行中', '#4da3ff'], ['blocked', '阻塞', '#ff7d6b'],
  ['review', '待批准', '#ffb84d'], ['done', '完成', '#5fd38a'],
];
const ROLE_INITIAL = { modeler: 'M', coder: 'C', writer: 'W' };

const boardHtml = COLS.map(([st, label, color]) => {
  const items = cards.filter((c) => c.status === st);
  const html = items.map((c) => `
    <div class="kcard">
      <div class="kcard-top">
        <span class="kid">${esc(c.id)}</span>
        <span class="owner" style="background:${ROLE_INITIAL[c.owner] === 'M' ? '#4da3ff' : ROLE_INITIAL[c.owner] === 'C' ? '#9c6bff' : '#5fd38a'}22;color:${ROLE_INITIAL[c.owner] === 'M' ? '#4da3ff' : ROLE_INITIAL[c.owner] === 'C' ? '#9c6bff' : '#5fd38a'}">${ROLE_INITIAL[c.owner] || '?'}</span>
      </div>
      <div class="ktitle">${esc(c.title || '（无标题）')}</div>
      <div class="kmeta">${esc(c.updated || c.created || '')}${c.approval === 'required' ? ' · <span class="approve">需审批</span>' : ''}${c.deps ? ` · 依赖 ${esc(c.deps)}` : ''}</div>
    </div>`).join('');
  return `
  <section class="kcol">
    <header class="kcol-head"><span class="dot" style="background:${color}"></span>${label}<span class="count">${items.length}</span></header>
    <div class="kcol-body">${html || '<div class="empty">暂无</div>'}</div>
  </section>`;
}).join('');

const devHtml = Object.entries(devs).map(([role, d]) => `
  <div class="devcard">
    <span class="pulse ${d.online ? 'on' : 'off'}"></span>
    <div>
      <div class="devname">${esc(d.name || role)}</div>
      <div class="devmeta">${esc(d.ip || '未上线')} · ${d.online ? '在线' : '离线'}</div>
    </div>
  </div>`).join('');

const memHtml = mems.map((m) => `
  <div class="memrow">
    <span class="owner" style="min-width:24px;background:${m.role === 'modeler' ? '#4da3ff' : m.role === 'coder' ? '#9c6bff' : '#5fd38a'}22;color:${m.role === 'modeler' ? '#4da3ff' : m.role === 'coder' ? '#9c6bff' : '#5fd38a'}">${ROLE_INITIAL[m.role] || '?'}</span>
    <div>
      <div class="memtext">${esc(m.body)}</div>
      <div class="devmeta">${esc(m.date)} ${esc(m.time)}</div>
    </div>
  </div>`).join('') || '<div class="empty">暂无记忆条目</div>';

const gitHtml = git.log.map((l) => {
  const [h, a, ...s] = l.split('|');
  return `<div class="git-row"><span class="hash">${esc(h)}</span><span class="author">${esc(a)}</span><span class="gitsubj">${esc(s.join('|'))}</span></div>`;
}).join('') || '<div class="empty">暂无提交</div>';

const syncBadge = git.ahead > 0 || git.behind > 0
  ? `<span class="sync-warn">↑${git.ahead} ↓${git.behind}</span>`
  : '<span class="sync-ok">已同步</span>';

const treeHtmlOut = treeHtml(tree, 0) || '<div class="empty">workspace 目录为空</div>';

// ---------- SPA ----------
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>MMCAS 指挥中心</title>
<style>
  :root {
    --fg: var(--foreground, #e8eaf0); --muted: var(--muted-foreground, #8a94a6);
    --accent: var(--accent, #4da3ff); --card: var(--card, #171a22);
    --border: var(--border, #262b38); --bg: transparent;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body { font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: var(--fg); background: var(--bg); overflow: hidden; }
  .app { display: flex; height: 100vh; }

  /* 侧边导航 rail（dsh 风格） */
  .rail { width: 60px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 0; border-right: 1px solid var(--border); }
  .rail .logo { width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg, #4da3ff, #9c6bff); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; color: #fff; margin-bottom: 14px; }
  .navbtn { width: 42px; height: 42px; border: none; border-radius: 12px; background: transparent; color: var(--muted); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .15s; }
  .navbtn:hover { background: var(--border); color: var(--fg); }
  .navbtn.active { background: var(--accent); color: #fff; }
  .navbtn svg { width: 19px; height: 19px; }

  /* 主区 */
  .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .topbar { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--border); }
  .topbar h1 { font-size: 15px; font-weight: 600; letter-spacing: .02em; }
  .spacer { flex: 1; }
  .chip { font-size: 11.5px; padding: 4px 10px; border-radius: 20px; border: 1px solid var(--border); color: var(--muted); }
  .sync-ok { color: #5fd38a; } .sync-warn { color: #ffb84d; }

  .view { flex: 1; overflow-y: auto; padding: 16px 18px; display: none; }
  .view.active { display: block; }

  /* Kanban */
  .kanban { display: grid; grid-template-columns: repeat(5, minmax(180px, 1fr)); gap: 12px; height: 100%; align-items: start; }
  .kcol { background: var(--card); border: 1px solid var(--border); border-radius: 14px; display: flex; flex-direction: column; max-height: 100%; overflow: hidden; }
  .kcol-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 12px 14px; font-size: 13px; font-weight: 600; border-bottom: 1px solid var(--border); }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .count { margin-left: auto; color: var(--muted); font-weight: 400; font-size: 12px; }
  .kcol-body { padding: 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .kcard { background: rgba(255,255,255,.025); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; transition: border-color .15s, transform .15s; }
  .kcard:hover { border-color: var(--accent); transform: translateY(-1px); }
  .kcard-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .kid { font-family: Consolas, monospace; font-size: 11px; color: var(--muted); }
  .owner { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; flex: none; }
  .ktitle { font-size: 13px; font-weight: 500; line-height: 1.4; }
  .kmeta { font-size: 11px; color: var(--muted); margin-top: 6px; }
  .approve { color: #ffb84d; }

  /* 产物树 */
  .tree { font-family: Consolas, "Microsoft YaHei", monospace; font-size: 12.5px; line-height: 2; }
  .tree-row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-radius: 6px; }
  .tree-row:hover { background: rgba(255,255,255,.04); }
  .tree-row.dir { color: var(--fg); font-weight: 500; }
  .tree-row.file { color: var(--muted); }
  .tw { display: inline-block; width: 18px; color: var(--accent); }

  /* 设备 */
  .devgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .devcard { display: flex; align-items: center; gap: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
  .pulse { width: 10px; height: 10px; border-radius: 50%; flex: none; }
  .pulse.on { background: #5fd38a; box-shadow: 0 0 0 4px rgba(95,211,138,.15); }
  .pulse.off { background: #ff7d6b; box-shadow: 0 0 0 4px rgba(255,125,107,.12); }
  .devname { font-size: 13.5px; font-weight: 600; }
  .devmeta { font-size: 11.5px; color: var(--muted); margin-top: 2px; }

  /* 记忆 */
  .memrow { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px dashed var(--border); align-items: flex-start; }
  .memtext { font-size: 13px; line-height: 1.5; }

  /* 聊天入口 */
  .chatcard { max-width: 520px; margin: 40px auto; text-align: center; background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 36px 28px; }
  .chatcard h2 { font-size: 16px; margin-bottom: 8px; }
  .chatcard p { font-size: 13px; color: var(--muted); line-height: 1.6; margin-bottom: 20px; }
  .btn { display: inline-block; background: var(--accent); color: #fff; border: none; border-radius: 10px; padding: 10px 22px; font-size: 13.5px; font-weight: 600; cursor: pointer; text-decoration: none; transition: filter .15s; }
  .btn:hover { filter: brightness(1.12); }

  /* git */
  .git-row { display: flex; gap: 12px; font-family: Consolas, monospace; font-size: 12px; padding: 6px 0; border-bottom: 1px dashed var(--border); }
  .hash { color: var(--accent); flex: none; width: 64px; }
  .author { color: var(--muted); flex: none; width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gitsubj { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: var(--muted); font-size: 12.5px; padding: 8px 0; }
  .sec-title { font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: .08em; margin: 18px 0 8px; }
</style>
</head>
<body>
<div class="app">
  <nav class="rail">
    <div class="logo">M</div>
    <button class="navbtn active" data-view="kanban" title="任务看板"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="14" rx="2"/><rect x="14" y="3" width="7" height="9" rx="2"/><rect x="14" y="16" width="7" height="5" rx="2"/></svg></button>
    <button class="navbtn" data-view="files" title="产物"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg></button>
    <button class="navbtn" data-view="devices" title="设备"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="16" height="10" rx="2"/><path d="M8 19h8M12 15v4"/></svg></button>
    <button class="navbtn" data-view="memory" title="记忆"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></button>
    <button class="navbtn" data-view="chat" title="建模手对话"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 01-8 8H5l-2 2V12a8 8 0 018-8h2a8 8 0 018 8z"/></svg></button>
  </nav>
  <div class="main">
    <div class="topbar">
      <h1>MMCAS 指挥中心 · 建模手</h1>
      <span class="chip">${esc(git.branch || 'git 离线')}</span>
      ${syncBadge}
      <div class="spacer"></div>
      <span class="chip">${new Date().toLocaleString('zh-CN')}</span>
    </div>

    <div class="view active" id="v-kanban">
      <div class="kanban">${boardHtml}</div>
    </div>

    <div class="view" id="v-files">
      <div class="sec-title">工作区产物</div>
      <div class="tree">${treeHtmlOut}</div>
      <div class="sec-title">同步水位</div>
      ${gitHtml}
    </div>

    <div class="view" id="v-devices">
      <div class="sec-title">成员设备</div>
      <div class="devgrid">${devHtml}</div>
    </div>

    <div class="view" id="v-memory">
      <div class="sec-title">共享记忆（最近）</div>
      ${memHtml}
    </div>

    <div class="view" id="v-chat">
      <div class="chatcard">
        <h2>建模手对话</h2>
        <p>dsh 的会话鉴权不允许内嵌窗口。点击下方按钮在新标签页打开建模手对话（已隔离会话存储与角色人格）。</p>
        ${DSH_URL ? `<a class="btn" href="${esc(DSH_URL)}" target="_blank" rel="noopener">打开建模手对话</a>` : '<p>dsh 未运行，请先执行 start-master.bat</p>'}
      </div>
    </div>
  </div>
</div>
<script>
  document.querySelectorAll('.navbtn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.navbtn').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      document.getElementById('v-' + b.dataset.view).classList.add('active');
    });
  });
</script>
</body>
</html>`;

writeFileSync(OUT, html);
console.log(`[mmcas] 指挥中心已生成: ${OUT}（任务卡 ${cards.length} 张，产物节点 ${tree.length}，记忆 ${mems.length} 条）`);
