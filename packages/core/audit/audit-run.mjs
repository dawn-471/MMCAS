#!/usr/bin/env node
/**
 * audit-run.mjs — MMCAS 专家运行器 v3（Reviewer 审核者 / Guide 指导者）
 *
 * 两种模式共享材料收集/脱敏/预算/报告链路，不接任务卡、不进三联通调度。
 *   --mode reviewer  只审数学模型 / 代码漏洞（paper 仅 CLI 兼容）
 *   --mode guide     方向 / 更强模型 / 算法实现路线（仅 Master 显式发起）
 *
 * 配置优先级：CLI 参数 > <MMCAS_HOME>/{reviewer,guide}.json > 旧 settings.yaml 的
 *   reviewer 段（仅 Reviewer，只读兼容） > 内置默认。
 *   字段：endpoint / apiKeyEnv / model / protocol(responses|chat) / maxFeeCny；
 *   key 存 dsh .credentials.yaml 的 refs。
 *   dsh-home 定位：--dsh-home > DSH_HOME > MMCAS_HOME/dsh-home > 默认。
 *
 * 用法:
 *   node audit-run.mjs --mode reviewer --dimension model|code|paper --workspace <wsDir>
 *   node audit-run.mjs --mode guide --dimension direction|model|code --workspace <wsDir>
 *     [--files <list.txt>] [--paths <dir1,dir2>] [--note <text>] [--note-file <f>]
 *     [--endpoint <url>] [--bridge <url>]  # 二者同义（--bridge 兼容旧调用）
 *     [--model <name>] [--protocol responses|chat] [--max-fee <cny>]
 *     [--reviewer-config <file> | --guide-config <file>]
 *     [--out <dir>] [--scrub <rules.txt>] [--max-chars <N>]
 *     [--dry-run] [--confirm]
 *   node audit-run.mjs --mode guide --show-config [--guide-config <file>]
 *
 * 输出：stdout `EXPERT_RESULT={json}` 与 `AUDIT_RESULT={json}`（兼容面板/调用方）。
 */
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEXT_EXT = new Set(['.md', '.txt', '.tex', '.py', '.mjs', '.js', '.ts', '.yaml', '.yml', '.toml', '.bib', '.sty', '.cls', '.r', '.jl', '.sh', '.ps1', '.bat', '.ini', '.cfg']);
const DATA_EXT = new Set(['.json', '.jsonl', '.csv', '.tsv', '.log', '.jlog', '.xlsx', '.xls', '.parquet', '.npz', '.npy', '.sav', '.dta', '.rds', '.pkl', '.h5', '.mat', '.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.gif', '.svg']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', '.runtime', 'build', 'dist', 'archives', 'sim', 'results', 'result', 'logs', 'log', 'evidence', 'data', 'output', 'outputs', 'cache', 'tmp', 'temp', 'snapshots']);
const MAX_FILE = 512 * 1024;
const FEE_PER_CHAR = 7e-5;   // ¥/字符（B-Audit 标定）
const DIM_PATHS = {
  reviewer: {
    model: ['workspace/modeling', 'workspace/analysis'],
    code: ['workspace/code'],
    paper: ['workspace/paper'],
  },
  guide: {
    direction: ['tasks', 'workspace/modeling', 'workspace/analysis', 'workspace/code', 'workspace/paper'],
    model: ['workspace/modeling', 'workspace/analysis', 'workspace/code', 'workspace/paper'],
    code: ['workspace/code', 'workspace/modeling'],
  },
};
const DIM_LABEL = {
  reviewer: { model: '数学模型', code: '代码成品', paper: '最终论文' },
  guide: { direction: '方向指导', model: '模型提升', code: '算法与实现路线' },
};
const DEFAULTS = {
  endpoint: 'http://127.0.0.1:3220/v1/responses',
  model: 'gpt-6-astra',
  protocol: 'responses',
  maxFeeCny: 30,
};

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name) => process.argv.includes(`--${name}`);
const MODE = arg('mode', 'reviewer') === 'guide' ? 'guide' : 'reviewer';
const ROLE_LABEL = MODE === 'guide' ? 'Guide' : 'Reviewer';
const ROLE_DIR = MODE === 'guide' ? 'guide' : 'reviewer';
const CONFIG_FLAG = MODE === 'guide' ? 'guide-config' : 'reviewer-config';
const CONFIG_FILE = MODE === 'guide' ? 'guide.json' : 'reviewer.json';
const REPORT_DIR = MODE === 'guide' ? 'guidance' : 'audit';
const REPORT_PREFIX = MODE === 'guide' ? 'GUIDE' : 'AUDIT';
const LOG_PREFIX = MODE === 'guide' ? '[guide]' : '[reviewer]';

