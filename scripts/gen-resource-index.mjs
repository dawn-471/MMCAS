#!/usr/bin/env node
/**
 * MMCAS 资源索引生成器（Master 端维护，纯上游版）
 * 用法: node scripts/gen-resource-index.mjs [--out <工作区仓docs路径>]
 * 数据源 = 上游 GitHub 仓库目录树（gh api trees recursive），不扫描、不依赖本地缓存。
 * 输出: <工作区仓>/docs/resources/resources-index.md（git 同步三端）
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const _outIdx = process.argv.indexOf('--out');
const OUT = (_outIdx >= 0 && process.argv[_outIdx + 1]) ||
  './docs/resources/resources-index.md';  // 部署时用 --out 指向工作区仓绝对路径

// 上游真源：公开 GitHub 仓库。索引只存目录地图 + 直取方法，文件本体一律从上游取。
const UPSTREAM = [
  { repo: 'personqianduixue/Math_Model', desc: '全量资料库：历年国赛/美赛/研赛论文、算法、书籍、评阅要点' },
  { repo: 'Jaxon1216/MathModelHub', desc: '方法论文档：图表选择/证据复现/论文质量清单/工作流选择' },
];

const MAX_DEPTH = 3;            // 索引展开深度（更深层只列目录名）
const MAX_CHILDREN = 50;        // 每目录最多列出子项数
const MAX_FILE_CHILDREN = 30;   // 每目录最多列出文件数（目录优先）

function ghJson(args) {
  const r = spawnSync('gh', ['api', ...args, '--jq', '.'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      env: process.env });  // 如需代理：设置 HTTPS_PROXY / HTTP_PROXY 环境变量
  if (r.status !== 0) throw new Error(`gh api 失败(${args.join(' ')}): ${(r.stderr || '').trim().slice(0, 200)}`);
  return r.stdout;
}

function fetchTree(repo) {
  const defBranch = JSON.parse(ghJson([`repos/${repo}`])).default_branch;
  const raw = ghJson([`repos/${repo}/git/trees/${defBranch}?recursive=1`]);
  const items = JSON.parse(raw).tree
    .filter((t) => t.path !== '' && !t.path.startsWith('.'))
    .map((t) => ({ path: t.path, isDir: t.type === 'tree' }));
  return { repo, defBranch, items };
}

// 构建目录树并渲染
function renderTree(repo, defBranch, items) {
  const root = { children: new Map(), files: [] };
  for (const { path: p, isDir } of items) {
    const parts = p.split('/');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur.children.has(parts[i])) cur.children.set(parts[i], { children: new Map(), files: [] });
      cur = cur.children.get(parts[i]);
    }
    const last = parts[parts.length - 1];
    if (isDir) {
      if (!cur.children.has(last)) cur.children.set(last, { children: new Map(), files: [] });
    } else {
      cur.files.push(last);
    }
  }

  const lines = [];
  const walk = (node, depth, prefix) => {
    if (depth > MAX_DEPTH) { lines.push(prefix + '…（更深层级经上游直取定位）'); return; }
    const dirs = [...node.children.entries()];
    const files = node.files;
    dirs.sort((a, b) => a[0].localeCompare(b[0], 'zh'));
    files.sort((a, b) => a.localeCompare(b, 'zh'));
    const shownDirs = dirs.slice(0, MAX_CHILDREN);
    const fileBudget = Math.min(MAX_FILE_CHILDREN, Math.max(0, MAX_CHILDREN - shownDirs.length));
    const shownFiles = files.slice(0, fileBudget);
    const omitted = (dirs.length - shownDirs.length) + (files.length - shownFiles.length);
    for (const [name, v] of shownDirs) {
      lines.push(prefix + '📁 ' + name + '/');
      walk(v, depth + 1, prefix + '  ');
    }
    for (const name of shownFiles) lines.push(prefix + name);
    if (omitted > 0) lines.push(prefix + `（…省略 ${omitted} 项，经上游直取定位）`);
  };

  walk(root, 0, '- ');
  return lines;
}

const lines = [];
lines.push('# MMCAS 数学建模资源库索引');
lines.push('');
lines.push(`> 生成时间：${new Date().toISOString()}（纯上游版：目录树来自 GitHub API，无本地依赖）`);
lines.push('> 本索引是目录地图：告诉你"有什么、在哪里"。文件本体一律从上游 GitHub 直取，本地不保留副本。');
lines.push('>');
lines.push('> **Agent 用法**：按分类定位 → 上游直取（读 mmcas-resource-index skill 的检索流程）。');
lines.push('> **人类用法**：按上游映射到 GitHub 仓库浏览。');
lines.push('');

lines.push('## 上游真源');
lines.push('');
lines.push('| 仓库（main 分支） | 内容 |');
lines.push('|---|---|');
for (const { repo, desc } of UPSTREAM) lines.push(`| [${repo}](https://github.com/${repo}) | ${desc} |`);
lines.push('');
lines.push('直取方法：单文件 `https://raw.githubusercontent.com/<owner>/<repo>/main/<路径>`；目录 `git clone --depth 1 --filter=blob:none --sparse` + `sparse-checkout set`；全量 `codeload.github.com/<owner>/<repo>/zip/refs/heads/main`。');
lines.push('');

for (const { repo, desc } of UPSTREAM) {
  lines.push(`## ${repo}`);
  lines.push('');
  try {
    const { defBranch, items } = fetchTree(repo);
    lines.push(`（默认分支 ${defBranch}，共 ${items.length} 个文件）`);
    lines.push('');
    lines.push(...renderTree(repo, defBranch, items));
  } catch (e) {
    lines.push(`（目录树获取失败: ${e.message}——请 Master 检查 gh 代理与仓库状态）`);
  }
  lines.push('');
}

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log('索引已生成:', OUT, `(${lines.length} 行)`);
