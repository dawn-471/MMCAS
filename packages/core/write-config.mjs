#!/usr/bin/env node
/**
 * MMCAS 队友机配置生成器（setup 阶段运行）
 * 用法: node write-config.mjs --role <coder|writer|modeler> --base <包根目录> [--dsh-home <dir>] [--with-desktop]
 *
 * 生成: config/sync.config.json、config/providers.yaml（预配 key 则填入）、
 *       <DSH_HOME>/profiles/web 与 profiles/desktop（合并式 patch，保留 dsh 设置/插件）、
 *       dsh workspace 注册、skills。
 * 注意: 0.2.x 的运行时设置源是 profile 的 cordis.patch.yml；脚本不再覆盖 settings.yaml。
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync, copyFileSync, cpSync, rmSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {
  ensureProfileScaffold, mergeProfileManifest, ensureProfileLink, upsertEntry, getEntry,
  setEntryConfigScalars, setEntryConfigBlock, writeText, readText, indentLines, yamlScalar, repairBrokenLinks,
} from './profile-patch.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}
const ROLE = arg('role') || 'coder';
const BASE = arg('base') || process.cwd();
const DSH_HOME = arg('dsh-home') || path.join(os.homedir(), '.dsh');

const cfgDir = path.join(BASE, 'config');
mkdirSync(cfgDir, { recursive: true });

// 1. sync.config.json
const syncCfg = {
  repoDir: path.join(BASE, 'workspace').replace(/\\/g, '/'),
  gitBin: path.join(BASE, 'pkg', 'git', 'cmd', 'git.exe').replace(/\\/g, '/'),
  pullIntervalSec: 60,
  authorName: `mmcas-${ROLE}`,
  authorEmail: `${ROLE}@mmcas.local`,
  remote: 'origin',
  branch: 'main',
  logDir: path.join(BASE, 'logs').replace(/\\/g, '/'),
};
writeFileSync(path.join(cfgDir, 'sync.config.json'), JSON.stringify(syncCfg, null, 2));

// 2. providers.yaml（从 example 拷；有预配 key 则填入 deepseek 段）
const example = path.join(cfgDir, 'providers.example.yaml');
const target = path.join(cfgDir, 'providers.yaml');
if (!existsSync(target)) copyFileSync(example, target);
const akFile = path.join(BASE, 'pkg', 'secrets', 'apikey.txt');
if (existsSync(akFile)) {
  const key = readFileSync(akFile, 'utf8').trim();
  let y = readFileSync(target, 'utf8');
  y = y.replace('api_key: sk-your-key-here', `api_key: ${key}`);
  writeFileSync(target, y);
  console.log('[mmcas] 已写入预配 API key');
}

// 3. dsh profile patch 生成（dsh 0.2.1 适配版）
//    - 0.2.1 的 agent 平面仍由 agent preset 提供；官方 standard 已加入 time-context /
//      tool-schedule，并移除 backgroundMode / tool-ralph。模板块见
//      pkg/core/standard-preset-021.yml（compaction 参数沿用 v1.2 档 0.7/8192）。
//    - system-prompt 用 personaPrefix/personaSuffix 兜底；ui-agent-preset 关闭（单一人格）。
//    - profile patch 采用合并写入：dsh 0.2.x 把模型/插件等设置存在这里，重跑 setup 不能覆盖。
const roleFile = path.join(BASE, 'pkg', 'core', 'role.md');
const panelPkg = path.join(BASE, 'pkg', 'plugins', 'dsh-panel-mmcas');
const workspace = path.join(BASE, 'workspace');
const coreDir = path.join(BASE, 'pkg', 'core');
const webProfile = path.join(DSH_HOME, 'profiles', 'web');
const desktopProfile = path.join(DSH_HOME, 'profiles', 'desktop');
const panelLink = `link:${panelPkg.replace(/\\/g, '/')}`;
const panelScalars = {
  workspaceDir: workspace.replace(/\\/g, '/'),
  role: ROLE,
  coreDir: coreDir.replace(/\\/g, '/'),
};
const MMCAS_HOME = process.env.MMCAS_HOME || path.join(os.homedir(), 'AppData', 'Local', 'mmcas');
const IS_MMCAS_HOME = path.resolve(DSH_HOME).toLowerCase().startsWith(path.resolve(MMCAS_HOME).toLowerCase());
const repairedLinks = repairBrokenLinks(path.join(DSH_HOME, 'profiles'));
if (repairedLinks.length) console.log(`[mmcas] 已清理 ${repairedLinks.length} 个失效的 profile 包链接`);

const PERSONA_SUFFIX = 'Your working directory is {{cwd}}.';
function systemPromptBlock(roleText) {
  return [
    '- id: system-prompt',
    '  config:',
    '    personaPrefix: |',
    ...indentLines(roleText, 6).split('\n'),
    `    personaSuffix: '${PERSONA_SUFFIX}'`,
  ].join('\n');
}
function mergeSystemPrompt(patch, roleText) {
  if (!getEntry(patch, 'system-prompt')) return upsertEntry(patch, 'system-prompt', systemPromptBlock(roleText));
  let out = setEntryConfigBlock(patch, 'system-prompt', 'personaPrefix', [
    '    personaPrefix: |',
    ...indentLines(roleText, 6).split('\n'),
  ]);
  out = setEntryConfigScalars(out, 'system-prompt', { personaSuffix: PERSONA_SUFFIX });
  return out;
}
function presetBlock(roleText, presetTpl) {
  const plugins = presetTpl.trimEnd().split('__ROLE_LINES__').join(indentLines(roleText, 12));
  return [
    '- id: preset-standard',
    "  name: '@deepseek-ai/dsh-agent-preset'",
    '  config:',
    '    id: standard',
    '    order: 1',
    '    plugins:',
    plugins,
  ].join('\n');
}
function panelBlock(workspaceDir, role, port) {
  const lines = [
    '- id: mmcas-panel',
    '  config:',
    `    workspaceDir: ${yamlScalar(workspaceDir.replace(/\\/g, '/'))}`,
    `    role: ${yamlScalar(role)}`,
    `    coreDir: ${yamlScalar(coreDir.replace(/\\/g, '/'))}`,
  ];
  if (port) lines.push(`    port: ${Number(port)}`);
  return lines.join('\n');
}
function mergeMcasEntries(profileDir, blocks, roleText, options = {}) {
  ensureProfileScaffold(profileDir, options);
  let patch = readText(path.join(profileDir, 'cordis.patch.yml'), '# MMCAS profile patch\n[]\n');
  patch = mergeSystemPrompt(patch, roleText);
  patch = upsertEntry(patch, 'ui-agent-preset', '- id: ui-agent-preset\n  disabled: true');
  patch = upsertEntry(patch, 'preset-standard', blocks.preset);
  if (!getEntry(patch, 'mmcas-panel')) patch = upsertEntry(patch, 'mmcas-panel', blocks.panel);
  else patch = setEntryConfigScalars(patch, 'mmcas-panel', blocks.panelScalars);
  writeText(path.join(profileDir, 'cordis.patch.yml'), patch);
  return patch;
}
function desktopRunning() {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/NH'], { encoding: 'utf8', windowsHide: true });
      return r.status === 0 && /DeepSeek Harness\.exe/i.test(r.stdout || '');
    }
    const r = spawnSync('pgrep', ['-f', 'DeepSeek Harness'], { encoding: 'utf8', windowsHide: true });
    return r.status === 0 && String(r.stdout || '').trim() !== '';
  } catch { return false; }
}
function provisionDesktop(webPatch, roleText) {
  if (!existsSync(panelPkg)) return;
  if (!IS_MMCAS_HOME && !process.argv.includes('--with-desktop')) {
    console.log('[mmcas] 非 MMCAS DSH_HOME，跳过桌面 profile（需要时加 --with-desktop）');
    return;
  }
  if (desktopRunning()) {
    console.warn('[mmcas] 桌面端正在运行，跳过桌面 profile 更新（完全退出桌面后重跑 write-config）');
    return;
  }
  ensureProfileScaffold(desktopProfile, { name: 'dsh-profile-desktop', bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] });
  mergeProfileManifest(desktopProfile, {
    name: 'dsh-profile-desktop',
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@mmcas/dsh-panel'],
    dependencies: { '@mmcas/dsh-panel': panelLink },
  });
  try { ensureProfileLink(desktopProfile, '@mmcas/dsh-panel', panelPkg); }
  catch (e) { console.warn('[mmcas] 桌面面板链接失败:', String(e)); }
  let patch = readText(path.join(desktopProfile, 'cordis.patch.yml'), '# MMCAS desktop profile patch\n[]\n');
  // 只合并 MMCAS 自有的 system-prompt/preset/panel；已有 dsh 设置保持不动。
  patch = mergeSystemPrompt(patch, roleText);
  patch = upsertEntry(patch, 'ui-agent-preset', '- id: ui-agent-preset\n  disabled: true');
  const preset = getEntry(webPatch, 'preset-standard');
  if (preset) patch = upsertEntry(patch, 'preset-standard', preset);
  if (!getEntry(patch, 'mmcas-panel')) patch = upsertEntry(patch, 'mmcas-panel', panelBlock(workspace, ROLE, 19398));
  patch = setEntryConfigScalars(patch, 'mmcas-panel', { ...panelScalars, port: 19398 });
  // 首次装配桌面 profile 时补齐 provider/model；已有值不覆盖。
  for (const id of ['llm-deepseek', 'agent-default-model', 'llm-pi-ai']) {
    if (getEntry(patch, id)) continue;
    const block = getEntry(webPatch, id);
    if (block) patch = upsertEntry(patch, id, block);
  }
  writeText(path.join(desktopProfile, 'cordis.patch.yml'), patch);
  console.log('[mmcas] 桌面 profile 已更新（mmcas-panel.port=19398；用 start-desktop.bat 启动）');
}

if (existsSync(roleFile) && existsSync(panelPkg)) {
  const roleText = readFileSync(roleFile, 'utf8').trim()
    .split('{WORKSPACE}').join(workspace.replace(/\\/g, '/'))
    .split('{CORE}').join(coreDir.replace(/\\/g, '/'));
  const presetTpl = readText(path.join(coreDir, 'standard-preset-021.yml'));
  if (!presetTpl) throw new Error('缺少 pkg/core/standard-preset-021.yml');
  const blocks = {
    systemPrompt: systemPromptBlock(roleText),
    preset: presetBlock(roleText, presetTpl),
    panel: panelBlock(workspace, ROLE),
  };
  ensureProfileScaffold(webProfile, { name: 'dsh-profile-web', bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] });
  mergeProfileManifest(webProfile, {
    name: 'dsh-profile-web',
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@mmcas/dsh-panel'],
    dependencies: { '@mmcas/dsh-panel': panelLink },
    patchReload: 'startup',
  });
  const webPatch = mergeMcasEntries(webProfile, blocks, roleText, { name: 'dsh-profile-web' });
  console.log('[mmcas] dsh web 配置已合并（0.2.1 preset 适配版）');
  provisionDesktop(webPatch, roleText);
}

// 5. 注册 dsh workspace（依托 dsh 原生 workspace 模块，指向共享工作区仓）
if (existsSync(workspace)) {
  try {
    const reg = spawnSync(process.execPath, [
      path.join(coreDir, 'register-workspace.mjs'),
      '--dsh-home', DSH_HOME, '--path', workspace, '--title', 'MMCAS',
    ], { stdio: 'pipe', encoding: 'utf8' });
    if (reg.status === 0) console.log('[mmcas] dsh workspace「MMCAS」已注册（会话 cwd 即共享工作区）');
    else console.error('[mmcas] workspace 注册失败:', String(reg.stderr || reg.stdout || reg.error || '').trim());
  } catch (e) { console.error('[mmcas] workspace 注册失败:', String(e)); }
}

console.log('[mmcas] 配置生成完毕:', cfgDir);

// 6. 角色 skills 拷贝到 <DSH_HOME>/skills/（dsh-skill-filesystem rank 400 扫描根）
//    源: pkg/core/skills/<skill-name>/ 目录（pack 打包时已含 SKILL.md + references）
const skillsSrc = path.join(BASE, 'pkg', 'core', 'skills');
if (existsSync(skillsSrc)) {
  const skillsDst = path.join(DSH_HOME, 'skills');
  mkdirSync(skillsDst, { recursive: true });
  for (const entry of readdirSync(skillsSrc)) {
    const s = path.join(skillsSrc, entry);
    if (statSync(s).isDirectory()) {
      rmSync(path.join(skillsDst, entry), { recursive: true, force: true });
      cpSync(s, path.join(skillsDst, entry), { recursive: true });
    }
  }
  console.log('[mmcas] 角色 skills 已拷入 <DSH_HOME>/skills/');
}

// 7. Master 端:共享 skills 写入工作区仓 .dsh/skills/（git 同步三端,rank 100 项目根）
//    源: pkg/core/common-skills/（仅 modeler 包携带）
if (ROLE === 'modeler' && existsSync(path.join(BASE, 'pkg', 'core', 'common-skills'))) {
  const wsRoot = path.join(BASE, 'workspace');
  if (existsSync(path.join(wsRoot, '.git'))) {
    const sharedDst = path.join(wsRoot, '.dsh', 'skills');
    mkdirSync(sharedDst, { recursive: true });
    for (const entry of readdirSync(path.join(BASE, 'pkg', 'core', 'common-skills'))) {
      const s = path.join(BASE, 'pkg', 'core', 'common-skills', entry);
      if (statSync(s).isDirectory()) {
        rmSync(path.join(sharedDst, entry), { recursive: true, force: true });
        cpSync(s, path.join(sharedDst, entry), { recursive: true });
      }
    }
    console.log('[mmcas] 共享 skills 已写入 workspace/.dsh/skills/（记得 commit+push）');
  } else {
    console.warn('[mmcas] workspace 无 .git，跳过共享 skills 写入');
  }
}