function emitResult(obj) {
  const text = JSON.stringify(obj);
  console.log('EXPERT_RESULT=' + text);
  console.log('AUDIT_RESULT=' + text);
}

// ---------- 0. 配置解析（Guide / Reviewer 自由度） ----------
function mmcasHome() {
  return arg('mmcas-home') || process.env.MMCAS_HOME || path.join(os.homedir(), 'AppData', 'Local', 'mmcas');
}
function dshHome() {
  return arg('dsh-home') || path.join(mmcasHome(), 'dsh-home');
}
// 轻量读取 settings.yaml 的 reviewer 段（YAML 子集：缩进二空格的键值对）
// dsh 0.2.x 会把 settings.yaml 导入 profile patch 后改名 .imported，因此两个文件都读。
function readReviewerSection(settingsPath) {
  if (!existsSync(settingsPath)) return null;
  const lines = readFileSync(settingsPath, 'utf8').split('\n');
  let inSec = false;
  const cfg = {};
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!inSec) { if (/^reviewer\s*:/.test(line)) inSec = true; continue; }
    if (/^\S/.test(line) && line.trim() !== '') break;
    const m = line.match(/^\s+([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/);
    if (m) cfg[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return Object.keys(cfg).length ? cfg : null;
}
function expertConfigPath() {
  return arg(CONFIG_FLAG, path.join(mmcasHome(), CONFIG_FILE));
}
function readExpertJson(file) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch { return null; }
}
// 读 credentials refs 中某 env 名的值（仅内存使用，不打印）
function readCredRef(credPath, envName) {
  if (!envName || !existsSync(credPath)) return null;
  try {
    const t = readFileSync(credPath, 'utf8');
    const esc = envName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = t.match(new RegExp('(?:^|\\n)\\s*' + esc + '\\s*:\\s*(\\S+)'));
    return m ? m[1] : null;
  } catch { return null; }
}
function resolveExpertConfig() {
  const dh = dshHome();
  const settingsPath = arg('settings', path.join(dh, 'settings.yaml'));
  const importedPath = settingsPath + '.imported';
  const cfgPath = expertConfigPath();
  const credPath = arg('credentials', path.join(dh, '.credentials.yaml'));
  const fromFile = readExpertJson(cfgPath) || {};
  const legacy = MODE === 'guide'
    ? {}
    : (() => {
      const fromSettings = readReviewerSection(settingsPath) || {};
      const fromImported = Object.keys(fromSettings).length ? null : readReviewerSection(importedPath);
      return fromSettings && Object.keys(fromSettings).length ? fromSettings : (fromImported || {});
    })();
  const legacySource = MODE === 'guide'
    ? 'default'
    : (readReviewerSection(settingsPath) ? 'settings' : (readReviewerSection(importedPath) ? 'settings.imported' : 'default'));
  let source = 'default';
  const pick = (cliName, secName, dflt) => {
    const cli = arg(cliName);
    if (cli !== undefined && cli !== null) { source = 'cli'; return cli; }
    if (fromFile[secName] !== undefined) { source = source === 'cli' ? 'cli' : CONFIG_FILE; return fromFile[secName]; }
    if (legacy[secName] !== undefined) { source = source === 'cli' ? 'cli' : legacySource; return legacy[secName]; }
    return dflt;
  };
  // --bridge 与 --endpoint 同义（兼容旧调用）
  const endpointCli = arg('endpoint', arg('bridge'));
  const endpoint = endpointCli !== undefined && endpointCli !== null
    ? (source = 'cli', endpointCli)
    : pick('__no_cli_arg__', 'endpoint', DEFAULTS.endpoint);
  const model = pick('model', 'model', DEFAULTS.model);
  const protocol = pick('protocol', 'protocol', DEFAULTS.protocol);
  const maxFee = Number(arg('max-fee', fromFile.maxFeeCny !== undefined ? fromFile.maxFeeCny : (legacy.maxFeeCny !== undefined ? legacy.maxFeeCny : DEFAULTS.maxFeeCny))) || DEFAULTS.maxFeeCny;
  const apiKeyEnv = arg('api-key-env', fromFile.apiKeyEnv || legacy.apiKeyEnv || null);
  const apiKey = readCredRef(credPath, apiKeyEnv);
  return { mode: MODE, role: ROLE_LABEL, endpoint, model, protocol: (protocol === 'chat' ? 'chat' : 'responses'), maxFeeCny: maxFee, apiKeyEnv, apiKey, hasKey: !!apiKey, source, settingsPath, configPath: cfgPath };
}

if (flag('show-config')) {
  const c = resolveExpertConfig();
  console.log(JSON.stringify({
    mode: c.mode, role: c.role,
    endpoint: c.endpoint, model: c.model, protocol: c.protocol, maxFeeCny: c.maxFeeCny,
    apiKeyEnv: c.apiKeyEnv, hasKey: c.hasKey, source: c.source,
    settingsPath: c.settingsPath, configPath: c.configPath,
  }, null, 2));
  process.exit(0);
}

const cfg = resolveExpertConfig();

const dimension = arg('dimension');
const workspace = arg('workspace');
if (!dimension || !DIM_LABEL[MODE][dimension] || !workspace) {
  const dims = Object.keys(DIM_LABEL[MODE]).join('|');
  console.error(`用法: node audit-run.mjs --mode ${MODE} --dimension ${dims} --workspace <wsDir> [--dry-run] [--confirm] …（配置见文件头）`);
  process.exit(2);
}
const maxChars = parseInt(arg('max-chars', '600000'), 10) || 600000;
const ws = workspace.replace(/\\/g, '/');

// ---------- 1. 材料收集 ----------
function listTextFiles(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('_')) out.push(...listTextFiles(fp)); continue; }
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!TEXT_EXT.has(ext) || DATA_EXT.has(ext)) continue;
    try { if (statSync(fp).size > MAX_FILE) continue; } catch { continue; }
    out.push(fp);
  }
  return out;
}
// 自动模式预算截断：按 mtime 新→旧收集，超出预算的文件跳过（尽量多收），返回 { kept, skipped }。
// --files 模式不截断（用户显式指定，超限硬错）。
function budgetCollect(items) {
  const withStat = items.map((it) => {
    let st = { size: 0, mtimeMs: 0 };
    try { st = statSync(it.file); } catch {}
    return { ...it, size: st.size, mtime: st.mtimeMs };
  });
  withStat.sort((a, b) => b.mtime - a.mtime);
  const budget = Math.round(maxChars * 0.9);
  let acc = 0; const kept = []; let skipped = 0;
  for (const it of withStat) {
    if (acc + it.size > budget) { skipped++; continue; }
    kept.push(it); acc += it.size;
  }
  return { kept, skipped, acc };
}
function collect() {
  const items = [];   // { file, display }
  const filesList = arg('files');
  if (filesList) {
    const lines = readFileSync(filesList, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    for (const ln of lines) {
      const parts2 = ln.split('||');
      const p = parts2[0].trim();
      const disp = parts2[1] ? parts2[1].trim() : null;
      const abs = path.isAbsolute(p) ? p : path.join(ws, p);
      items.push({ file: abs, display: disp || p });
    }
  } else {
    const pathsArg = arg('paths');
    const roots = pathsArg ? pathsArg.split(',').map((s) => s.trim()) : DIM_PATHS[MODE][dimension];
    for (const r of roots) {
      const abs = path.isAbsolute(r) ? r : path.join(ws, r);
      if (!existsSync(abs)) continue;
      let st = null;
      try { st = statSync(abs); } catch { continue; }
      if (st.isFile()) { items.push({ file: abs, display: path.relative(ws, abs).replace(/\\/g, '/') }); continue; }
      for (const f of listTextFiles(abs)) {
        items.push({ file: f, display: path.relative(ws, f).replace(/\\/g, '/') });
      }
    }
  }
  return items;
}

// ---------- 2. 脱敏 ----------
// 内置脱敏规则（量词必须有界——无界 + 对长文本会灾难回溯：450K 字符实测卡死）
const BASE_RULES = [
  [/[A-Za-z]:[\\/]{1,4}Users[\\/]{1,4}[^\\/\s"']{1,256}/g, '<USER_DIR>'],
  [/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,4}\.[A-Za-z]{2,24}/g, '<EMAIL>'],
  [/(?<!\d)1[3-9]\d{9}(?!\d)/g, '<PHONE>'],
];
function scrubRules() {
  const rules = BASE_RULES.slice();
  const f = arg('scrub');
  if (f && existsSync(f)) {
    for (const ln of readFileSync(f, 'utf8').split('\n')) {
      const s = ln.trim();
      if (!s || s.startsWith('#')) continue;
      const [pat, rep] = s.split('||', 2);
      try { rules.push([new RegExp(pat, 'g'), rep || '<SCRUBBED>']); } catch {}
    }
  }
  return rules;
}
function scrub(text, rules) {
  let hits = 0;
  let t = text;
  for (const [re, rep] of rules) {
    t = t.replace(re, () => { hits++; return rep; });
  }
  return { text: t, hits };
}

// ---------- 3. 组装 + 估算 ----------
const instructionCandidates = [
  path.join(HERE, '..', '..', ROLE_DIR, 'instructions', `${dimension}.md`),
  path.join(HERE, 'instructions', `${dimension}.md`),
];
const instructionsFile = instructionCandidates.find((file) => existsSync(file));
if (!instructionsFile) { console.error('缺少提示词模板: ' + instructionCandidates.join(' / ')); process.exit(2); }
const instructions = readFileSync(instructionsFile, 'utf8').trim();

const rules = scrubRules();
let items = collect();
if (!items.length) {
  emitResult({ ok: false, error: '未收集到任何材料（检查路径/清单）' });
  process.exit(4);
}
let truncatedCount = 0;
if (!arg('files')) {
  const bc = budgetCollect(items);
  items = bc.kept;
  truncatedCount = bc.skipped;
  if (!items.length) {
    emitResult({ ok: false, error: '材料预算内未收集到文件（单文件超过预算？）' });
    process.exit(4);
  }
}
const parts = [];
const stats = [];
let scrubHits = 0;
for (let i = 0; i < items.length; i++) {
  let content = '';
  try { content = readFileSync(items[i].file, 'utf8').replace(/^\uFEFF/, ''); } catch { continue; }
  const s = scrub(content, rules);
  scrubHits += s.hits;
  parts.push(`========== 文件 ${i + 1}/${items.length}: ${items[i].display} ==========\n\n${s.text.trim()}`);
  stats.push({ display: items[i].display, chars: s.text.length });
}
let inputText = parts.join('\n\n\n');
// 追加说明（发起人补充：跨文件上下文的提醒、本次审阅重点等）
const noteText = arg('note') || (arg('note-file') && existsSync(arg('note-file')) ? readFileSync(arg('note-file'), 'utf8').trim() : '');
if (noteText) inputText += `\n\n\n========== 补充说明（发起人） ==========\n\n${String(noteText).trim()}`;
const chars = instructions.length + inputText.length;
const estTokens = Math.round(chars * 0.7);
const estFee = +(chars * FEE_PER_CHAR).toFixed(1);

if (chars > maxChars) {
  emitResult({ ok: false, error: `材料过大（${chars} 字符 > 上限 ${maxChars}）——请精简材料` });
  process.exit(5);
}
if (estFee > cfg.maxFeeCny && !flag('confirm') && !flag('dry-run')) {
  emitResult({ ok: false, needsConfirm: true, estFee, estTokens, chars, files: stats.length, limit: cfg.maxFeeCny });
  process.exit(3);
}

if (flag('dry-run')) {
  console.log(`${LOG_PREFIX} dry-run：${stats.length} 文件 / ${chars.toLocaleString()} 字符（in-tokens ≈ ${estTokens.toLocaleString()}；估算 ¥${estFee}；脱敏命中 ${scrubHits}${truncatedCount ? '；因预算跳过 ' + truncatedCount + ' 个文件' : ''}）`);
  emitResult({ ok: true, dryRun: true, mode: MODE, role: ROLE_LABEL, dimension, files: stats.length, chars, estTokens, estFee, scrubHits, model: cfg.model, endpoint: cfg.endpoint, protocol: cfg.protocol, configSource: cfg.source, truncated: truncatedCount });
  process.exit(0);
}

// ---------- 4. 发送（Responses / Chat 双协议，SSE 流式） ----------
const actionLabel = MODE === 'guide' ? '指导' : '审阅';
console.log(`${LOG_PREFIX} 发送中：${dimension} ${actionLabel} · ${stats.length} 文件 / ${chars.toLocaleString()} 字符 · 估算 ¥${estFee} · ${cfg.model} @ ${cfg.endpoint}（${cfg.protocol}${cfg.hasKey ? '，带 key' : ''}）`);
const t0 = Date.now();
const headers = { 'Content-Type': 'application/json' };
if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;

async function streamRun() {
  const body = cfg.protocol === 'chat'
    ? { model: cfg.model, messages: [{ role: 'user', content: instructions + '\n\n' + inputText }], stream: true }
    : { model: cfg.model, instructions, input: inputText };
  const res = await fetch(cfg.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 300)}` };
  }
  const reader = res.body.getReader();
  let buf = '';
  let finalText = null, chatText = '', usage = null, failMsg = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += Buffer.from(value).toString('utf8');
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const pl = s.slice(5).trim();
      if (!pl || pl === '[DONE]') continue;
      let evt; try { evt = JSON.parse(pl); } catch { continue; }
      if (cfg.protocol === 'chat') {
        const ch = evt.choices && evt.choices[0];
        if (ch && ch.delta && typeof ch.delta.content === 'string') chatText += ch.delta.content;
        if (ch && ch.message && typeof ch.message.content === 'string' && !chatText) chatText += ch.message.content;
        if (evt.usage) usage = evt.usage;
        if (evt.error) failMsg = (evt.error && evt.error.message) || JSON.stringify(evt.error).slice(0, 300);
      } else {
        if (evt.type === 'response.output_text.done') finalText = evt.text;
        else if (evt.type === 'response.completed') usage = (evt.response || {}).usage;
        else if (evt.type === 'response.failed') failMsg = ((evt.response || {}).error || {}).message || JSON.stringify(evt).slice(0, 300);
      }
    }
  }
  if (failMsg) return { ok: false, error: failMsg };
  const text = cfg.protocol === 'chat' ? chatText : finalText;
  if (text === null || text === undefined || text === '') return { ok: false, error: '上游未返回文本内容' };
  return { ok: true, text, usage };
}

let run = null;
try { run = await streamRun(); } catch (e) { run = { ok: false, error: String((e && e.message) || e) }; }
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

if (!run.ok) {
  const hint = cfg.endpoint.includes('127.0.0.1:3220')
    ? `（本地桥不可达/key 失效？检查桥进程或 ${CONFIG_FILE}）`
    : `（检查 ${CONFIG_FILE} 的 endpoint/key/model）`;
  console.error(`${LOG_PREFIX} ✗ 失败（${elapsed}s）：${run.error} ${hint}`);
  emitResult({ ok: false, mode: MODE, role: ROLE_LABEL, dimension, error: run.error, hint, elapsedS: +elapsed });
  process.exit(6);
}
let { text: finalText, usage } = run;

// ---------- 5. 报告落盘 ----------
const outDir = arg('out', path.join(ws, REPORT_DIR));
mkdirSync(outDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
const runId = Math.random().toString(36).slice(2, 6);
const reportPath = path.join(outDir, `${REPORT_PREFIX}-${dimension}-${ts}-${runId}.md`);
const inTok = usage && (usage.input_tokens || usage.prompt_tokens);
const outTok = usage && (usage.output_tokens || usage.completion_tokens);
const reportTitle = MODE === 'guide' ? '指导报告' : '审核报告';
const header = [
  `# ${ROLE_LABEL} ${reportTitle} · ${DIM_LABEL[MODE][dimension]} · ${cfg.model}`,
  ``,
  `- 生成：${new Date().toISOString()}　角色：${ROLE_LABEL}　维度：${dimension}（${DIM_LABEL[MODE][dimension]}）　通道：${cfg.endpoint}（${cfg.protocol}）→ ${cfg.model}`,
  `- 材料：${stats.length} 文件 / ${chars.toLocaleString()} 字符（in-tokens ≈ ${estTokens.toLocaleString()}）　脱敏命中：${scrubHits}${noteText ? '　含补充说明' : ''}`,
  `- 用量：${inTok ? 'in=' + inTok.toLocaleString() + ' / out=' + outTok.toLocaleString() : '（上游未回报）'}　耗时：${elapsed}s　估算费用：≈¥${estFee}（B-Audit 标定）`,
  ``,
  `---`,
  ``,
].join('\n');
writeFileSync(reportPath, header + finalText, 'utf8');
const metaPath = reportPath.replace(/\.md$/, '.meta.json');
writeFileSync(metaPath, JSON.stringify({ mode: MODE, role: ROLE_LABEL, dimension, model: cfg.model, endpoint: cfg.endpoint, protocol: cfg.protocol, configSource: cfg.source, hasKey: cfg.hasKey, files: stats.length, chars, estTokens, estFee, scrubHits, note: !!noteText, elapsedS: +elapsed, usage, reportPath }, null, 2), 'utf8');

console.log(`${LOG_PREFIX} ✓ 完成（${elapsed}s）→ ${reportPath}`);
emitResult({ ok: true, mode: MODE, role: ROLE_LABEL, dimension, model: cfg.model, endpoint: cfg.endpoint, protocol: cfg.protocol, configSource: cfg.source, files: stats.length, chars, estTokens, estFee, scrubHits, truncated: truncatedCount, elapsedS: +elapsed, usage, reportPath });
