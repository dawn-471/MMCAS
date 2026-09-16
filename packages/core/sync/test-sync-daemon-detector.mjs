// sync-daemon 入库前体检的**判定规则**单测（不 spawn git，故在受限沙箱里也能跑）。
// 端到端行为用例见 test-sync-daemon-guard.ps1（同目录）。
//
// 关键设计：判定规则是**从已发布的 sync-daemon.mjs 里抽取**的（不是复制一份）——避免"测的是副本"。
//
// 用例：
//   [1] 真实受害文件（a_problem/a_shrink_dbg.py 含 U+FE3C）必须被**硬拦截**（需真实工作区）
//   [2] **引用**事故样例的文档不得被硬拦截；这是 v0.2.1 的收紧点：v0.2 会把"记录事故的文档"本身挡在门外（自伤）
//   [3] markdown 里合法的 `=======` 下划线、以及单独出现的 `<<<<<<<` 不得误判为冲突标记
//   [4] 乱码签名 >=3 命中 => **只告警、不拦截**
//   [5] 指定"当前待提交集"是否会被新守卫挡住（挡住 => 重启后的 daemon 会一直停摆）
//       由外部先把 `git status --porcelain -uall` 的结果路径写进 %MMCAS_PENDING_LIST%；文件不存在则跳过本条
//   [6] v1.2 边界口径（数据文件只告警 / 代码文件硬拦截）——含代码目录下 JSON 日志的数据类豁免
//
// 运行：`node test-sync-daemon-detector.mjs [工作区路径]`
//   工作区路径也可用环境变量 MMCAS_WS 提供；缺省则跳过 [1][2]。
//   脱敏/开源说明：本文件不含个人绝对路径——默认从自身目录解析 sync-daemon.mjs。
//
// 结果基线（2026-09-11，v0.2.1）：13/13 通过；v1.2 增补 [6] 后 20 项全过。

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.MMCAS_SYNC_DAEMON || path.join(HERE, 'sync-daemon.mjs');
const W = process.argv[2] || process.env.MMCAS_WS || '';
const src = readFileSync(SRC, 'utf8');

function grabRe(name) {
  const m = src.match(new RegExp('const ' + name + ' = (/.*?/[gimsuy]*);'));
  if (!m) throw new Error('cannot extract ' + name);
  return eval(m[1]); // eslint-disable-line no-eval
}
function grabSet(name) {
  const m = src.match(new RegExp('const ' + name + ' = new Set\\(\\[(.*?)\\]\\);', 's'));
  if (!m) throw new Error('cannot extract ' + name);
  return eval('new Set([' + m[1] + '])'); // eslint-disable-line no-eval
}
const MOJIBAKE_RE = grabRe('MOJIBAKE_RE');
const BAD_CODEPOINT_RE = grabRe('BAD_CODEPOINT_RE');
const CODE_EXT = grabSet('CODE_EXT');
console.log('extracted: CODE_EXT 大小=' + CODE_EXT.size + ' 含 .py=' + CODE_EXT.has('.py') + ' 含 .md=' + CODE_EXT.has('.md') + ' 含 .json=' + CODE_EXT.has('.json'));

const extOf = (f) => { const i = f.lastIndexOf('.'); return i === -1 ? '' : f.slice(i).toLowerCase(); };

function analyze(text, file) {
  const isCode = CODE_EXT.has(extOf(file));
  const blocks = [];
  const warns = [];
  if (/^<{7}[ \t]/m.test(text) && /^>{7}[ \t]/m.test(text)) blocks.push('markers');
  const bad = text.match(BAD_CODEPOINT_RE);
  if (bad) {
    const msg = 'bad-codepoint x' + bad.length;
    if (isCode) blocks.push(msg); else warns.push(msg);
  }
  // 注意：必须直接传正则对象。String(re) 会得到 "/…/g" 这个**字面量文本**，
  // 于是变成"搜索带斜杠的字符串"，永远 0 命中（本测试脚本第一版就栽在这里）。
  const moj = text.match(MOJIBAKE_RE);
  if (moj && moj.length >= 3) warns.push('mojibake x' + moj.length);
  return { blocks, warns };
}
function read(p) { try { return readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch { return null; } }

let pass = 0, fail = 0, skip = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}
function skipNote(name, why) { skip++; console.log('  SKIP  ' + name + '  (' + why + ')'); }

const hasWs = W && existsSync(path.join(W, 'workspace'));

console.log('\n[1] 真实受害文件（.py）动态判定：仍受损=>硬拦截 / 已修复=>不误拦');
if (!hasWs) skipNote('a_shrink_dbg.py', '未提供工作区路径（参数1 或 MMCAS_WS）');
else {
  const shrink = read(path.join(W, 'workspace/code/a_problem/a_shrink_dbg.py'));
  if (shrink === null) skipNote('a_shrink_dbg.py', '工作区中不存在该文件');
  else {
    const r = analyze(shrink, 'a_shrink_dbg.py');
    const hasBad = r.blocks.concat(r.warns).some((s) => s.startsWith('bad-codepoint'));
    if (hasBad) check('a_shrink_dbg.py（仍受损）必须硬拦截', r.blocks.some((b) => b.startsWith('bad-codepoint')), JSON.stringify(r));
    else check('a_shrink_dbg.py（已修复）不得误拦', r.blocks.length === 0, JSON.stringify(r));
    if (!hasBad) console.log('  note: 该文件已被修复（T-042）；拦截逻辑由 [6b] 合成用例保证');
  }
}

