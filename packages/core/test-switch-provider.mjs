#!/usr/bin/env node
/**
 * switch-provider 单元验证：临时文件环境，验证 list/switch/dry-run 与 YAML 段写入正确性。
 */
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'mmcas-sw-'));
const cfgDir = path.join(tmp, 'config');
mkdirSync(cfgDir);

writeFileSync(path.join(cfgDir, 'providers.yaml'), `providers:
  - id: deepseek
    name: DeepSeek 官方
    base_url: https://api.deepseek.com
    api_key: sk-test-111111
    models:
      - deepseek-v4-flash
  - id: relay-a
    name: 中转站A
    base_url: https://relay.example.com/v1
    api_key: sk-test-222222
    models:
      - relay-model-x
default: deepseek
`);

writeFileSync(path.join(tmp, 'settings.yaml'), `ui-onboarding:
  welcomeNoticeVersion: 2026-08-13.1
agent-default-model:
  provider: deepseek-official
  model: deepseek-v4-flash
  reasoningEffort: high
`);
writeFileSync(path.join(tmp, '.credentials.yaml'), `version: 1
refs:
  DEEPSEEK_API_KEY: sk-old-999999
records:
  - kind: grant
    payload:
      secret: keep-me
`);

const SW = fileURLToPath(new URL('./switch-provider.mjs', import.meta.url));
function run(...args) {
  return spawnSync(process.execPath, [SW, ...args], { encoding: 'utf8' });
}

let r = run('list', '--config', path.join(cfgDir, 'providers.yaml'));
console.log('=== list ===\n' + r.stdout);
if (r.status !== 0) throw new Error(r.stderr);

r = run('switch', 'relay-a', '--config', path.join(cfgDir, 'providers.yaml'),
  '--settings', path.join(tmp, 'settings.yaml'),
  '--credentials', path.join(tmp, '.credentials.yaml'));
console.log('=== switch relay-a ===\n' + r.stdout);
if (r.status !== 0) throw new Error(r.stderr);

const settings = readFileSync(path.join(tmp, 'settings.yaml'), 'utf8');
const cred = readFileSync(path.join(tmp, '.credentials.yaml'), 'utf8');
console.log('=== 写入后的 settings.yaml ===\n' + settings);
console.log('=== 写入后的 .credentials.yaml（key 已脱敏） ===\n' + cred.replace(/MMCAS_PROVIDER_KEY: .*/, 'MMCAS_PROVIDER_KEY: <hidden>'));

// 断言
const checks = [
  ['settings 含 baseURL 中转站', settings.includes('https://relay.example.com/v1')],
  ['settings 含 apiKeyEnv', settings.includes('apiKeyEnv: MMCAS_PROVIDER_KEY')],
  ['settings agent-default-model 保留 reasoningEffort', settings.includes('reasoningEffort: high')],
  ['settings model 已切 relay-model-x', settings.includes('model: relay-model-x')],
  ['credentials 原 refs 保留', cred.includes('DEEPSEEK_API_KEY: sk-old-999999')],
  ['credentials 新 key 写入', cred.includes('MMCAS_PROVIDER_KEY: sk-test-222222')],
  ['credentials records 未破坏', cred.includes('secret: keep-me')],
];
let fail = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) fail++;
}

// 再切回 deepseek 验证幂等（不重复追加段）
r = run('switch', 'deepseek', '--config', path.join(cfgDir, 'providers.yaml'),
  '--settings', path.join(tmp, 'settings.yaml'),
  '--credentials', path.join(tmp, '.credentials.yaml'));
const settings2 = readFileSync(path.join(tmp, 'settings.yaml'), 'utf8');
const dupSections = (settings2.match(/llm-deepseek:/g) || []).length;
console.log(`${dupSections === 1 ? 'PASS' : 'FAIL'}  二次切换不重复追加 llm-deepseek 段（当前 ${dupSections} 个）`);
if (dupSections !== 1) fail++;

// ---- 追加：--model 指定模型 / catalog 生成 / 非法模型拒绝 ----
writeFileSync(path.join(cfgDir, 'providers2.yaml'), `providers:
  - id: deepseek
    name: DeepSeek 官方
    base_url: https://api.deepseek.com
    api_key: sk-test
    models:
      - deepseek-v4.1-flash-expires-on-0910
      - deepseek-v4-pro
      - deepseek-v4-flash-vision-exp
default: deepseek
`);
const settings3 = path.join(tmp, 'settings3.yaml');
writeFileSync(settings3, `llm-deepseek:
  models:
    - id: keep-me
agent-default-model:
  provider: deepseek-official
  model: deepseek-v4-flash
`);
r = run('switch', 'deepseek', '--model', 'deepseek-v4-pro', '--config', path.join(cfgDir, 'providers2.yaml'),
  '--settings', settings3, '--credentials', path.join(tmp, '.credentials.yaml'));
