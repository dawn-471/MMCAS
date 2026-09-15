#!/usr/bin/env node
/**
 * MMCAS memory-search v1 —— 记忆检索（零依赖；v1 为词匹配评分，向量检索为后置槽位）
 *
 * 用法:
 *   node memory-search.mjs --workspace <工作区> <查询词> [--role modeler|coder|writer|all] [--limit N]
 *
 * 评分: 按查询词在条目中的命中次数排序，同分按时间倒序。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const WS = arg('workspace', path.join(process.cwd(), 'workspace'));
const QUERY = process.argv.filter((a, i) => !a.startsWith('--') && i > 1 && process.argv[i - 1] !== '--workspace' && process.argv[i - 1] !== '--role' && process.argv[i - 1] !== '--limit').join(' ');
const ROLE = arg('role', 'all');
const LIMIT = parseInt(arg('limit', '10'), 10);

if (!QUERY) {
  console.error('用法: node memory-search.mjs --workspace <ws> <查询词> [--role ...] [--limit N]');
  process.exit(2);
}

const memRoot = path.join(WS, 'memory');
if (!existsSync(memRoot)) {
  console.log('（memory 目录为空）');
  process.exit(0);
}

const terms = QUERY.toLowerCase().split(/\s+/).filter(Boolean);
const roles = ROLE === 'all' ? ['modeler', 'coder', 'writer'] : [ROLE];
const results = [];

for (const role of roles) {
  const roleDir = path.join(memRoot, role);
  if (!existsSync(roleDir)) continue;
  for (const file of readdirSync(roleDir).filter((f) => f.endsWith('.md') && f !== 'README.md')) {
    const text = readFileSync(path.join(roleDir, file), 'utf8');
    const entries = text.split(/\n## /).slice(1);
    for (const entry of entries) {
      const low = entry.toLowerCase();
      let score = 0;
      for (const t of terms) {
        const hits = low.split(t).length - 1;
        score += hits;
      }
      if (score > 0) {
        const [stampLine, ...body] = entry.split('\n');
        results.push({
          role,
          date: file.replace('.md', ''),
          time: stampLine.trim(),
          body: body.join('\n').trim().slice(0, 300),
          score,
        });
      }
    }
  }
}

results.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
for (const r of results.slice(0, LIMIT)) {
  console.log(`[${r.role} ${r.date} ${r.time}] (分=${r.score})`);
  console.log(`  ${r.body.replace(/\n/g, '\n  ')}`);
  console.log('');
}
console.log(`共 ${results.length} 条命中${results.length > LIMIT ? `（显示前 ${LIMIT}）` : ''}`);
