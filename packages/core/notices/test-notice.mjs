#!/usr/bin/env node
/**
 * test-notice.mjs —— notice.mjs CLI 单测（T3.1 消息层协议）
 *
 * 覆盖：send 落盘与协议字段 / 参数校验 / list 过滤 / ack 回执流转。
 * 运行：`node test-notice.mjs`
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'notice.mjs');
const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-notice-test-'));
const D = path.join(ROOT, 'notices');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}
function run(args, env) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MMCAS_ROLE: undefined, ...(env || {}) },
  });
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

console.log('\n[N1/N2] send 落盘与协议字段');
let id = '';
{
  const r = run(['send', D, '--to', 'coder', '--kind', 'stop', '--urgency', 'urgent', '--scope', 'T-115', '--body', '停止该方向', '--from', 'modeler']);
  check('N1 send 成功', r.code === 0 && /已发送/.test(r.out), r.out);
  const files = existsSync(D) ? readdirSync(D).filter((f) => f.endsWith('.md')) : [];
  check('N1 文件已生成', files.length === 1, files.join(','));
  if (files.length) {
    id = files[0].replace('.md', '');
    const t = readFileSync(path.join(D, files[0]), 'utf8');
    check('N2 frontmatter 字段齐', ['id:', 'from:', 'to:', 'kind:', 'urgency:', 'scope:', 'status:', 'at:'].every((k) => new RegExp('^' + k, 'm').test(t)));
    check('N2 值正确', /^from: modeler$/m.test(t) && /^to: coder$/m.test(t) && /^kind: stop$/m.test(t) && /^urgency: urgent$/m.test(t) && /^status: pending$/m.test(t));
    check('N2 正文保留', /停止该方向/.test(t));
  }
}

console.log('\n[N3/N4] 参数校验');
{
  let r = run(['send', D, '--to', 'nobody', '--body', 'x']);
  check('N3 非法 --to 被拒', r.code !== 0 && /非法/.test(r.out), r.out.slice(0, 50));
  r = run(['send', D, '--to', 'coder']);
  check('N3 缺 body 被拒', r.code !== 0, r.out.slice(0, 50));
  r = run(['ack', D, 'N-19700101-000000-xx']);
  check('N3 ack 不存在 id ⇒ 非零', r.code !== 0, r.out.slice(0, 50));
}

console.log('\n[N5/N6] list 与 ack 流转');
{
  let r = run(['list', D]);
  check('N5 list 含待处理条目', r.code === 0 && r.out.includes(id) && /1 条消息/.test(r.out), r.out.replace(/\n/g, ' | ').slice(0, 80));
  r = run(['list', D, '--status', 'pending']);
  check('N5 --status pending ⇒ 1', /1 条消息/.test(r.out));
  r = run(['ack', D, id, '--by', 'coder']);
  check('N6 ack 成功', r.code === 0 && /已回执/.test(r.out), r.out);
  const t = readFileSync(path.join(D, id + '.md'), 'utf8');
  check('N6 status=acked + ackedBy', /^status: acked$/m.test(t) && /^ackedBy: coder$/m.test(t) && /^ackedAt: /m.test(t));
  r = run(['list', D, '--status', 'acked']);
  check('N6 --status acked ⇒ 1', /1 条消息/.test(r.out), r.out.replace(/\n/g, ' | ').slice(0, 80));
  r = run(['list', D, '--status', 'pending']);
  check('N6 pending 归零', /0 条消息/.test(r.out));
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
process.exit(fail === 0 ? 0 : 1);
