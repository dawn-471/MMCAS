#!/usr/bin/env node
/**
 * MMCAS sshctl v1 —— Master 侧控制工具（仅维护者本机运行）
 *
 * 用法:
 *   node sshctl.mjs status                     # 显示 mmcas 设备在线状态（自动刷新 IP）
 *   node sshctl.mjs discover --workspace <dir> # 从工作区仓 docs/device-info-*.md 自动填充设备用户名
 *   node sshctl.mjs shell <coder|writer> <cmd> # 对 Slave 执行命令
 *   node sshctl.mjs copy  <coder|writer> <本地文件> <远端路径>   # scp 上传
 *   node sshctl.mjs pull  <coder|writer> <远端路径> <本地文件>   # scp 下载
 *
 * 设备信息（用户名/IP）来自 %LOCALAPPDATA%\mmcas\devices.json；用户名由 discover 自动填充，
 * status 命令自动刷新 IP。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const LOCAL = path.join(os.homedir(), 'AppData', 'Local', 'mmcas');
const DEVICES = path.join(LOCAL, 'devices.json');
const MASTER_KEY = path.join(LOCAL, 'master-key', 'mmcas-master');

function loadDevices() {
  if (!existsSync(DEVICES)) return {};
  return JSON.parse(readFileSync(DEVICES, 'utf8'));
}
function saveDevices(d) {
  mkdirSync(LOCAL, { recursive: true });
  writeFileSync(DEVICES, JSON.stringify(d, null, 2));
}

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
}

// tailscale status 解析：hostname -> ip
function tsStatus() {
  const r = run('C:/Program Files/Tailscale/tailscale.exe', ['status', '--json']);
  if (r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    const out = {};
    for (const [_, peer] of Object.entries(j.Peer || {})) {
      const name = peer.HostName.toLowerCase();
      if (name.startsWith('mmcas-')) {
        out[name.replace('mmcas-', '')] = { host: peer.TailscaleIPs[0], online: peer.Online };
      }
    }
    return out;
  } catch {
    return null;
  }
}

const cmd = process.argv[2];

if (cmd === 'status') {
  const ts = tsStatus();
  const devs = loadDevices();
  console.log('MMCAS 设备状态:');
  let refreshed = false;
  for (const role of ['coder', 'writer']) {
    const t = ts ? ts[role] : null;
    const d = devs[role] || {};
    if (t && t.host) {
      if (d.host !== t.host) { d.host = t.host; refreshed = true; }
      d.online = t.online;
    }
    devs[role] = d;
    const ip = d.host || '未上线过';
    const on = d.online ? '在线' : '离线';
    console.log(`  ${role.padEnd(7)} ${ip.padEnd(16)} ${on}${d.user ? `  user=${d.user}` : ''}`);
  }
  if (refreshed) saveDevices(devs);
  process.exit(0);
}

if (cmd === 'discover') {
  // 从工作区仓 docs/device-info-*.md（各队友端 setup 自动生成，git 同步）自动填充 devices.json
  const i = process.argv.indexOf('--workspace');
  const wsDir = i >= 0 ? process.argv[i + 1] : null;
  if (!wsDir) {
    console.error('用法: sshctl discover --workspace <工作区仓本地路径>');
    process.exit(2);
  }
  const docsDir = path.join(wsDir, 'docs');
  if (!existsSync(docsDir)) {
    console.error(`未找到 ${docsDir}（先确认工作区仓已克隆）`);
    process.exit(2);
  }
  const files = readdirSync(docsDir).filter((f) => /^device-info-.*\.md$/.test(f));
  if (!files.length) {
    console.error('未找到 device-info-*.md（队友端 setup 完成后生成并随 git 同步，先让队友安装）');
    process.exit(2);
  }
  const devs = loadDevices();
  let n = 0;
  for (const f of files) {
    // device-info 由队友 setup（GBK 控制台）生成——按 GBK/UTF-8 自适应解码（中文键匹配）
    const buf = readFileSync(path.join(docsDir, f));
    const utf8 = buf.toString('utf8');
    let text;
    if (/\u89d2\u8272|\u7528\u6237\u540d|\u4e3b\u673a\u540d/.test(utf8)) text = utf8;
    else { try { text = new TextDecoder('gbk').decode(buf); } catch (e) { text = utf8; } }
    const role = (text.match(/-\s*(?:\u89d2\u8272|Role)[:：]\s*(\w+)/) || [])[1];
    const user = (text.match(/-\s*(?:Windows\s*\u7528\u6237\u540d|User)[:：]\s*(\S+)/) || [])[1];
    const hostname = (text.match(/-\s*(?:\u4e3b\u673a\u540d|Host)[:：]\s*(\S+)/) || [])[1];
    if (!role || !user || !['coder', 'writer'].includes(role)) {
      console.warn(`跳过 ${f}（解析失败或缺角色/用户名）`);
      continue;
    }
    devs[role] = { ...(devs[role] || {}), user, hostname };
    console.log(`OK ${role}: user=${user}${hostname ? `, hostname=${hostname}` : ''}`);
    n++;
  }
  if (n) saveDevices(devs);
  console.log(`已记录 ${n} 台设备（跑 status 刷新 IP 后即可 shell/copy/pull）`);
  process.exit(n ? 0 : 1);
}

if (cmd === 'shell' || cmd === 'copy' || cmd === 'pull') {
  const role = process.argv[3];
  if (!['coder', 'writer'].includes(role)) {
    console.error('用法: sshctl shell|copy|pull <coder|writer> ...');
    process.exit(2);
  }
  const devs = loadDevices();
  const d = devs[role];
  if (!d || !d.host) {
    console.error(`设备 ${role} 未记录（先跑 sshctl status 刷新）`);
    process.exit(2);
  }
  if (!d.user) {
    console.error(`设备 ${role} 缺少用户名。请在 ${DEVICES} 中填写 user 字段（Slave 的 Windows 用户名，安装完成后从其 workspace/docs/device-info.md 同步）`);
    process.exit(2);
  }
  if (!existsSync(MASTER_KEY)) {
    console.error(`缺少 Master 私钥: ${MASTER_KEY}`);
    process.exit(2);
  }
  const base = ['ssh', '-i', MASTER_KEY, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10'];
  if (cmd === 'shell') {
    const remote = `${d.user}@${d.host}`;
    const r = run('ssh', [...base.slice(1), remote, process.argv.slice(4).join(' ')]);
    console.log(r.stdout || r.stderr);
    process.exit(r.status ?? 1);
  }
  if (cmd === 'copy' || cmd === 'pull') {
    const [a, b] = process.argv.slice(4);
    if (!a || !b) { console.error('用法: sshctl copy|pull <role> <本地> <远端>'); process.exit(2); }
    const remote = `${d.user}@${d.host}`;
    const args = [...base.slice(1), cmd === 'copy' ? a : `${remote}:${a}`, cmd === 'copy' ? `${remote}:${b}` : b];
    const r = run('scp', args);
    console.log(r.stdout || r.stderr);
    process.exit(r.status ?? 1);
  }
}

console.error('用法: node sshctl.mjs status | shell <role> <cmd> | copy <role> <本地> <远端> | pull <role> <远端> <本地>');
process.exit(2);
