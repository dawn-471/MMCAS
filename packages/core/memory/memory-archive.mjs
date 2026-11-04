#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';

const ROLES = ['modeler', 'coder', 'writer'];
const USAGE = [
  '用法: node memory-archive.mjs --workspace <ws> --before YYYY-MM-DD [选项]',
  '',
  '选项:',
  '  --role modeler|coder|writer|all   角色过滤（默认 all）',
  '  --apply                           实际移动（默认 dry-run）',
  '  --json                            JSON 输出',
].join('\n');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const workspace = path.resolve(arg('workspace', path.join(process.cwd(), 'workspace')));
const before = String(arg('before', ''));
const roleArg = String(arg('role', 'all'));
const apply = process.argv.includes('--apply');
const json = process.argv.includes('--json');

if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) {
  console.error(USAGE);
  process.exit(2);
}
if (roleArg !== 'all' && !ROLES.includes(roleArg)) {
  console.error('非法 --role: ' + roleArg);
  process.exit(2);
}

const roles = roleArg === 'all' ? ROLES : [roleArg];
const items = [];
const errors = [];

for (const role of roles) {
  const dir = path.join(workspace, 'memory', role);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md')) {
    const date = name.replace(/\.md$/i, '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= before) continue;
    const source = path.join(dir, name);
    const destDir = path.join(dir, 'archive');
    const dest = path.join(destDir, name);
    if (existsSync(dest)) {
      errors.push({ role, date, file: name, error: '目标已存在，跳过' });
      continue;
    }
    items.push({ role, date, source, dest, destDir, file: `${role}/${name}` });
  }
}

let moved = 0;
if (apply) {
  for (const item of items) {
    try {
      mkdirSync(item.destDir, { recursive: true });
      renameSync(item.source, item.dest);
      moved++;
    } catch (err) {
      errors.push({ role: item.role, date: item.date, file: item.file, error: String(err.message || err) });
    }
  }
}

const result = {
  ok: errors.length === 0,
  apply,
  before,
  workspace,
  count: items.length,
  moved,
  items: items.map((item) => ({ role: item.role, date: item.date, file: item.file, dest: path.relative(workspace, item.dest).replace(/\\/g, '/') })),
  errors,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${apply ? '已归档' : '待归档'} ${items.length} 个文件（before ${before}）`);
  for (const item of result.items) console.log(`  ${item.file} -> ${item.dest}`);
  for (const error of errors) console.log(`  ! ${error.file}: ${error.error}`);
  if (!apply && items.length) console.log('（dry-run；加 --apply 实际移动）');
}
if (errors.length && apply) process.exit(1);
