#!/usr/bin/env node
/**
 * MMCAS memory-log v1 —— 记忆追加（append-only 文件流，零依赖）
 *
 * 用法:
 *   node memory-log.mjs --workspace <工作区> --role <modeler|coder|writer> [文本...]   # 文本为空则读 stdin
 *
 * 存储: workspace/memory/<role>/YYYY-MM-DD.md（每 agent 只写自己目录 → 合并恒为并集，无冲突）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}
const WS = arg('workspace') || path.join(process.cwd(), 'workspace');
const ROLE = arg('role');
const raw = process.argv.slice(2);
const textArgs = [];
for (let i = 0; i < raw.length; i++) {
  if (raw[i].startsWith('--')) { i++; continue; } // 跳过选项及其值
  textArgs.push(raw[i]);
}

if (!ROLE || !['modeler', 'coder', 'writer'].includes(ROLE)) {
  console.error('用法: node memory-log.mjs --workspace <ws> --role <modeler|coder|writer> [文本...]');
  process.exit(2);
}

let text = textArgs.join(' ').trim();
if (!text) {
  text = readFileSync(0, 'utf8').trim(); // stdin
}
if (!text) {
  console.error('记忆内容为空');
  process.exit(2);
}

const roleDir = path.join(WS, 'memory', ROLE);
mkdirSync(roleDir, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const file = path.join(roleDir, `${today}.md`);
const stamp = new Date().toISOString().slice(11, 16); // HH:MM UTC
const entry = `\n## ${stamp}\n${text}\n`;
appendFileSync(file, entry);
console.log(`[mmcas] 已写入 ${path.relative(WS, file)}（${text.length} 字符）`);