if (r.status !== 0) throw new Error(r.stderr);
const s3 = readFileSync(settings3, 'utf8');
console.log('=== catalog 生成后的 settings3.yaml ===\n' + s3);
const extra = [
  ['--model 指定模型生效', s3.includes('model: deepseek-v4-pro')],
  ['llm-deepseek 其余键照常写入', s3.includes('baseURL: https://api.deepseek.com')],
  ['catalog 由 providers.yaml 生成（旧手动 models 被替换）',
    !s3.includes('keep-me') && s3.includes('- id: deepseek-v4.1-flash-expires-on-0910')
      && s3.includes('- id: deepseek-v4-pro') && s3.includes('- id: deepseek-v4-flash-vision-exp')],
  ['vision 模型保留图片能力声明', s3.includes('inputModalities: [text, image]')],
  ['catalog 块只出现一次', (s3.match(/^ {2}models:/gm) || []).length === 1],
];
for (const [name, ok] of extra) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) fail++; }

// 缺省取 models 首项（新内测模型在首位）+ 二次切换 catalog 不重复
r = run('switch', 'deepseek', '--config', path.join(cfgDir, 'providers2.yaml'),
  '--settings', settings3, '--credentials', path.join(tmp, '.credentials.yaml'));
if (r.status !== 0) throw new Error(r.stderr);
const s4 = readFileSync(settings3, 'utf8');
const okFirst = s4.includes('model: deepseek-v4.1-flash-expires-on-0910')
  && (s4.match(/^ {2}models:/gm) || []).length === 1;
console.log(`${okFirst ? 'PASS' : 'FAIL'}  缺省取 models 首项且 catalog 不重复`);
if (!okFirst) fail++;

// provider 未声明 models 时不写 catalog（避免清空 dsh 内置目录）
writeFileSync(path.join(cfgDir, 'providers3.yaml'), `providers:
  - id: bare
    name: Bare
    base_url: https://bare.example.com/v1
    api_key: sk-bare
default: bare
`);
const settings5 = path.join(tmp, 'settings5.yaml');
writeFileSync(settings5, `agent-default-model:\n  provider: deepseek-official\n  model: x\n`);
r = run('switch', 'bare', '--config', path.join(cfgDir, 'providers3.yaml'),
  '--settings', settings5, '--credentials', path.join(tmp, '.credentials.yaml'));
if (r.status !== 0) throw new Error(r.stderr);
const s5 = readFileSync(settings5, 'utf8');
const okNoCatalog = s5.includes('baseURL: https://bare.example.com/v1') && !/^ {2}models:/m.test(s5);
console.log(`${okNoCatalog ? 'PASS' : 'FAIL'}  无 models 的 provider 不写 catalog`);
if (!okNoCatalog) fail++;

// 空/缺失 settings.yaml 时也能创建完整段（新装环境首切）
const settings6 = path.join(tmp, 'settings6.yaml');
r = run('switch', 'deepseek', '--config', path.join(cfgDir, 'providers2.yaml'),
  '--settings', settings6, '--credentials', path.join(tmp, '.credentials.yaml'));
if (r.status !== 0) throw new Error(r.stderr);
const s6 = readFileSync(settings6, 'utf8');
const okFresh = s6.includes('agent-default-model:') && s6.includes('model: deepseek-v4.1-flash-expires-on-0910')
  && s6.includes('- id: deepseek-v4-flash-vision-exp');
console.log(`${okFresh ? 'PASS' : 'FAIL'}  缺失 settings 时创建完整段（含 catalog）`);
if (!okFresh) fail++;

// credentials 从零创建 / `refs: {}` 行内空映射两种场景都要产出合法结构（dsh 会 BAD_INDENT 拒收）
const credFresh = path.join(tmp, 'cred-fresh.yaml');
r = run('switch', 'deepseek', '--config', path.join(cfgDir, 'providers2.yaml'),
  '--settings', path.join(tmp, 'settings7.yaml'), '--credentials', credFresh);
if (r.status !== 0) throw new Error(r.stderr);
const c7 = readFileSync(credFresh, 'utf8');
const okCredFresh = /^refs:\n {2}MMCAS_PROVIDER_KEY: /m.test(c7) && !c7.includes('refs: {}');
console.log(`${okCredFresh ? 'PASS' : 'FAIL'}  从零创建 credentials 结构合法`);
if (!okCredFresh) fail++;

const credInline = path.join(tmp, 'cred-inline.yaml');
writeFileSync(credInline, 'version: 1\nrefs: {}\n');
r = run('switch', 'deepseek', '--config', path.join(cfgDir, 'providers2.yaml'),
  '--settings', path.join(tmp, 'settings8.yaml'), '--credentials', credInline);
if (r.status !== 0) throw new Error(r.stderr);
const c8 = readFileSync(credInline, 'utf8');
const okCredInline = /^refs:\n {2}MMCAS_PROVIDER_KEY: /m.test(c8) && !c8.includes('refs: {}');
console.log(`${okCredInline ? 'PASS' : 'FAIL'}  refs: {} 行内空映射被展开`);
if (!okCredInline) fail++;

// 不在列表中的模型名必须拒绝
r = run('switch', 'deepseek', '--model', 'no-such-model', '--config', path.join(cfgDir, 'providers2.yaml'),
  '--settings', settings3, '--credentials', path.join(tmp, '.credentials.yaml'));
const okReject = r.status !== 0 && /没有 no-such-model/.test(r.stderr || '');
console.log(`${okReject ? 'PASS' : 'FAIL'}  非法 --model 拒绝（exit=${r.status}）`);
if (!okReject) fail++;

rmSync(tmp, { recursive: true, force: true });
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
