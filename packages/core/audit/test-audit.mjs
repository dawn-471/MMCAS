#!/usr/bin/env node
/**
 * test-audit.mjs —— audit-run.mjs（Reviewer 运行器 v2）单测
 * 覆盖：
 *   A1 维度自动收集 + RESULT 结构（dry-run）
 *   A2 脱敏（内置规则）
 *   A3 --files 清单模式
 *   A4 code/paper 维度收集
 *   A5 预算守门（> 阈值无 --confirm ⇒ 拒发）
 *   A6 空材料错误
 *   T7 --show-config：settings 读取 + credentials key 检出
 *   T8 优先级：CLI > settings
 *   T9 --note 注入（chars 增量）
 *   T10 chat 协议 mock 全链（报告 + meta 落盘）
 *   T11 responses 协议 mock 全链（默认通道回归）
 */
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'audit-run.mjs');
const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-audit-test-'));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}
function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000 });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  const m = out.match(/AUDIT_RESULT=(\{.*\})/);
  let res = null;
  try { res = m ? JSON.parse(m[1]) : null; } catch {}
  return { code: r.status, out, res };
}
// 异步版（T10/T11 用：不能在 spawnSync 期间阻塞本进程 event loop，否则同进程 mock server 收不到请求）
function runAsync(args) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [CLI, ...args]);
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => {
      out = out.trim();
      const m = out.match(/AUDIT_RESULT=(\{.*\})/);
      let res = null;
      try { res = m ? JSON.parse(m[1]) : null; } catch {}
      resolve({ code, out, res });
    });
  });
}
const ws = path.join(ROOT, 'ws');
for (const d of ['workspace/modeling', 'workspace/analysis', 'workspace/code', 'workspace/paper']) mkdirSync(path.join(ws, d), { recursive: true });
writeFileSync(path.join(ws, 'workspace/modeling/m1.md'), '# 模型文档一\n用户路径 C:\\Users\\alice\\proj 与邮箱 a@b.com，电话 13812345678。\n');
writeFileSync(path.join(ws, 'workspace/modeling/m2.md'), '# 模型文档二\n' + '内容 '.repeat(50) + '\n');
writeFileSync(path.join(ws, 'workspace/analysis/a1.md'), '# 分析\n');
writeFileSync(path.join(ws, 'workspace/code/c1.py'), 'print("hi")\n');
writeFileSync(path.join(ws, 'workspace/paper/p1.tex'), '\\section{摘要}\n');
writeFileSync(path.join(ws, 'workspace/modeling/skip.bin'), '\x00\x01binary');
const big = '# 大材料\n' + 'x'.repeat(450000) + '\n';
writeFileSync(path.join(ws, 'workspace/analysis/big.md'), big);

console.log('\n[A1/A2] model 维度自动收集 + 脱敏');
{
  const r = run(['--dimension', 'model', '--workspace', ws, '--dry-run']);
  check('A1 exit0 + dryRun + 4 个文件', r.code === 0 && r.res && r.res.ok && r.res.dryRun && r.res.files === 4, JSON.stringify(r.res));
  check('A2 脱敏命中 >=3（路径/邮箱/手机）', r.res && r.res.scrubHits >= 3, 'hits=' + (r.res && r.res.scrubHits));
}

console.log('\n[A3] --files 清单模式');
{
  const listF = path.join(ROOT, 'list.txt');
  writeFileSync(listF, '# 注释\nworkspace/modeling/m1.md || 模型文档一（别名）\nworkspace/paper/p1.tex\n');
  const r = run(['--dimension', 'model', '--workspace', ws, '--files', listF, '--dry-run']);
  check('A3 清单 2 文件 + 显示名生效', r.code === 0 && r.res && r.res.ok && r.res.files === 2, JSON.stringify(r.res));
}

console.log('\n[A4] code / paper 维度收集');
{
  const r1 = run(['--dimension', 'code', '--workspace', ws, '--dry-run']);
  check('A4 code=1（skip.bin 被扩展名过滤）', r1.code === 0 && r1.res && r1.res.files === 1, JSON.stringify(r1.res));
  const r2 = run(['--dimension', 'paper', '--workspace', ws, '--dry-run']);
  check('A4 paper=1（p1.tex）', r2.code === 0 && r2.res && r2.res.files === 1, JSON.stringify(r2.res));
}

console.log('\n[A5] 预算守门（大材料无 --confirm ⇒ 拒发）');
{
  const r = run(['--dimension', 'model', '--workspace', ws, '--paths', 'workspace/analysis/big.md']);
  check('A5 exit3 + needsConfirm + estFee>30', r.code === 3 && r.res && r.res.needsConfirm === true && r.res.estFee > 30, JSON.stringify(r.res));
  check('A5 未发起网络', r.res && !r.res.error);
}

