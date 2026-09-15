#!/usr/bin/env node
/**
 * MMCAS provider 切换器 v1
 * 把 providers.yaml 中的选中项写入 dsh 配置（settings.yaml + .credentials.yaml），零 npm 依赖。
 *
 * 用法:
 *   node switch-provider.mjs list [--config <providers.yaml>]
 *   node switch-provider.mjs switch <id> [--model <模型名>] [--config <...>] [--settings <settings.yaml>] [--credentials <...>] [--dry-run]
 *
 * 机制（实测 dsh 0.1.2-rc.1）:
 *   - settings.yaml 的 `llm-deepseek:` 段热覆盖 baseURL/apiKeyEnv，无需重启
 *   - .credentials.yaml 的 refs 段存 env 名→key 映射，apiKeyEnv 引用该 env 名
 *   - agent-default-model 段切换默认模型（--model 指定，缺省取 models 列表首项）
 *   - llm-deepseek 段写入 baseURL/apiKeyEnv/reasoningEffort + models 目录：
 *     catalog 由 providers.yaml 的 models 生成（dsh settings 的 models 会整体替换
 *     内置默认列表，故必须写全）；段内其余手动维护的键保留不动
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

// ---------- providers.yaml 解析（固定 schema 的 YAML 子集） ----------
function parseProviders(text) {
  const providers = [];
  let cur = null;
  let models = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = line.match(/^(\s*)([^#]*?)\s*$/);
    if (!m || m[2] === '') continue;
    const indent = m[1].length;
    const body = m[2];
    if (indent === 0) continue; // default 等顶层键，暂不处理
    if (indent === 2 && body.startsWith('- ')) {
      const kv = body.slice(2).split(':');
      if (kv[0] === 'id') { cur = { id: kv.slice(1).join(':').trim(), models: [] }; providers.push(cur); }
      continue;
    }
    if (indent === 4 && cur) {
      const kv = body.split(':');
      const key = kv[0].trim();
      const val = kv.slice(1).join(':').trim();
      if (key === 'name') cur.name = val;
      else if (key === 'base_url') cur.base_url = val;
      else if (key === 'api_key') cur.api_key = val;
      else if (key === 'models') { models = cur.models; } // 列表开始
    }
    if (indent === 6 && models) {
      models.push(body.replace(/^-\s*/, '').trim());
    }
  }
  return providers;
}

// ---------- YAML 段工具 ----------
// 替换顶层段内容（找不到则追加）
function setYamlSection(text, sectionName, lines) {
  const out = [];
  let inSection = false;
  for (const line of text.split('\n')) {
    if (!inSection && line.startsWith(sectionName + ':')) { inSection = true; continue; }
    if (inSection) {
      if (/^\S/.test(line) && line.trim() !== '') { inSection = false; out.push(line); }
      continue;
    }
    out.push(line);
  }
  return out.join('\n').trimEnd() + '\n' + lines.join('\n') + '\n';
}

// 在指定顶层段的子键中设置 key: value（段内缩进 2 空格；找不到子键则插入段尾）
function setKeyInSection(text, sectionName, key, value) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  let sectionStart = -1;
  while (i < lines.length) {
    if (lines[i].startsWith(sectionName + ':')) { sectionStart = i; break; }
    i++;
  }
  if (sectionStart === -1) return text; // 段不存在，调用方先 setYamlSection
  // 行内空映射（如 `refs: {}`）先转块格式，否则追加子键会产出 BAD_INDENT
  if (/^\S+:\s*\{\s*\}\s*$/.test(lines[sectionStart])) {
    lines[sectionStart] = lines[sectionStart].replace(/\s*\{\s*\}\s*$/, '');
  }
  // 找到段尾（下一个顶层键或文件尾）
  let j = sectionStart + 1;
  while (j < lines.length && !(/^\S/.test(lines[j]) && lines[j].trim() !== '')) j++;
  const sec = lines.slice(sectionStart + 1, j);
  let replaced = false;
  const newSec = [];
  for (const line of sec) {
    if (line.trimStart().startsWith(key + ':')) {
      newSec.push(`  ${key}: ${value}`);
      replaced = true;
    } else newSec.push(line);
  }
  if (!replaced) {
    while (newSec.length && newSec[newSec.length - 1].trim() === '') newSec.pop();
    newSec.push(`  ${key}: ${value}`);
  }
  return [...lines.slice(0, sectionStart + 1), ...newSec, ...lines.slice(j)].join('\n');
}

