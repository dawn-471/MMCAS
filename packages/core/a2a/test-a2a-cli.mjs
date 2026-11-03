#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createA2AServer } from './a2a-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'a2a.mjs');
const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-a2a-cli-'));
let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : ''));
  } else {
    fail++;
    console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : ''));
  }
}

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => {
      let json = null;
      try { json = JSON.parse(out.trim()); } catch {}
      resolve({ code, out: out.trim(), err: err.trim(), json });
    });
  });
}

const modelerMessages = [];
const modeler = createA2AServer({
  role: 'modeler',
  token: 'cli-token',
  bind: '127.0.0.1',
  port: 0,
  peerRoles: { coder: { ip: '127.0.0.1' } },
  onMessage: async (msg) => { modelerMessages.push(msg); return true; },
});
const coder = createA2AServer({
  role: 'coder',
  token: 'cli-token',
  bind: '127.0.0.1',
  port: 0,
  peerRoles: { modeler: { ip: '127.0.0.1' } },
  onMessage: async () => true,
});
const modelerAddr = await modeler.start();
const coderAddr = await coder.start();
const tokenFile = path.join(ROOT, 'a2a-token.txt');
writeFileSync(tokenFile, 'cli-token\n', 'utf8');
const workspace = path.join(ROOT, 'ws');
mkdirSync(workspace, { recursive: true });

const config = path.join(ROOT, 'a2a.json');
writeFileSync(config, JSON.stringify({
  role: 'coder',
  port: coderAddr.port,
  tokenFile,
  bind: '127.0.0.1',
  timeoutMs: 2000,
  retries: 0,
  peers: { modeler: { ip: '127.0.0.1', port: modelerAddr.port, online: true } },
}, null, 2), 'utf8');

console.log('\n[AC1] CLI ping / send / status');
{
  const ping = await run(['ping', 'modeler', '--config', config, '--json']);
  check('AC1 ping 成功', ping.code === 0 && ping.json && ping.json.ok === true, ping.err || JSON.stringify(ping.json).slice(0, 80));
  const send = await run(['send', 'modeler', '--body', 'CLI 直连测试', '--kind', 'query', '--config', config, '--json']);
  check('AC1 send 成功且走 A2A', send.code === 0 && send.json && send.json.mode === 'a2a', send.err || JSON.stringify(send.json));
  check('AC1 服务端收到', modelerMessages.length === 1 && modelerMessages[0].body === 'CLI 直连测试', modelerMessages[0] && modelerMessages[0].id);
  const status = await run(['status', '--config', config, '--json']);
  check('AC1 status 可读', status.code === 0 && status.json && status.json.ok === true && status.json.localStatus, status.err || JSON.stringify(status.json).slice(0, 100));
  const peers = await run(['peers', '--config', config, '--json']);
  check('AC1 peers 可读', peers.code === 0 && peers.json && peers.json.peers.modeler.ip === '127.0.0.1', peers.err || JSON.stringify(peers.json).slice(0, 100));
}

console.log('\n[AC2] CLI 回落 notices');
{
  const fallbackConfig = path.join(ROOT, 'a2a-offline.json');
  writeFileSync(fallbackConfig, JSON.stringify({
    role: 'coder',
    port: coderAddr.port,
    tokenFile,
    bind: '127.0.0.1',
    timeoutMs: 500,
    retries: 0,
    peers: { modeler: { ip: '127.0.0.1', port: 1, online: true } },
  }), 'utf8');
  const sent = await run(['send', 'modeler', '--body', 'CLI 回落测试', '--kind', 'stop', '--urgent', '--scope', 'T-301', '--workspace', workspace, '--config', fallbackConfig, '--json']);
  check('AC2 离线回落 notices', sent.code === 0 && sent.json && sent.json.mode === 'notice' && /^N-/.test(sent.json.id), sent.err || JSON.stringify(sent.json));
  const file = path.join(workspace, 'notices', sent.json.id + '.md');
  const text = readFileSync(file, 'utf8');
  check('AC2 回落内容完整', /kind: stop/.test(text) && /urgency: urgent/.test(text) && /scope: T-301/.test(text) && /A2A/.test(text));
}

await modeler.stop();
await coder.stop();
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) process.exit(1);
