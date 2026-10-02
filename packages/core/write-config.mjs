#!/usr/bin/env node
/**
 * MMCAS 队友机配置生成器（setup 阶段运行）
 * 用法: node write-config.mjs --role <coder|writer|modeler> --base <包根目录>
 * 生成: config/sync.config.json、config/providers.yaml（预配 key 则填入）
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync, copyFileSync, cpSync, rmSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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

// 3. dsh web profile patch 生成（dsh 0.2.0 适配版）
//    - 0.2.0 起 agent 平面（工具/人格/压缩/委派）由 agent preset 提供，web 会话默认挂
//      standard 预设。本段用同 id 覆盖 preset-standard：persona 前缀 = Role 文档，其余
//      插件列表与官方一致（基线 = dsh 0.2.0-rc.2 的 presets/standard.patch.yml，
//      模板块见 pkg/core/standard-preset-020.yml；compaction 参数沿用 v1.2 档 0.7/8192）。
//    - system-prompt 用 0.1.5+ 字段 personaPrefix/personaSuffix（Role 留一份，供无 preset 面兜底）。
//    - 旧的逐条 host 层启用行（subagent/skill/工具/压缩）与 tool-str-replace-editor 行已删除：
//      前者 0.2.0 起由 preset 接管，后者 0.2.0 起并入 tool-fs（read/write/edit 套件）。
const roleFile = path.join(BASE, 'pkg', 'core', 'role.md');
if (existsSync(roleFile)) {
  const roleText = readFileSync(roleFile, 'utf8').trim()
    .split('{WORKSPACE}').join(path.join(BASE, 'workspace').replace(/\\/g, '/'))
    .split('{CORE}').join(path.join(BASE, 'pkg', 'core').replace(/\\/g, '/'));
  const webProfile = path.join(DSH_HOME, 'profiles', 'web');
  mkdirSync(webProfile, { recursive: true });
  const indent = (text, n) => text.split('\n').map((l) => (l ? ' '.repeat(n) + l : '')).join('\n');
  const presetTpl = readFileSync(path.join(BASE, 'pkg', 'core', 'standard-preset-020.yml'), 'utf8').trimEnd();
  const presetPluginsYaml = presetTpl.split('__ROLE_LINES__').join(indent(roleText, 12));
  const patch = '# MMCAS web profile patch —— dsh 0.2.0 适配版（由 write-config.mjs 生成）\n' +
    '- id: system-prompt\n  config:\n    personaPrefix: |\n' + indent(roleText, 6) + '\n' +
    "    personaSuffix: 'Your working directory is {{cwd}}.'\n" +
    '# MMCAS 单一人格：不提供模式/默认预设切换入口\n' +
    '- id: ui-agent-preset\n  disabled: true\n' +
    '# 覆盖 standard 预设：persona 前缀 = Role 文档（其余与官方一致）\n' +
    "- id: preset-standard\n  name: '@deepseek-ai/dsh-agent-preset'\n  config:\n    id: standard\n    order: 1\n    plugins:\n" +
    presetPluginsYaml + '\n';
  writeFileSync(path.join(webProfile, 'cordis.patch.yml'), patch);
  console.log('[mmcas] dsh web 配置已生成（0.2.0 preset 适配版）');
}

// 5. 注册 dsh workspace（依托 dsh 原生 workspace 模块，指向共享工作区仓）
if (existsSync(path.join(BASE, 'workspace'))) {
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync(process.execPath, [
      path.join(BASE, 'pkg', 'core', 'register-workspace.mjs'),
      '--dsh-home', DSH_HOME, '--path', path.join(BASE, 'workspace'), '--title', 'MMCAS',
    ], { stdio: 'pipe' });
    console.log('[mmcas] dsh workspace「MMCAS」已注册（会话 cwd 即共享工作区）');
  } catch (e) { console.error('[mmcas] workspace 注册失败:', String(e)); }
}
const panelPkg = path.join(BASE, 'pkg', 'plugins', 'dsh-panel-mmcas');
if (existsSync(panelPkg)) {
  const webProfile = path.join(DSH_HOME, 'profiles', 'web');
  mkdirSync(webProfile, { recursive: true });
  const pkgJson = {
    name: 'dsh-profile-web',
    private: true,
    dependencies: { '@mmcas/dsh-panel': `link:${panelPkg.replace(/\\/g, '/')}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@mmcas/dsh-panel'], patchReload: 'startup' } },
  };
  writeFileSync(path.join(webProfile, 'package.json'), JSON.stringify(pkgJson, null, 2));
  // 追加 panel workspaceDir 配置段
  const patchFile = path.join(webProfile, 'cordis.patch.yml');
  const workspace = path.join(BASE, 'workspace').replace(/\\/g, '/');
  writeFileSync(patchFile, readFileSync(patchFile, 'utf8').trimEnd() +
    `\n- id: mmcas-panel\n  config:\n    workspaceDir: ${workspace}\n    role: ${ROLE}\n`);
  console.log('[mmcas] 内嵌面板插件已挂载（workspaceDir=' + workspace + '）');
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