console.log('\n[2] 引用事故样例的文档不得被硬拦截（v0.2.1 收紧点）');
if (!hasWs) skipNote('[2] 全部文件', '未提供工作区路径');
else {
  for (const rel of ['tasks/T-042.md', 'memory/modeler/2026-09-11-E.md', 'tasks/T-041.md', 'tasks/T-039.md',
    'workspace/analysis/2026-nation-B-notation.md', 'workspace/code/b_problem/t039_q4_eval_mojibake_report.md']) {
    const t = read(path.join(W, rel));
    const r = analyze(t || '', rel.split('/').pop());
    check(rel, t !== null && r.blocks.length === 0, JSON.stringify(r));
  }
}

console.log('\n[3] 冲突标记：单独 ======= / 单独 <<<<<<< 不得误判');
check('单独 =======', analyze('T\n=======\n\nx\n', 'a.md').blocks.length === 0);
check('单独 <<<<<<<', analyze('<<<<<<< HEAD\nx\n', 'a.md').blocks.length === 0);
check('成对标记', analyze('x\n<<<<<<< HEAD\ny\n=======\nz\n>>>>>>> o\n', 'a.md').blocks.includes('markers'));

console.log('\n[4] 告警路径（不拦截）');
const moji = 'sig: ' + [0x951B, 0x9225, 0x9428, 0x6D93, 0x9352].map((c) => String.fromCodePoint(c)).join('');
check('乱码签名 >=3 命中 => warn', analyze(moji, 'a.md').warns.some((w) => w.startsWith('mojibake')), JSON.stringify(analyze(moji, 'a.md')));
check('乱码签名不拦截', analyze(moji, 'a.md').blocks.length === 0);

console.log('\n[5] 指定待提交集会不会被新守卫挡住？（挡住 = 新 daemon 停摆）');
// 注意：不能在 node 里 execFileSync('git') —— 沙箱禁止管道 stdio 拉子进程（EPERM）。
// 由外部先把 `git status --porcelain -uall` 落到文件（路径经 MMCAS_PENDING_LIST 传入），这里只读文件。
const PENDING = process.env.MMCAS_PENDING_LIST || '';
if (!PENDING || !existsSync(PENDING)) {
  skipNote('待提交集扫描', '未提供 MMCAS_PENDING_LIST 或文件不存在');
} else {
  const pending = readFileSync(PENDING, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => l.slice(3).trim().replace(/^"(.*)"$/, '$1'));
  let wouldBlock = 0;
  for (const f of pending) {
    const isCode = CODE_EXT.has(extOf(f));
    const t = hasWs ? read(path.join(W, f)) : null;
    if (t === null) continue;
    const blk = [];
    const wrn = [];
    if (/^<{7}[ \t]/m.test(t) && /^>{7}[ \t]/m.test(t)) blk.push('markers');
    const bad = t.match(BAD_CODEPOINT_RE);
    if (bad) (isCode ? blk : wrn).push('bad-codepoint x' + bad.length);
    const moj = t.match(MOJIBAKE_RE);
    if (moj && moj.length >= 3) wrn.push('mojibake x' + moj.length);
    if (blk.length) wouldBlock += 1;
    console.log('  ' + (blk.length ? 'BLOCK' : (wrn.length ? 'warn ' : 'ok   ')) + '  ' + f + '  ' + JSON.stringify({ blk, wrn }));
  }
  check('待提交集不含硬拦截项', wouldBlock === 0, 'pending=' + pending.length + ' blocked=' + wouldBlock);
}

console.log('\n[6] v1.2 边界口径：数据文件只告警 / 代码文件硬拦截');
// 6a. 代码目录下的 JSON 日志（事故关切场景）：非法码点只告警——不会被整轮拦截
const fffd = String.fromCodePoint(0xFFFD);
const fe3c = String.fromCodePoint(0xFE3C);
check('workspace/code/**/*.json 含 U+FFFD => warn', analyze('{"log":"' + fffd + '"}', 'run_log.json').warns.length > 0 && analyze('{"log":"' + fffd + '"}', 'run_log.json').blocks.length === 0);
check('workspace/code/**/*.jsonl 含 U+FE3C => warn', analyze('{"a":1}\n# ' + fe3c + '\n', 'run.jsonl').blocks.length === 0 && analyze('{"a":1}\n# ' + fe3c + '\n', 'run.jsonl').warns.length > 0);
check('.csv 含 U+FFFD => warn', analyze('a,b\n' + fffd + ',2\n', 't.csv').blocks.length === 0 && analyze('a,b\n' + fffd + ',2\n', 't.csv').warns.length > 0);
// 6b. 代码类扩展名：非法码点必拦截
check('.py 含 U+FFFD => block', analyze('x = 1  # ' + fffd + '\n', 'a.py').blocks.some((b) => b.startsWith('bad-codepoint')));
check('.mjs 含 U+FE3C => block', analyze('// ' + fe3c + '\n', 'a.mjs').blocks.some((b) => b.startsWith('bad-codepoint')));
// 6c. 扩展名集合断言（防未来改动回退）
const notCode = ['.md', '.tex', '.txt', '.json', '.jsonl', '.csv', '.tsv'];
const mustCode = ['.py', '.mjs', '.js', '.ts', '.yaml', '.bat', '.ps1', '.sh'];
check('数据/散文类不在 CODE_EXT', notCode.every((e) => !CODE_EXT.has(e)), notCode.filter((e) => CODE_EXT.has(e)).join(',') || 'ok');
check('代码类均在 CODE_EXT', mustCode.every((e) => CODE_EXT.has(e)), mustCode.filter((e) => !CODE_EXT.has(e)).join(',') || 'ok');

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped ====');
process.exit(fail === 0 ? 0 : 1);
