#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverPeers, normalizePeers } from './a2a-discovery.mjs';
import { getPeerStatus, pingPeer, sendWithFallback } from './a2a-client.mjs';
import { KINDS, ROLES } from './a2a-protocol.mjs';

const USAGE = [
  '用法:',
  '  node a2a.mjs send <modeler|coder|writer|all> --body <文本> [选项]',
  '  node a2a.mjs ping <modeler|coder|writer> [选项]',
  '  node a2a.mjs status [--json]',
  '  node a2a.mjs peers [--json]',
  '  node a2a.mjs config [--json]',
  '',
  '选项:',
  '  --kind ruling|error|stop|info|query|reply|task-handoff',
  '  --urgent                 紧急（接收端 steer 打断）',
  '  --scope T-115,T-116      关联任务卡',
  '  --ttl <秒>               消息有效期（默认 3600）',
  '  --workspace <ws>         notices 回落目录（默认 ./workspace）',
  '  --role <role>            本端角色（默认 MMCAS_ROLE 或 modeler）',
  '  --port <n>               A2A 端口（默认 19400）',
  '  --bind <ip>              本端 A2A 绑定/查询地址（默认发现结果）',
  '  --config <file>          a2a.json（默认 <MMCAS_HOME>/a2a.json）',
  '  --token-file <file>      token 文件（默认 <MMCAS_HOME>/a2a-token.txt）',
  '  --tokens-file <file>     每角色 token 映射（默认 <MMCAS_HOME>/a2a-tokens.json）',
  '  --peer <role=ip>         覆盖 peer 地址（可重复）',
  '  --timeout-ms <n>         请求超时（默认 3000）',
  '  --retries <n>            重试次数（默认 1）',
  '  --no-fallback            A2A 失败时不写 notices',
  '  --json                   JSON 输出',
].join('\n');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function argsAll(name) {
  const out = [];
  process.argv.forEach((value, index) => {
    if (value === '--' + name && process.argv[index + 1] !== undefined) out.push(process.argv[index + 1]);
  });
  return out;
}

function flag(name) {
  return process.argv.includes('--' + name);
}

function mmcasHome() {
  return process.env.MMCAS_HOME || (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'mmcas')
    : path.join(os.homedir(), '.mmcas'));
}

