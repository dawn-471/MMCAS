#!/usr/bin/env node
/**
 * notice.mjs —— MMCAS 跨端消息层 CLI（v1.2 W3-T3.1/T3.2）
 *
 * 协议：工作区仓 notices/ 目录（git 同步），每条消息一个 N-*.md
 * （frontmatter：id/from/to/kind/urgency/scope/status/at + 正文）。
 * 投递由目标端面板轮询器完成（normal=排队提醒 / urgent=steer 立即打断）；
 * 本 CLI 供 agent / 人类发送、查看与回执。
 *
 * 用法:
 *   node notice.mjs send <noticesDir> --to <modeler|coder|writer|all> [--kind ruling|error|stop|info]
 *        [--urgency normal|urgent] [--scope T-xxx,T-yyy] --body <文本> [--from <role>]
 *   node notice.mjs list <noticesDir> [--to <role>] [--status pending|delivered|acked]
 *   node notice.mjs ack <noticesDir> <id> [--by <role>]
 *
 * 说明：--from / --by 缺省取环境变量 MMCAS_ROLE，否则 modeler。
 * kind 语义：ruling=裁决请求 / error=错误上报 / stop=停止指令 / info=一般。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const VALID_TO = ['modeler', 'coder', 'writer', 'all'];
const VALID_KIND = ['ruling', 'error', 'stop', 'info'];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}
function pad(n) { return String(n).padStart(2, '0'); }
function parseNotice(fp) {
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

const cmd = process.argv[2];
const dir = process.argv[3];
if (!cmd || !dir || !['send', 'list', 'ack'].includes(cmd)) {
  console.error('用法: notice.mjs send|list|ack <noticesDir> ...（详见文件头注释）');
  process.exit(2);
}

if (cmd === 'send') {
  const body = arg('body');
  const to = arg('to');
  const from = arg('from') || process.env.MMCAS_ROLE || 'modeler';
  const kind = VALID_KIND.includes(arg('kind')) ? arg('kind') : 'info';
  const urgency = arg('urgency') === 'urgent' ? 'urgent' : 'normal';
  const scope = arg('scope') || '';
  if (!body || !to) { console.error('send 需要 --to 与 --body'); process.exit(2); }
  if (!VALID_TO.includes(to)) { console.error(`--to 非法: ${to}（${VALID_TO.join('|')}）`); process.exit(2); }
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const id = 'N-' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + '-' + Math.random().toString(36).slice(2, 4);
  const rec = { id, from, to, kind, urgency, scope, status: 'pending', at: now.toISOString() };
  const text = '---\n' + Object.entries(rec).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\n## 正文\n' + body + '\n';
  writeFileSync(path.join(dir, id + '.md'), text);
  console.log(`OK 已发送 ${id}（${from} → ${to}｜${kind}${urgency === 'urgent' ? '｜urgent' : ''}${scope ? '｜scope=' + scope : ''}）`);
  process.exit(0);
}

if (cmd === 'list') {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^N-[\w-]+\.md$/.test(f)).sort().reverse() : [];
  const filterTo = arg('to');
  const filterStatus = arg('status');
  let n = 0;
  for (const f of files) {
    const rec = parseNotice(path.join(dir, f));
    if (!rec) continue;
    if (filterTo && rec.to !== filterTo) continue;
    if (filterStatus && rec.status !== filterStatus) continue;
    console.log(`  ${rec.id}  [${rec.status}]  ${rec.from} → ${rec.to}  ${rec.kind}${rec.urgency === 'urgent' ? '/urgent' : ''}${rec.scope ? '  scope=' + rec.scope : ''}  ${(rec.body || '').slice(0, 60)}`);
    n++;
  }
  console.log(n + ' 条消息');
  process.exit(0);
}

if (cmd === 'ack') {
  const id = process.argv[4];
  const by = arg('by') || process.env.MMCAS_ROLE || 'modeler';
  if (!id) { console.error('ack 需要 <id>'); process.exit(2); }
  if (!/^N-[\w-]+$/.test(id)) { console.error('非法消息 id: ' + id); process.exit(2); }
  const fp = path.join(dir, id + '.md');
  if (!existsSync(fp)) { console.error('未找到: ' + fp); process.exit(1); }
  let t = readFileSync(fp, 'utf8');
  t = t.replace(/^status: .*$/m, 'status: acked');
  if (!/^ackedAt: /m.test(t)) t = t.replace(/^(status: .*)$/m, (line0) => line0 + '\nackedAt: ' + new Date().toISOString() + '\nackedBy: ' + by);
  writeFileSync(fp, t);
  console.log('OK 已回执 ' + id + '（by ' + by + '）');
  process.exit(0);
}
