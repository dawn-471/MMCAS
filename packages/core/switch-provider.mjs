#!/usr/bin/env node
/**
 * MMCAS provider 切换器 v2
 *
 * 把 providers.yaml 中的选中项写入 dsh 活动 profile 的 cordis.patch.yml
 * （dsh 0.2.x 的运行时配置源），并同步 .credentials.yaml 的 refs。
 *
 * 用法:
 *   node switch-provider.mjs list [--config <providers.yaml>]
 *   node switch-provider.mjs switch <id> [--model <模型>] [--config <...>]
 *     [--dsh-home <dir>] [--profile <name>|--profiles <a,b>] [--credentials <...>] [--dry-run]
 *   # 兼容旧调用：只给 --settings <settings.yaml> 时写 legacy settings.yaml（dsh 会一次性导入）
 *
 * 机制:
 *   - 默认写 <DSH_HOME>/profiles/<profile>/cordis.patch.yml 的 llm-deepseek /
 *     agent-default-model 条目；按 key 合并，保留 profile patch 中其他设置/插件。
 *   - llm-deepseek 写 baseURL/apiKeyEnv/reasoningEffort，并用 providers.yaml 的
 *     models 生成完整 catalog（models 为空时不覆盖既有 catalog）。
 *   - credentials 的 refs 写 MMCAS_PROVIDER_KEY；其他 refs/records 保留。
 *   - dsh 0.2.x 的 settings.yaml 只做一次性导入兼容；存在时同步更新，避免旧值回灌。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  upsertEntry, getEntry, setEntryConfigScalars, setEntryConfigBlock,
  readText, writeText, yamlScalar, ensureProfileScaffold,
} from './profile-patch.mjs';

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
// v1.2 T6.1：出厂默认声明图片输入能力（消灭"想看图被本地门禁拒"——回收分析 read_image 546 次）；
// 参数化：--image-pixel-budget / --image-max-bytes / 环境变量 MMCAS_IMAGE_*；--no-image 关闭默认。
function visionDefaults() {
  if (process.argv.includes('--no-image')) return null;
  const px = parseInt(arg('image-pixel-budget', process.env.MMCAS_IMAGE_PIXEL_BUDGET || '640000'), 10) || 640000;
  const mb = parseInt(arg('image-max-bytes', process.env.MMCAS_IMAGE_MAX_BYTES || '1048576'), 10) || 1048576;
  return { inputModalities: ['text', 'image'], imagePixelBudget: px, imageMaxBytes: mb };
}
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
  const vd = visionDefaults();
  const out = ['  models:'];
  for (const id of models) {
    // v1.2 T6.1：默认图片能力，已知元数据可覆盖/补充
    const meta = { ...(vd || {}), ...(KNOWN_MODEL_META[id] || {}) };
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
  const explicitSettings = arg('settings', null);
  const explicitProfile = process.argv.includes('--profile') || process.argv.includes('--profiles') || process.argv.includes('--dsh-home');
  const dshHome = arg('dsh-home', process.env.DSH_HOME || path.join(os.homedir(), '.dsh'));
  const profileNames = String(arg('profiles', arg('profile', process.env.MMCAS_DSH_PROFILE || 'web')))
    .split(',').map((s) => s.trim()).filter(Boolean);
  const settingsPath = explicitSettings || path.join(dshHome, 'settings.yaml');
  const credPath = arg('credentials', explicitSettings
    ? path.join(path.dirname(settingsPath), '.credentials.yaml')
    : path.join(dshHome, '.credentials.yaml'));
  const dryRun = process.argv.includes('--dry-run');
  // v1.2 T6.1：reasoningEffort 按角色默认（coder=max / writer=high / modeler=high），可 --effort 覆盖
  const roleArg = arg('role', process.env.MMCAS_ROLE || '');
  const effort = arg('effort', ({ coder: 'max', writer: 'high', modeler: 'high' })[roleArg] || 'high');
  // 只给 --settings、未给 profile 参数 = 旧版 legacy 模式（测试/旧脚本兼容）。
  const legacyOnly = !!explicitSettings && !explicitProfile;

  const credText = existsSync(credPath) ? readFileSync(credPath, 'utf8') : 'version: 1\nrefs:\n';
  let newCred = credText;
  if (/^refs:/m.test(newCred)) {
    newCred = setKeyInSection(newCred, 'refs', 'MMCAS_PROVIDER_KEY', p.api_key || 'sk-未填写');
  } else {
    newCred = newCred.trimEnd() + '\nrefs:\n  MMCAS_PROVIDER_KEY: ' + (p.api_key || 'sk-未填写') + '\n';
  }

  const catalogLines = models.length > 0 ? buildCatalogLines(models) : null;
  // settings.yaml 是 2 空格段；profile patch 的 config 下多缩进 2 空格。
  const catalogLines4 = catalogLines ? catalogLines.map((line) => '  ' + line) : null;
  const deepseekBlock = [
    '- id: llm-deepseek',
    "  name: '@deepseek-ai/dsh-llm-deepseek-api-key'",
    '  config:',
    `    baseURL: ${yamlScalar(p.base_url)}`,
    '    apiKeyEnv: MMCAS_PROVIDER_KEY',
    `    reasoningEffort: ${yamlScalar(effort)}`,
    ...(catalogLines4 || []),
  ].join('\n');
  const agentBlock = [
    '- id: agent-default-model',
    "  name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    '    provider: deepseek-official',
    `    model: ${yamlScalar(chosenModel)}`,
  ].join('\n');

  function applyToProfilePatch(text) {
    let patch = text;
    if (!getEntry(patch, 'llm-deepseek')) patch = upsertEntry(patch, 'llm-deepseek', deepseekBlock);
    else {
      patch = setEntryConfigScalars(patch, 'llm-deepseek', {
        baseURL: p.base_url,
        apiKeyEnv: 'MMCAS_PROVIDER_KEY',
        reasoningEffort: effort,
      });
      if (catalogLines4) patch = setEntryConfigBlock(patch, 'llm-deepseek', 'models', catalogLines4);
    }
    if (!getEntry(patch, 'agent-default-model')) patch = upsertEntry(patch, 'agent-default-model', agentBlock);
    else patch = setEntryConfigScalars(patch, 'agent-default-model', { provider: 'deepseek-official', model: chosenModel });
    return patch;
  }
  function applyToLegacySettings(text) {
    let out = text;
    if (out.split('\n').some((line) => line.startsWith('llm-deepseek:'))) {
      out = setKeyInSection(out, 'llm-deepseek', 'baseURL', p.base_url);
      out = setKeyInSection(out, 'llm-deepseek', 'apiKeyEnv', 'MMCAS_PROVIDER_KEY');
      out = setKeyInSection(out, 'llm-deepseek', 'reasoningEffort', effort);
      if (catalogLines) out = setBlockInSection(out, 'llm-deepseek', 'models', catalogLines);
    } else {
      out = setYamlSection(out, 'llm-deepseek', [
        'llm-deepseek:',
        `  baseURL: ${p.base_url}`,
        '  apiKeyEnv: MMCAS_PROVIDER_KEY',
        `  reasoningEffort: ${effort}`,
        ...(catalogLines || []),
      ]);
    }
    if (out.includes('agent-default-model:')) {
      out = setKeyInSection(out, 'agent-default-model', 'provider', 'deepseek-official');
      out = setKeyInSection(out, 'agent-default-model', 'model', chosenModel);
    } else {
      out = out.trimEnd() + '\nagent-default-model:\n  provider: deepseek-official\n  model: ' + chosenModel + '\n';
    }
    return out;
  }

  const patches = [];
  if (!legacyOnly) {
    for (const profile of profileNames) {
      const profileDir = path.join(dshHome, 'profiles', profile);
      const manifestPath = path.join(profileDir, 'package.json');
      if (!existsSync(manifestPath)) {
        console.warn(`[mmcas] profile 不存在，跳过: ${profileDir}`);
        continue;
      }
      ensureProfileScaffold(profileDir, { name: `dsh-profile-${profile}` });
      const patchFile = path.join(profileDir, 'cordis.patch.yml');
      const patch = applyToProfilePatch(readText(patchFile, '# MMCAS profile patch\n[]\n'));
      patches.push({ profile, patchFile, patch });
    }
    if (!patches.length && !explicitSettings) {
      console.error(`[mmcas] 没有可写的 profile（${profileNames.join(', ') || '空'}）；先运行 write-config 或指定 --dsh-home/--profiles`);
      process.exit(2);
    }
  }

  // 旧 settings.yaml 只在显式指定或已存在时同步，避免新装环境重新生成 legacy 文件。
  const legacyText = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : (explicitSettings ? '' : null);
  const legacyNew = legacyText !== null ? applyToLegacySettings(legacyText) : null;

  if (dryRun) {
    for (const item of patches) {
      console.log(`--- dry-run: ${item.profile} ${item.patchFile} ---`);
      console.log(item.patch);
    }
    if (legacyNew !== null) {
      console.log('--- dry-run: legacy settings.yaml（兼容同步） ---');
      console.log(legacyNew);
    }
    console.log('--- dry-run: 将写入 .credentials.yaml（key 已省略） ---');
    console.log(newCred.replace(/MMCAS_PROVIDER_KEY: .*/, 'MMCAS_PROVIDER_KEY: <hidden>'));
  } else {
    for (const item of patches) writeText(item.patchFile, item.patch);
    if (legacyNew !== null) {
      mkdirSync(path.dirname(settingsPath), { recursive: true });
      writeFileSync(settingsPath, legacyNew);
    }
    mkdirSync(path.dirname(credPath), { recursive: true });
    writeFileSync(credPath, newCred);
    const targets = patches.length ? patches.map((x) => x.profile).join(', ') : 'legacy settings.yaml';
    console.log(`[mmcas] 已切换到 ${p.name}（${p.base_url}），写入 ${targets}；dsh 重载/重启后生效`);
  }
  process.exit(0);
}

console.error('用法: node switch-provider.mjs list | switch <id> [--dry-run]');
process.exit(2);
