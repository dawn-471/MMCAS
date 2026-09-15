#!/usr/bin/env node
/**
 * MMCAS dsh workspace 注册器 —— 依托 dsh 原生 workspace 模块（零侵入）
 *
 * dsh 的 workspace = storages/workspace.json 里的目录注册（path + title + sessionIds）。
 * 本脚本幂等注册 MMCAS 共享工作区（path 指向比赛工作区 git 仓）。
 *
 * 用法: node register-workspace.mjs --dsh-home <dir> --path <workspaceDir> [--title MMCAS]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

const home = arg('dsh-home') || process.env.USERPROFILE + '\\.dsh';
const wsPath = (arg('path') || '').replace(/\//g, '\\');
const title = arg('title') || 'MMCAS';
if (!wsPath) {
  console.error('缺少 --path（工作区仓库路径）');
  process.exit(2);
}

const storages = path.join(home, 'storages');
const regFile = path.join(storages, 'workspace.json');

// 读取或初始化注册表
let reg;
if (existsSync(regFile)) {
  reg = JSON.parse(readFileSync(regFile, 'utf8'));
} else {
  mkdirSync(storages, { recursive: true });
  reg = { unit: { name: 'workspace', version: 2 }, global: { initialized: true, workspaceIds: [] }, tables: { workspaces: {} } };
}

const tables = reg.tables.workspaces;
// 幂等：已存在同 path 的 workspace 则跳过
for (const id of Object.keys(tables)) {
  if (tables[id].path === wsPath) {
    console.log(`已注册（无需重复）: ${tables[id].title} @ ${wsPath}`);
    process.exit(0);
  }
}

const id = randomUUID();
tables[id] = {
  path: wsPath,
  title,
  sessionIds: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
reg.global.workspaceIds.push(id);
reg.global.initialized = true;
writeFileSync(regFile, JSON.stringify(reg, null, 2));
console.log(`已注册 workspace「${title}」@ ${wsPath}`);