// 在指定段内设置多行块（如 models: 列表）：块已存在则整体替换，不存在则追加到段尾
function setBlockInSection(text, sectionName, key, blockLines) {
  const lines = text.split('\n');
  let s = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(sectionName + ':')) { s = i; break; }
  }
  if (s === -1) return text;
  let e = s + 1;
  while (e < lines.length && !(/^\S/.test(lines[e]) && lines[e].trim() !== '')) e++;
  const keyRe = new RegExp('^ {2}' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':');
  let k = -1;
  for (let i = s + 1; i < e; i++) {
    if (keyRe.test(lines[i])) { k = i; break; }
  }
  if (k === -1) return [...lines.slice(0, e), ...blockLines, ...lines.slice(e)].join('\n');
  let kb = k + 1;
  while (kb < e && !/^ {0,2}\S/.test(lines[kb])) kb++; // 块尾 = 段内下一个键（缩进 ≤2）或段尾
  return [...lines.slice(0, k), ...blockLines, ...lines.slice(kb)].join('\n');
}

// ---------- 模型目录（dsh catalog） ----------
// dsh 的 settings `llm-deepseek.models` 会整体替换内置默认目录，故由 providers.yaml 的
// models 生成完整 catalog；已知官方模型补元数据（否则会丢失图片能力等声明）。
const KNOWN_MODEL_META = {
  'deepseek-v4-flash': { name: 'DeepSeek-V4-Flash' },
  'deepseek-v4-pro': { name: 'DeepSeek-V4-Pro' },
  'deepseek-v4-flash-vision-exp': {
    name: 'DeepSeek-V4-Flash-Vision-Exp',
    inputModalities: ['text', 'image'],
    imagePixelBudget: 640000,
    imageMaxBytes: 1048576,
  },
  'deepseek-v4.1-flash-expires-on-0910': {
    name: 'DeepSeek-V4.1-Flash (expires-on-0910)',
    description: 'Limited-time preview; billing same as v4-flash.',
  },
};

