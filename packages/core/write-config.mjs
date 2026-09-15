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

// 3. dsh web profile persona 注入（实测：profile 级 patch 覆盖 web-app 默认人格）
const roleFile = path.join(BASE, 'pkg', 'core', 'role.md');
if (existsSync(roleFile)) {
  const roleText = readFileSync(roleFile, 'utf8').trim()
    .split('{WORKSPACE}').join(path.join(BASE, 'workspace').replace(/\\/g, '/'))
    .split('{CORE}').join(path.join(BASE, 'pkg', 'core').replace(/\\/g, '/'));
  const webProfile = path.join(DSH_HOME, 'profiles', 'web');
  mkdirSync(webProfile, { recursive: true });
  const patch = '- id: system-prompt\n  config:\n    persona: |\n' +
    roleText.split('\n').map((l) => '      ' + l).join('\n') + '\n' +
    '# 启用 dsh 原生 subagent（三端一致）\n' +
    '- id: subagent\n  disabled: false\n' +
    '- id: subagent-spawn-in-process\n  disabled: false\n' +
    '- id: subagent-fork-in-process\n  disabled: false\n' +
    '- id: tool-subagent-control\n  disabled: false\n' +
    '- id: tool-subagent-list-agents\n  disabled: false\n' +
    '- id: tool-subagent\n  disabled: false\n' +
    '# 启用 dsh 原生 skills（dsh-web-app 默认禁用；角色 skills 由 setup 拷入 <DSH_HOME>/skills/）\n' +
    '- id: skill-filesystem\n  disabled: false\n' +
    '- id: tool-skill\n  disabled: false\n' +
    '# 启用核心工具（dsh-web-app 默认全部 disabled——不启用则 agent 无命令执行/文件读写能力）\n' +
    '- id: tool-pwsh\n  disabled: false\n' +
    '- id: tool-fs\n  disabled: false\n' +
    '- id: tool-fs-search\n  disabled: false\n' +
    '- id: tool-jobs\n  disabled: false\n' +
    '- id: tool-str-replace-editor\n  disabled: false\n' +
    '# 禁用 dsh 模式切换（agent preset）——MMCAS 只保留单一 persona，杜绝 standard 预设顶掉 Role 文档\n' +
    '- id: agent-presets\n  disabled: true\n' +
    '- id: ui-agent-preset\n  disabled: true\n';
  writeFileSync(path.join(webProfile, 'cordis.patch.yml'), patch);
  console.log('[mmcas] dsh web persona 已注入');
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