function readJson(file) {
  try {
    if (!existsSync(file)) return null;
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function readText(file) {
  try { return existsSync(file) ? readFileSync(file, 'utf8').trim() : ''; } catch { return ''; }
}

function resolveConfig() {
  const home = mmcasHome();
  const configPath = arg('config', path.join(home, 'a2a.json'));
  const file = readJson(configPath) || {};
  const role = String(arg('role', process.env.MMCAS_ROLE || file.role || 'modeler'));
  const port = Number(arg('port', process.env.MMCAS_A2A_PORT || file.port || 19400));
  const tokenFile = path.resolve(arg('token-file', file.tokenFile ? path.resolve(home, file.tokenFile) : path.join(home, 'a2a-token.txt')));
  const tokensFile = path.resolve(arg('tokens-file', file.tokensFile ? path.resolve(home, file.tokensFile) : path.join(home, 'a2a-tokens.json')));
  const rawTokens = readJson(tokensFile) || {};
  const tokens = {};
  for (const [tokenRole, value] of Object.entries(rawTokens)) {
    if (ROLES.includes(tokenRole) && typeof value === 'string' && value.trim()) tokens[tokenRole] = value.trim();
  }
  const token = String(process.env.MMCAS_A2A_TOKEN || tokens[role] || readText(tokenFile) || '');
  const overrides = {};
  for (const item of argsAll('peer')) {
    const eq = item.indexOf('=');
    if (eq > 0) overrides[item.slice(0, eq)] = { ip: item.slice(eq + 1), online: true };
  }
  const configuredPeers = normalizePeers(file.peers || {});
  const peers = Object.keys(overrides).length ? { ...configuredPeers, ...overrides } : configuredPeers;
  const workspace = path.resolve(arg('workspace', process.env.MMCAS_WORKSPACE || path.join(process.cwd(), 'workspace')));
  return {
    home,
    configPath,
    role,
    port,
    token,
    tokenFile,
    tokens,
    tokensFile,
    peers,
    bind: String(arg('bind', file.bind || file.selfIp || '')),
    workspace,
    timeoutMs: Number(arg('timeout-ms', file.timeoutMs || 3000)),
    retries: Number(arg('retries', file.retries === undefined ? 1 : file.retries)),
    configFile: file,
  };
}

function publicConfig(cfg) {
  return {
    home: cfg.home,
    configPath: cfg.configPath,
    role: cfg.role,
    port: cfg.port,
    tokenFile: cfg.tokenFile,
    tokensFile: cfg.tokensFile,
    hasToken: !!cfg.token,
    tokenRoles: Object.keys(cfg.tokens),
    peers: cfg.peers,
    bind: cfg.bind,
    workspace: cfg.workspace,
    timeoutMs: cfg.timeoutMs,
    retries: cfg.retries,
  };
}

function clientContext(cfg, peers) {
  return {
    from: cfg.role,
    token: cfg.token,
    tokens: cfg.tokens,
    port: cfg.port,
    peers: peers || cfg.peers,
    timeoutMs: cfg.timeoutMs,
    retries: cfg.retries,
  };
}

function emit(value, json) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (typeof value === 'string') {
    console.log(value);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const command = process.argv[2];
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    console.log(USAGE);
    return;
  }
  const cfg = resolveConfig();
  const json = flag('json');

  if (command === 'config') {
    emit(publicConfig(cfg), json);
    return;
  }

  let peers = cfg.peers;
  let discovered = null;
  if (!Object.keys(peers).length) {
    discovered = discoverPeers({ role: cfg.role, peers: cfg.configFile.peers, tailscaleBin: cfg.configFile.tailscaleBin });
    peers = discovered.peers;
  }

  if (command === 'peers') {
    const value = {
      source: discovered ? discovered.source : 'config',
      self: discovered ? discovered.self : { role: cfg.role, ip: '' },
      peers,
      error: discovered ? discovered.error : null,
    };
    if (json) emit(value, true);
    else {
      console.log('本端: ' + cfg.role + (value.self.ip ? ' · ' + value.self.ip : '') + '（' + value.source + '）');
      for (const [role, peer] of Object.entries(peers)) {
        console.log('  ' + role.padEnd(8) + (peer.online === false ? 'offline' : 'online ') + '  ' + peer.ip);
      }
      if (value.error) console.log('  ! ' + value.error);
    }
    return;
  }

  if (!cfg.token) {
    console.error('缺少 A2A token（' + cfg.tokenFile + ' 或 MMCAS_A2A_TOKEN）');
    process.exit(2);
  }

  if (command === 'status') {
    const target = arg('to', '');
    let status;
    if (target) {
      status = await getPeerStatus(target, clientContext(cfg, peers));
    } else {
      const selfDiscovery = !cfg.bind ? discoverPeers({ role: cfg.role, tailscaleBin: cfg.configFile.tailscaleBin }) : null;
      const selfIp = cfg.bind
        || (discovered && discovered.self && discovered.self.ip)
        || (selfDiscovery && selfDiscovery.self && selfDiscovery.self.ip)
        || '127.0.0.1';
      status = await getPeerStatus('self', clientContext(cfg, { self: { ip: selfIp, online: true } }));
      if (!status.ok && selfIp !== '127.0.0.1') {
        status = await getPeerStatus('self', clientContext(cfg, { self: { ip: '127.0.0.1', online: true } }));
      }
    }
    const value = {
      ok: status.ok,
      self: { role: cfg.role, port: cfg.port },
      source: discovered ? discovered.source : 'config',
      discoveryError: discovered ? discovered.error : null,
      peers,
      localStatus: status.response || null,
      error: status.error || null,
    };
    if (json) emit(value, true);
    else {
      console.log('A2A 本端: ' + cfg.role + ' · port ' + cfg.port + ' · token ' + (cfg.token ? '已配置' : '缺失'));
      console.log('发现: ' + value.source + (value.discoveryError ? '（' + value.discoveryError + '）' : ''));
      for (const [role, peer] of Object.entries(peers)) {
        console.log('  ' + role.padEnd(8) + (peer.online === false ? 'offline' : 'online ') + '  ' + peer.ip);
      }
      if (value.localStatus) console.log('服务: received=' + value.localStatus.received + ' accepted=' + value.localStatus.accepted + ' failures=' + value.localStatus.failures);
      else if (value.error) console.log('服务: 不可达（' + value.error + '）');
    }
    if (!value.ok) process.exit(3);
    return;
  }

  if (command === 'ping') {
    const to = process.argv[3];
    if (!to || !ROLES.includes(to)) {
      console.error('ping 需要目标角色: modeler|coder|writer');
      process.exit(2);
    }
    if (!peers[to]) {
      console.error('未知 peer: ' + to + '（可用 --peer ' + to + '=<ip> 覆盖）');
      process.exit(3);
    }
    const result = await pingPeer(to, clientContext(cfg, peers));
    emit(result, json);
    if (!result.ok) process.exit(3);
    return;
  }

  if (command === 'send') {
    const to = process.argv[3];
    if (!to || (!ROLES.includes(to) && to !== 'all')) {
      console.error('send 需要目标角色: modeler|coder|writer|all');
      process.exit(2);
    }
    const body = String(arg('body', '')).trim();
    if (!body) {
      console.error('send 需要 --body');
      process.exit(2);
    }
    const kind = String(arg('kind', 'info'));
    if (!KINDS.includes(kind)) {
      console.error('非法 --kind: ' + kind + '（' + KINDS.join('|') + '）');
      process.exit(2);
    }
    const result = await sendWithFallback({
      to,
      kind,
      urgency: flag('urgent') ? 'urgent' : 'normal',
      scope: String(arg('scope', '')),
      body,
      ttl: Number(arg('ttl', 3600)),
    }, clientContext(cfg, peers), {
      workspace: cfg.workspace,
      disabled: flag('no-fallback'),
    });
    emit(result, json);
    if (!result.ok) process.exit(3);
    return;
  }

  console.error('未知命令: ' + command);
  console.error(USAGE);
  process.exit(2);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(2);
  });
}
