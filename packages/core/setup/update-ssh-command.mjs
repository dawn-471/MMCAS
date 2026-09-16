#!/usr/bin/env node
/**
 * update-ssh-command.mjs — 幂等刷新工作区仓 repo 级 core.sshCommand
 * （MMCAS setup.bat 第 6 步调用；亦作「包目录迁移」后的一次性自检/修复工具）
 *
 * 背景：repo 级 sshCommand 固化 SSH key 的绝对路径。包目录迁移 / 重装到新路径后，
 * 旧 sshCommand 仍指旧路径 → sync-daemon fetch/push 全部失败（实测事故：历史接收目录旧路径、
 * 双下载 "(1)" 残留路径）。setup 的「工作区已存在」分支必须**刷新**它，不能跳过。
 *
 * 幂等实现：删除文件中所有 sshCommand 行 + 本工具添加过的段头/标记，再追加一个
 * 带标记的新段（`# >>> mmcas-managed` … `# <<< mmcas-managed`）。重复运行结果稳定。
 *
 * 用法:
 *   node update-ssh-command.mjs <workspaceDir> <sshKeyPath>            # 刷新（幂等）
 *   node update-ssh-command.mjs --check <workspaceDir> <sshKeyPath>    # 只检查（迁移自检），一致输出 OK
 *
 * 退出码: 0 = OK（已刷新 / --check 一致）；1 = 失败（缺 .git/config / 写入异常 / --check 不一致）；2 = 参数错误
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const checkOnly = args[0] === '--check';
if (checkOnly) args.shift();
const [wsDir, sshKeyRaw] = args;
if (!wsDir || !sshKeyRaw) {
  console.error('用法: node update-ssh-command.mjs [--check] <workspaceDir> <sshKeyPath>');
  process.exit(2);
}

const cfgPath = path.join(wsDir, '.git', 'config');
if (!existsSync(cfgPath)) {
  console.error(`拒绝: 未找到 ${cfgPath}（工作区尚未克隆）`);
  process.exit(1);
}

// 路径归一为正斜杠（Windows 反斜杠在 ssh -i 参数里会被当转义）
const key = sshKeyRaw.replace(/\\/g, '/');
const value = `ssh -i ${key} -p 443 -o StrictHostKeyChecking=accept-new -o HostKeyAlias=github.com`;
const expectedLine = `sshCommand = ${value}`;

// ---------- --check：存在且唯一且值正确 = 一致 ----------
if (checkOnly) {
  const text = readFileSync(cfgPath, 'utf8');
  const sshLines = text.split(/\r?\n/).filter((l) => /sshCommand\s*=/.test(l));
  const ok = sshLines.length === 1 && sshLines[0].trim() === expectedLine;
  if (ok) {
    console.log('OK sshCommand 一致（指向当前包的 key 路径）');
    process.exit(0);
  }
  console.error('FAIL sshCommand 不一致：');
  console.error(`  期望（唯一一行）: ${expectedLine}`);
  for (const l of sshLines) console.error(`  实际: ${l.trim()}`);
  if (sshLines.length === 0) console.error('  （文件中没有任何 sshCommand）');
  process.exit(1);
}

// ---------- 刷新 ----------
const text = readFileSync(cfgPath, 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.split(/\r?\n/);
const out = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const t = line.trim();
  if (t.includes('mmcas-managed')) continue;               // 上次追加的标记注释行
  if (/^sshCommand\s*=/.test(t)) continue;                 // 任意旧 sshCommand 行
  if (/^\[core\]$/i.test(t)) {
    // 工具添加过的段头：其后（跳过空行）紧跟 sshCommand 行 → 一并删除；
    // 本体 [core] 段（后跟 repositoryformatversion 等）不受影响
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j < lines.length && /^sshCommand\s*=/.test(lines[j].trim())) continue;
  }
  out.push(line);
}
while (out.length && out[out.length - 1].trim() === '') out.pop();
out.push(
  '# >>> mmcas-managed (sshCommand, auto-generated; do not edit)',
  '[core]',
  `\tsshCommand = ${value}`,
  '# <<< mmcas-managed',
  ''
);
const newText = out.join(eol);
if (newText === text) {
  console.log('OK sshCommand 已是最新（无需变更）');
  process.exit(0);
}
writeFileSync(cfgPath, newText);
console.log(`OK sshCommand 已刷新 -> ${value}`);
process.exit(0);