function yamlQuote(v) {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// 生成 llm-deepseek 段内的 models 块（首行缩进 2）
function buildCatalogLines(models) {
  const out = ['  models:'];
  for (const id of models) {
    const meta = KNOWN_MODEL_META[id] || {};
    out.push(`    - id: ${id}`);
    if (meta.name) out.push(`      name: ${yamlQuote(meta.name)}`);
    if (meta.description) out.push(`      description: ${yamlQuote(meta.description)}`);
    if (meta.inputModalities) out.push(`      inputModalities: [${meta.inputModalities.join(', ')}]`);
    if (meta.imagePixelBudget) out.push(`      imagePixelBudget: ${meta.imagePixelBudget}`);
    if (meta.imageMaxBytes) out.push(`      imageMaxBytes: ${meta.imageMaxBytes}`);
  }
  return out;
}

// ---------- 命令 ----------
const cmd = process.argv[2];
const configPath = arg('config', path.join(process.cwd(), 'config', 'providers.yaml'));
if (!existsSync(configPath)) {
  console.error(`[mmcas] 找不到 providers.yaml: ${configPath}`);
  process.exit(2);
}
const providers = parseProviders(readFileSync(configPath, 'utf8'));

if (cmd === 'list') {
  console.log('providers.yaml 中的 API 来源:');
  for (const p of providers) {
    const keyShown = p.api_key ? `key=${p.api_key.slice(0, 6)}...` : 'key=未填';
    console.log(`  ${p.id}  ${p.name}  ${p.base_url}  ${keyShown}  models=[${(p.models || []).join(', ')}]`);
  }
  process.exit(0);
}

if (cmd === 'switch') {
  const id = process.argv[3];
  const p = providers.find((x) => x.id === id);
  if (!p) {
    console.error(`[mmcas] 未找到 provider: ${id}（可用: ${providers.map((x) => x.id).join(', ')}）`);
    process.exit(2);
  }
  const models = p.models || [];
  const modelArg = arg('model', null);
  if (modelArg && !models.includes(modelArg)) {
    console.error(`[mmcas] provider「${id}」的 models 列表中没有 ${modelArg}（可用: ${models.join(', ') || '无'}）`);
    process.exit(2);
  }
  const chosenModel = modelArg || models[0] || 'deepseek-v4-flash';
  const settingsPath = arg('settings', path.join(os.homedir(), '.dsh', 'settings.yaml'));
  const credPath = arg('credentials', path.join(os.homedir(), '.dsh', '.credentials.yaml'));
  const dryRun = process.argv.includes('--dry-run');

  const settingsText = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '';
  const credText = existsSync(credPath) ? readFileSync(credPath, 'utf8') : 'version: 1\nrefs:\n';

  // 1. llm-deepseek 段：已存在则逐键更新（保留其他手动键），不存在则新建
  //    models 目录由 providers.yaml 生成；models 为空时不写（避免清空内置目录）
  const catalogLines = models.length > 0 ? buildCatalogLines(models) : null;
  const hasDeepseekSection = settingsText.split('\n').some((l) => l.startsWith('llm-deepseek:'));
  let newSettings;
  if (hasDeepseekSection) {
    newSettings = setKeyInSection(settingsText, 'llm-deepseek', 'baseURL', p.base_url);
    newSettings = setKeyInSection(newSettings, 'llm-deepseek', 'apiKeyEnv', 'MMCAS_PROVIDER_KEY');
    newSettings = setKeyInSection(newSettings, 'llm-deepseek', 'reasoningEffort', 'high');
    if (catalogLines) newSettings = setBlockInSection(newSettings, 'llm-deepseek', 'models', catalogLines);
  } else {
    newSettings = setYamlSection(settingsText, 'llm-deepseek', [
      `llm-deepseek:`,
      `  baseURL: ${p.base_url}`,
      `  apiKeyEnv: MMCAS_PROVIDER_KEY`,
      `  reasoningEffort: high`,
      ...(catalogLines || []),
    ]);
  }
  // 2. agent-default-model 段（缺失时创建，避免新装环境切换后默认模型不生效）
  if (newSettings.includes('agent-default-model:')) {
    newSettings = setKeyInSection(newSettings, 'agent-default-model', 'provider', 'deepseek-official');
    newSettings = setKeyInSection(newSettings, 'agent-default-model', 'model', chosenModel);
  } else {
    newSettings = newSettings.trimEnd() + '\nagent-default-model:\n  provider: deepseek-official\n  model: ' + chosenModel + '\n';
  }
  // 3. credentials refs
  let newCred = credText;
  if (/^refs:/m.test(newCred)) {
    newCred = setKeyInSection(newCred, 'refs', 'MMCAS_PROVIDER_KEY', p.api_key || 'sk-未填写');
  } else {
    newCred = newCred.trimEnd() + '\nrefs:\n  MMCAS_PROVIDER_KEY: ' + (p.api_key || 'sk-未填写') + '\n';
  }

  if (dryRun) {
    console.log('--- dry-run: 将写入 settings.yaml ---');
    console.log(newSettings);
    console.log('--- dry-run: 将写入 .credentials.yaml（key 已省略） ---');
    console.log(newCred.replace(/MMCAS_PROVIDER_KEY: .*/, 'MMCAS_PROVIDER_KEY: <hidden>'));
  } else {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    mkdirSync(path.dirname(credPath), { recursive: true });
    writeFileSync(settingsPath, newSettings);
    writeFileSync(credPath, newCred);
    console.log(`[mmcas] 已切换到 ${p.name}（${p.base_url}），dsh 下一请求即生效`);
  }
  process.exit(0);
}

console.error('用法: node switch-provider.mjs list | switch <id> [--dry-run]');
process.exit(2);