console.log('\n[A6] 空材料');
{
  const empty = path.join(ROOT, 'empty');
  mkdirSync(path.join(empty, 'workspace/modeling'), { recursive: true });
  const r = run(['--dimension', 'model', '--workspace', empty, '--dry-run']);
  check('A6 ok:false + 明确错误', r.code === 4 && r.res && r.res.ok === false && /未收集到/.test(r.res.error), JSON.stringify(r.res));
}

console.log('\n[T7/T8] show-config：settings 读取 + key 检出 + CLI 优先级');
{
  const dshT = path.join(ROOT, 'dsh');
  mkdirSync(dshT, { recursive: true });
  writeFileSync(path.join(dshT, 'settings.yaml'), 'llm-deepseek:\n  models: []\nreviewer:\n  endpoint: http://127.0.0.1:3999/v1/responses\n  model: test-model-x\n  protocol: responses\n  maxFeeCny: 10\n  apiKeyEnv: TEST_KEY\n');
  writeFileSync(path.join(dshT, '.credentials.yaml'), 'version: 1\nrefs:\n  TEST_KEY: sk-test-abc123\n');
  const r7 = spawnSync(process.execPath, [CLI, '--show-config', '--dsh-home', dshT], { encoding: 'utf8' });
  let j7 = null; try { j7 = JSON.parse(r7.stdout); } catch {}
  check('T7 settings 读取 + key 检出（无明文）', j7 && j7.endpoint.includes('3999') && j7.model === 'test-model-x' && j7.hasKey === true && j7.source === 'settings' && !r7.stdout.includes('sk-test-abc123'), JSON.stringify(j7));
  const r8 = spawnSync(process.execPath, [CLI, '--show-config', '--dsh-home', dshT, '--model', 'cli-model'], { encoding: 'utf8' });
  let j8 = null; try { j8 = JSON.parse(r8.stdout); } catch {}
  check('T8 CLI > settings', j8 && j8.model === 'cli-model' && j8.source === 'cli', JSON.stringify(j8));
}

console.log('\n[T9] --note 注入');
{
  const rA = run(['--dimension', 'model', '--workspace', ws, '--paths', 'workspace/modeling/m2.md', '--dry-run']);
  const rB = run(['--dimension', 'model', '--workspace', ws, '--paths', 'workspace/modeling/m2.md', '--dry-run', '--note', '补充说明：本次审阅重点检查量纲一致性']);
  check('T9 note 使 chars 变大', rA.res && rB.res && rB.res.chars > rA.res.chars && (rB.res.chars - rA.res.chars) >= 15, `a=${rA.res && rA.res.chars} b=${rB.res && rB.res.chars}`);
}

console.log('\n[T10/T11] 双协议 mock 全链（chat + responses）');
{
  // mock 端点：/v1/responses 与 /v1/chat/completions
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const isChat = req.url.includes('chat');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (isChat) {
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '# Mock Chat 报告\n\nOK-via-chat' } }] }) + '\n\n');
        res.write('data: ' + JSON.stringify({ usage: { prompt_tokens: 111, completion_tokens: 22 } }) + '\n\n');
        res.write('data: [DONE]\n\n');
      } else {
        res.write('data: ' + JSON.stringify({ type: 'response.output_text.done', text: '# Mock Responses 报告\n\nOK-via-responses' }) + '\n\n');
        res.write('data: ' + JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 333, output_tokens: 44 } } }) + '\n\n');
      }
      res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const outT = path.join(ROOT, 'out');
  const r10 = await runAsync(['--dimension', 'model', '--workspace', ws, '--paths', 'workspace/modeling/m2.md', '--endpoint', `http://127.0.0.1:${port}/v1/chat/completions`, '--protocol', 'chat', '--model', 'mock-chat', '--out', outT]);
  const r11 = await runAsync(['--dimension', 'model', '--workspace', ws, '--paths', 'workspace/modeling/m2.md', '--endpoint', `http://127.0.0.1:${port}/v1/responses`, '--model', 'mock-resp', '--out', outT]);
  srv.close();
  check('T10 chat 全链 ok + 报告含 mock 文本', r10.code === 0 && r10.res && r10.res.ok && r10.res.protocol === 'chat', JSON.stringify(r10.res).slice(0, 200));
  if (r10.res && r10.res.reportPath) {
    const txt = readFileSync(r10.res.reportPath, 'utf8');
    check('T10 报告落盘含正文 + meta', txt.includes('OK-via-chat') && txt.includes('Reviewer 审阅报告') && existsSync(r10.res.reportPath.replace(/\.md$/, '.meta.json')), 'report ok');
  } else check('T10 报告落盘含正文 + meta', false, 'no reportPath');
  check('T11 responses 全链 ok（默认协议回归）', r11.code === 0 && r11.res && r11.res.ok && r11.res.protocol === 'responses', JSON.stringify(r11.res).slice(0, 200));
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
process.exit(fail === 0 ? 0 : 1);
