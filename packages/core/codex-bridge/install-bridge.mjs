#!/usr/bin/env node
/**
 * install-bridge.mjs — 一键接入 PackyAPI Codex 通道（幂等，可重复运行）
 *
 * 背景：PackyAPI 的 codex 分组仅接受标准 Codex 客户端（反二次分发检测），
 * 直连会被拦截。故以真实 codex CLI 为通道，经本地 codex-bridge 服务
 * 暴露 OpenAI Responses 端点，供 dsh 的 pi-ai 适配器使用。
 *
 * 本脚本写四份配置：
 *   1. <mmcas-home>/codex-home/auth.json     Codex CLI 凭据（PackyAPI key）
 *   2. <mmcas-home>/codex-home/config.toml   Codex CLI provider 指向 cf.api.fan
 *   3. <mmcas-home>/codex-bridge.json        桥接服务配置
 *   4. <dsh-home>/settings.yaml              llm-pi-ai 段（保留其他段）
 *   5. <dsh-home>/.credentials.yaml          MMCAS_CODEXBRIDGE_KEY 引用
 *
 * 用法：
 *   node install-bridge.mjs --key-file <packy-key.txt> [选项]
 *
 * 选项：
 *   --key-file <path>   PackyAPI key 文件（一行）；也可用 --key 直接给
 *   --key <value>       直接指定 key（不推荐，命令行会留痕）
 *   --dsh-home <path>   dsh home（默认 %LOCALAPPDATA%\mmcas\dsh-home）
 *   --mmcas-home <path> MMCAS 数据目录（默认 %LOCALAPPDATA%\mmcas）
 *   --port <n>          桥接端口（默认 3220）
 *   --proxy <url>       HTTPS 代理（如 http://127.0.0.1:7897；留空则直连）
 *   --base-url <url>    Codex 上游（默认 https://cf.api.fan/v1）
 *   --models a,b        模型 id 列表（默认 gpt-5.6-sol,gpt-5.6-terra）
 *   --dry-run           只打印将要写入的内容，不落盘
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const KEY_FILE = arg('key-file', '');
const DSH_HOME = arg('dsh-home', path.join(process.env.LOCALAPPDATA || os.homedir(), 'mmcas', 'dsh-home'));
const MMCAS_HOME = arg('mmcas-home', path.join(process.env.LOCALAPPDATA || os.homedir(), 'mmcas'));
const PORT = Number(arg('port', '3220'));
const PROXY = arg('proxy', '');
const BASE_URL = arg('base-url', 'https://cf.api.fan/v1');
const MODELS = arg('models', 'gpt-5.6-sol,gpt-5.6-terra')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const DRY = process.argv.includes('--dry-run');

// ---------- key ----------
let key = arg('key', '');
if (!key && KEY_FILE) {
  if (!existsSync(KEY_FILE)) {
    console.error(`[install-bridge] key 文件不存在: ${KEY_FILE}`);
    process.exit(1);
  }
  key = readFileSync(KEY_FILE, 'utf8').trim();
}
if (!key) {
  console.error('[install-bridge] 缺少 PackyAPI key（--key-file 或 --key）');
  process.exit(1);
}

// ---------- YAML 工具（与 switch-provider.mjs 同款，保留其他段） ----------
function setYamlSection(text, sectionName, lines) {
  const out = [];
  let inSection = false;
  for (const line of text.split('\n')) {
    if (!inSection && line.startsWith(sectionName + ':')) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (/^\S/.test(line) && line.trim() !== '') {
        inSection = false;
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n').trimEnd() + '\n' + lines.join('\n') + '\n';
}

function ensureKeyInRefs(text, keyName, value) {
  const lines = text.split('\n');
  const out = [];
  let inRefs = false;
  let inserted = false;
  for (const line of lines) {
    if (!inRefs && /^refs:\s*$/.test(line)) {
      inRefs = true;
      out.push(line);
      if (!lines.some((l) => l.trim().startsWith(keyName + ':'))) {
        out.push(`  ${keyName}: ${value}`);
        inserted = true;
      }
      continue;
    }
    if (inRefs) {
      if (/^\S/.test(line) && line.trim() !== '') {
        inRefs = false;
      } else if (line.trim().startsWith(keyName + ':')) {
        out.push(`  ${keyName}: ${value}`);
        continue;
      }
    }
    out.push(line);
  }
  // 没有 refs 段：补一个
  if (!inserted && !out.some((l) => /^refs:/.test(l))) {
    return out.join('\n').trimEnd() + `\nrefs:\n  ${keyName}: ${value}\n`;
  }
  return out.join('\n');
}

function modelName(id) {
  // gpt-5.6-sol → GPT-5.6 Sol (Codex)
  const m = /^gpt-(.+)-([a-z]+)$/.exec(id);
  if (m) return `GPT-${m[1]} ${m[2].charAt(0).toUpperCase() + m[2].slice(1)} (Codex)`;
  return `${id} (Codex)`;
}

// ---------- 生成内容 ----------
const codexHome = path.join(MMCAS_HOME, 'codex-home');
const authJson = JSON.stringify({ OPENAI_API_KEY: key }, null, 2) + '\n';
const configToml = `# MMCAS Codex 通道（PackyAPI / codex 分组）— 由 install-bridge.mjs 生成
disable_response_storage = true
model = "${MODELS[0]}"
model_provider = "packycode"
model_reasoning_effort = "high"

[model_providers.packycode]
base_url = "${BASE_URL}"
name = "packycode"
requires_openai_auth = true
wire_api = "responses"
`;
const bridgeJson =
  JSON.stringify(
    {
      host: '127.0.0.1',
      port: PORT,
      models: MODELS,
      codexHome: codexHome.replace(/\\/g, '/'),
      proxy: PROXY,
      timeoutMs: 600000,
      logFile: path.join(MMCAS_HOME, 'logs', 'codex-bridge.log').replace(/\\/g, '/'),
    },
    null,
    2,
  ) + '\n';

const piAiLines = [
  'llm-pi-ai:',
  '  providers:',
  '    codexbridge:',
  '      displayName: PackyAPI (Codex)',
  '      apiKeyEnv: MMCAS_CODEXBRIDGE_KEY',
  '      api: openai-responses',
  `      baseURL: http://127.0.0.1:${PORT}/v1`,
  '      models:',
  ...MODELS.flatMap((m) => [
    `        - id: ${m}`,
    `          name: ${modelName(m)}`,
    '          contextWindow: 400000',
  ]),
];

const settingsPath = path.join(DSH_HOME, 'settings.yaml');
const credPath = path.join(DSH_HOME, '.credentials.yaml');

if (DRY) {
  console.log('--- codex-home/auth.json ---\n' + authJson.replace(/"sk-[^"]+"/, '"sk-***"'));
  console.log('--- codex-home/config.toml ---\n' + configToml);
  console.log('--- codex-bridge.json ---\n' + bridgeJson);
  console.log('--- settings.yaml 追加段 ---\n' + piAiLines.join('\n'));
  console.log('--- .credentials.yaml 追加 ---\nrefs:\n  MMCAS_CODEXBRIDGE_KEY: dummy-bridge-token');
  process.exit(0);
}

// ---------- 落盘 ----------
mkdirSync(codexHome, { recursive: true });
mkdirSync(path.dirname(path.join(MMCAS_HOME, 'logs', 'x')), { recursive: true });
mkdirSync(DSH_HOME, { recursive: true });

writeFileSync(path.join(codexHome, 'auth.json'), authJson, 'utf8');
writeFileSync(path.join(codexHome, 'config.toml'), configToml, 'utf8');
writeFileSync(path.join(MMCAS_HOME, 'codex-bridge.json'), bridgeJson, 'utf8');

const settingsText = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '';
const newSettings = setYamlSection(settingsText, 'llm-pi-ai', piAiLines);
writeFileSync(settingsPath, newSettings, 'utf8');

const credText = existsSync(credPath) ? readFileSync(credPath, 'utf8') : 'version: 1\nrefs:\n';
const newCred = ensureKeyInRefs(credText, 'MMCAS_CODEXBRIDGE_KEY', 'dummy-bridge-token');
writeFileSync(credPath, newCred, 'utf8');

console.log('[install-bridge] 已写入：');
console.log(`  ${path.join(codexHome, 'auth.json')}`);
console.log(`  ${path.join(codexHome, 'config.toml')}`);
console.log(`  ${path.join(MMCAS_HOME, 'codex-bridge.json')}`);
console.log(`  ${settingsPath}（llm-pi-ai 段）`);
console.log(`  ${credPath}（MMCAS_CODEXBRIDGE_KEY）`);
console.log(`[install-bridge] 模型：${MODELS.join(', ')} | 端口：${PORT} | 代理：${PROXY || '（直连）'}`);
console.log('[install-bridge] 下一步：启动 codex-bridge（start-bridge.bat），再启动 dsh。');
