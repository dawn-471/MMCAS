#!/usr/bin/env node
/**
 * MMCAS 打包脚本（仅维护者/构建机运行）
 * 用法: node scripts/pack.mjs --role <coder|writer|modeler>
 * 前置: bash scripts/download-vendor.sh（vendor/ 缓存就绪）
 * 凭证来源（仓外，本机 %LOCALAPPDATA%\mmcas\）:
 *   - tailscale-authkeys.json（auth key）
 *   - deploy-keys/mmcas-<role>（git deploy key 私钥）
 *   - apikeys/<role>.txt（可选预配 API key）
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const i = process.argv.indexOf('--role');
const ROLE = i >= 0 ? process.argv[i + 1] : null;
if (!['coder', 'writer', 'modeler'].includes(ROLE)) {
  console.error('用法: node scripts/pack.mjs --role coder|writer|modeler');
  process.exit(2);
}

const ROOT = process.cwd();
const LOCAL = path.join(os.homedir(), 'AppData', 'Local', 'mmcas');
const BUILD = path.join(ROOT, 'build', `MMCAS-${ROLE}`);
const PKG = path.join(BUILD, 'pkg');

// 1. 清空重建目录
rmSync(BUILD, { recursive: true, force: true });
mkdirSync(path.join(PKG, 'secrets'), { recursive: true });
mkdirSync(path.join(BUILD, 'config'), { recursive: true });

// 2. vendor 检查
for (const f of ['node.zip', 'portablegit.exe', 'tailscale.msi', 'uv.zip', 'openssh.zip']) {
  if (!existsSync(path.join(ROOT, 'vendor', f))) {
    console.error(`缺少 vendor/${f}，先运行 bash scripts/download-vendor.sh`);
    process.exit(2);
  }
}

// 3. 拷贝离线组件与核心脚本
for (const f of ['node.zip', 'portablegit.exe', 'tailscale.msi', 'uv.zip', 'openssh.zip']) {
  cpSync(path.join(ROOT, 'vendor', f), path.join(PKG, f));
}

// 3b. 工作区仓地址（仓外配置，绝不硬编码在 setup.bat；满足 §11 配置外置）
const repoCfg = path.join(LOCAL, 'workspace-repo.txt');
if (!existsSync(repoCfg)) {
  console.error(`缺少 ${repoCfg}（内容 = 工作区仓 git 地址，如 git@github.com:<owner>/<repo>.git）`);
  process.exit(2);
}
writeFileSync(path.join(BUILD, 'config', 'workspace-repo.txt'), readFileSync(repoCfg, 'utf8').trim() + '\n');
mkdirSync(path.join(PKG, 'core', 'sync'), { recursive: true });
mkdirSync(path.join(PKG, 'core', 'panel'), { recursive: true });
mkdirSync(path.join(PKG, 'core', 'taskcard'), { recursive: true });
mkdirSync(path.join(PKG, 'core', 'memory'), { recursive: true });
mkdirSync(path.join(PKG, 'core', 'ssh'), { recursive: true });
mkdirSync(path.join(PKG, 'core', 'codex-bridge'), { recursive: true });
cpSync(path.join(ROOT, 'packages', 'core', 'sync', 'sync-daemon.mjs'), path.join(PKG, 'core', 'sync', 'sync-daemon.mjs'));
cpSync(path.join(ROOT, 'packages', 'core', 'write-config.mjs'), path.join(PKG, 'core', 'write-config.mjs'));
cpSync(path.join(ROOT, 'packages', 'core', 'register-workspace.mjs'), path.join(PKG, 'core', 'register-workspace.mjs'));
cpSync(path.join(ROOT, 'packages', 'core', 'switch-provider.mjs'), path.join(PKG, 'core', 'switch-provider.mjs'));
cpSync(path.join(ROOT, 'packages', 'core', 'panel', 'panel.mjs'), path.join(PKG, 'core', 'panel', 'panel.mjs'));
cpSync(path.join(ROOT, 'packages', 'core', 'taskcard', 'taskcard.mjs'), path.join(PKG, 'core', 'taskcard', 'taskcard.mjs'));
cpSync(path.join(ROOT, 'packages', 'core', 'memory', 'memory-log.mjs'), path.join(PKG, 'core', 'memory', 'memory-log.mjs'));
cpSync(path.join(ROOT, 'packages', 'core', 'memory', 'memory-search.mjs'), path.join(PKG, 'core', 'memory', 'memory-search.mjs'));
cpSync(path.join(ROOT, 'packages', 'core', 'setup', 'start-sync.bat'), path.join(PKG, 'core', 'start-sync.bat'));
cpSync(path.join(ROOT, 'packages', 'core', 'setup', 'start-agent.bat'), path.join(PKG, 'core', 'start-agent.bat'));
cpSync(path.join(ROOT, 'packages', 'core', 'setup', 'start-panel.bat'), path.join(PKG, 'core', 'start-panel.bat'));
cpSync(path.join(ROOT, 'packages', 'core', 'setup', 'start-bridge.bat'), path.join(PKG, 'core', 'start-bridge.bat'));
cpSync(path.join(ROOT, 'packages', 'core', 'setup', 'enable-ssh.ps1'), path.join(PKG, 'core', 'enable-ssh.ps1'));
cpSync(path.join(ROOT, 'packages', 'core', 'setup', 'sshd_config.template'), path.join(PKG, 'core', 'sshd_config.template'));
cpSync(path.join(ROOT, 'packages', 'core', 'setup', 'fix-ssh.bat'), path.join(BUILD, 'fix-ssh.bat'));
cpSync(path.join(ROOT, 'packages', 'core', 'codex-bridge', 'codex-bridge.mjs'), path.join(PKG, 'core', 'codex-bridge', 'codex-bridge.mjs'));
cpSync(path.join(ROOT, 'packages', 'core', 'codex-bridge', 'install-bridge.mjs'), path.join(PKG, 'core', 'codex-bridge', 'install-bridge.mjs'));
cpSync(path.join(ROOT, 'packages', 'core', 'config', 'providers.example.yaml'), path.join(BUILD, 'config', 'providers.example.yaml'));
// 角色人格文件（write-config 写入 dsh profile persona）
cpSync(path.join(ROOT, 'packages', ROLE, 'role.md'), path.join(PKG, 'core', 'role.md'));
// 角色 skills（write-config 拷入 <DSH_HOME>/skills/，dsh-skill-filesystem rank 400）
if (existsSync(path.join(ROOT, 'packages', ROLE, 'skills'))) {
  cpSync(path.join(ROOT, 'packages', ROLE, 'skills'), path.join(PKG, 'core', 'skills'), { recursive: true });
}
// 共享 skills（仅 modeler 包；write-config 写入工作区仓 .dsh/skills/，git 同步三端）
if (ROLE === 'modeler' && existsSync(path.join(ROOT, 'packages', 'common', 'skills'))) {
  cpSync(path.join(ROOT, 'packages', 'common', 'skills'), path.join(PKG, 'core', 'common-skills'), { recursive: true });
}
// dsh 内嵌面板插件（整包拷贝，write-config 挂载进 web profile）
cpSync(path.join(ROOT, 'packages', 'dsh-panel-mmcas'), path.join(PKG, 'plugins', 'dsh-panel-mmcas'), { recursive: true });

// 4. setup.bat 注入角色 + 诊断脚本随包（诊断队友环境用；GBK 转换在归一化阶段统一处理）
let setup = readFileSync(path.join(ROOT, 'packages', 'core', 'setup', 'setup.bat'), 'utf8');
setup = `set ROLE=${ROLE}\r\n` + setup;
writeFileSync(path.join(BUILD, 'setup.bat'), setup);
cpSync(path.join(ROOT, 'packages', 'core', 'setup', 'diagnose.bat'), path.join(BUILD, 'MMCAS-diagnose.bat'));

// 5. 凭证注入（本地读取，绝不落开发仓）
if (ROLE !== 'modeler') {
  const keys = JSON.parse(readFileSync(path.join(LOCAL, 'tailscale-authkeys.json'), 'utf8'));
  const k = keys[`mmcas-${ROLE}`];
  if (!k) {
    console.error(`未找到 ${ROLE} 的 auth key（%LOCALAPPDATA%\\mmcas\\tailscale-authkeys.json）`);
    process.exit(2);
  }
  writeFileSync(path.join(PKG, 'secrets', 'authkey.txt'), k.key);
  const sk = path.join(LOCAL, 'deploy-keys', `mmcas-${ROLE}`);
  if (!existsSync(sk)) {
    console.error(`缺少 deploy key: ${sk}`);
    process.exit(2);
  }
  cpSync(sk, path.join(PKG, 'secrets', 'id_ed25519'));
  const ak = path.join(LOCAL, 'apikeys', `${ROLE}.txt`);
  if (existsSync(ak)) cpSync(ak, path.join(PKG, 'secrets', 'apikey.txt'));
  // PackyAPI Codex 通道（可选）：packy.txt 为共享临时 key，所有角色同一把
  const pk = path.join(LOCAL, 'apikeys', 'packy.txt');
  if (existsSync(pk)) cpSync(pk, path.join(PKG, 'secrets', 'packy-key.txt'));
  else console.warn('提示: 未找到 PackyAPI key（%LOCALAPPDATA%\\mmcas\\apikeys\\packy.txt），包内不含 PackyAPI 通道');
  // 可选代理（队友网络需代理才能访问 PackyAPI 时提供）
  const px = path.join(LOCAL, 'proxy.txt');
  if (existsSync(px)) cpSync(px, path.join(BUILD, 'config', 'proxy.txt'));
  // Master SSH 公钥（供 Slave 接受控制；公钥无敏感）
  const masterPub = path.join(LOCAL, 'master-key', 'mmcas-master.pub');
  if (existsSync(masterPub)) {
    cpSync(masterPub, path.join(PKG, 'secrets', 'master.pub'));
  } else {
    console.warn('警告: 缺少 Master SSH 公钥（%LOCALAPPDATA%\\mmcas\\master-key\\mmcas-master.pub），Slave 将无法被 SSH 控制');
  }
}

// 6. 行尾与编码归一化（cmds 历史教训 2026-09-09：cmd 解析 UTF-8 中文 bat 会行缓冲错位 → 队友安装闪退）
//    *.bat/*.cmd: CRLF + GBK(936)（cmd 原生代码页，中文输出可靠）
//    *.ps1: CRLF + GBK(936)（Windows PowerShell 5.1 无 BOM 时按 ANSI 读，GBK 与中文系统默认代码页一致）
const CRLF_EXT = ['.bat', '.cmd', '.ps1'];
const GBK_EXT = ['.bat', '.cmd', '.ps1'];
function normalizeText(dir) {
  let n = 0, gbk = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { const r = normalizeText(p); n += r.n; gbk += r.gbk; continue; }
    const ext = path.extname(entry.name).toLowerCase();
    if (!CRLF_EXT.includes(ext)) continue;
    const raw = readFileSync(p);
    const str = raw.toString('utf8').replace(/\r?\n/g, '\r\n');
    if (str !== raw.toString('utf8')) { writeFileSync(p, str, 'utf8'); n++; }
    if (GBK_EXT.includes(ext)) {
      const ps = `$p='${p.replace(/'/g, "''")}'; [IO.File]::WriteAllText($p, [IO.File]::ReadAllText($p,[Text.Encoding]::UTF8), [Text.Encoding]::GetEncoding(936))`;
      const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
      if (r.status !== 0) { console.error('GBK 转码失败:', p, r.stderr); process.exit(1); }
      gbk++;
    }
  }
  return { n, gbk };
}
const norm = normalizeText(BUILD);
console.log(`归一化: ${norm.n} 个文件行尾, ${norm.gbk} 个 bat/cmd 转 GBK`);

// 7. 打 zip（PowerShell Compress-Archive）
const zip = path.join(ROOT, 'build', `MMCAS-${ROLE}.zip`);
rmSync(zip, { force: true });
const r = spawnSync('powershell', ['-NoProfile', '-Command',
  `Compress-Archive -Force -Path '${BUILD}\\*' -DestinationPath '${zip}'`], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error('打包失败:', r.stderr);
  process.exit(1);
}
console.log('打包完成:', zip);
