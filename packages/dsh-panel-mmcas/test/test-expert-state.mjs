#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createExpertStore } from '../lib/expert-state.mjs';

const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-expert-state-'));
const FILE = path.join(ROOT, 'experts-state.json');
let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : ''));
  } else {
    fail++;
    console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : ''));
  }
}

console.log('\n[ES1] 创建 / 完成 / 历史');
{
  const store = createExpertStore(FILE);
  const job = store.start({ mode: 'guide', dimension: 'direction', requester: 'modeler', model: 'mock' });
  check('ES1 job running', job.status === 'running' && /^EXP-/.test(job.id), job.id);
  const done = store.finish(job.id, { ok: true, reportPath: 'guidance/x.md', elapsedS: 1.2, estFee: 0.5 });
  check('ES1 finish ready', done.status === 'ready' && done.reportPath === 'guidance/x.md', done.status);
  const list = store.list('guide');
  check('ES1 list 含任务', list.length === 1 && list[0].id === job.id, list.length);
  check('ES1 文件落盘', existsSync(FILE) && JSON.parse(readFileSync(FILE, 'utf8')).jobs.length === 1);
  const review = store.start({ mode: 'reviewer', dimension: 'code', requester: 'coder', model: 'mock' });
  store.finish(review.id, { ok: false, error: 'HTTP 500' });
  check('ES1 failed', store.get(review.id).status === 'failed' && /HTTP 500/.test(store.get(review.id).error));
  check('ES1 mode 过滤', store.list('guide').length === 1 && store.list('reviewer').length === 1);
}

console.log('\n[ES2] 重启恢复 / 上限 / 损坏容错');
{
  const store = createExpertStore(FILE);
  const running = store.start({ mode: 'guide', dimension: 'model', requester: 'modeler', model: 'mock' });
  const recovered = createExpertStore(FILE).recoverInterrupted();
  check('ES2 running 标记 interrupted', recovered === 1 && store.get(running.id).status === 'interrupted', recovered);
  for (let i = 0; i < 120; i++) {
    const j = store.start({ mode: 'reviewer', dimension: 'model', requester: 'coder', model: 'mock' });
    store.finish(j.id, { ok: true });
  }
  const raw = JSON.parse(readFileSync(FILE, 'utf8'));
  check('ES2 最多保留 100 条', raw.jobs.length === 100, raw.jobs.length);
}

rmSync(ROOT, { recursive: true, force: true });
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) process.exit(1);
