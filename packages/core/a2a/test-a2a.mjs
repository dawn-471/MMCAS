#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createA2AServer } from './a2a-server.mjs';
import { discoverPeers } from './a2a-discovery.mjs';
import { getPeerStatus, pingPeer, sendMessage, sendWithFallback } from './a2a-client.mjs';
import { formatMessage, makeMessage } from './a2a-protocol.mjs';

const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-a2a-test-'));
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

async function rawPost(port, message, token = 'secret') {
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/a2a/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(message),
    });
    let body = {};
    try { body = await response.json(); } catch {}
    return { status: response.status, body };
  } catch (err) {
    return { status: 0, body: {}, error: err.message };
  }
}

const received = [];
const serverA = createA2AServer({
  role: 'modeler',
  token: 'secret',
  bind: '127.0.0.1',
  port: 0,
  stateFile: path.join(ROOT, 'a2a-state.json'),
  peerRoles: { coder: { ip: '127.0.0.1' } },
  rateLimitPerMin: 120,
  onMessage: async (msg) => { received.push(msg); return true; },
});
const serverB = createA2AServer({
  role: 'coder',
  token: 'secret',
  bind: '127.0.0.1',
  port: 0,
  peerRoles: { modeler: { ip: '127.0.0.1' } },
  onMessage: async () => true,
});
const addrA = await serverA.start();
const addrB = await serverB.start();
const ctxToA = { from: 'coder', token: 'secret', port: addrA.port, peers: { modeler: { ip: '127.0.0.1', online: true } }, timeoutMs: 2000, retries: 0 };
const ctxToB = { from: 'modeler', token: 'secret', port: addrB.port, peers: { coder: { ip: '127.0.0.1', online: true } }, timeoutMs: 2000, retries: 0 };

console.log('\n[A1] 启停 / ping / 鉴权');
{
  check('A1 两个服务已启动', serverA.status().running && serverB.status().running && addrA.port > 0 && addrB.port > 0, addrA.port + ',' + addrB.port);
  const ping = await pingPeer('modeler', ctxToA);
  check('A1 正确 token ping 成功', ping.ok && ping.response && ping.response.role === 'modeler', JSON.stringify(ping.response));
  const bad = await pingPeer('modeler', { ...ctxToA, token: 'wrong' });
  check('A1 错误 token => 401', !bad.ok && bad.status === 401, bad.status);
  const status = await getPeerStatus('modeler', ctxToA);
  check('A1 status 可读且含计数', status.ok && status.response && typeof status.response.received === 'number', JSON.stringify(status.response).slice(0, 100));
}

console.log('\n[A2] 消息投递 / 幂等 / 校验');
{
  const sent = await sendMessage({ to: 'modeler', kind: 'query', body: '模型假设是否成立？', scope: 'T-101' }, ctxToA);
  check('A2 消息发送成功', sent.ok && sent.id, sent.error || sent.id);
  check('A2 服务端收到并解析', received.length === 1 && received[0].from === 'coder' && received[0].scope === 'T-101', received[0] && received[0].body);
  const duplicate = await rawPost(addrA.port, received[0]);
  check('A2 重复 id => duplicate', duplicate.status === 200 && duplicate.body.duplicate === true && received.length === 1, JSON.stringify(duplicate.body));
  const toMismatch = await sendMessage({ to: 'coder', kind: 'info', body: '发错目标' }, { ...ctxToA, peers: { coder: { ip: '127.0.0.1', online: true } } });
  check('A2 to 不匹配 => 403', !toMismatch.ok && toMismatch.status === 403, toMismatch.status);
  const fromMismatch = await sendMessage({ to: 'modeler', kind: 'info', body: '身份不符' }, { ...ctxToA, from: 'writer' });
  check('A2 from 与来源 IP 不匹配 => 403', !fromMismatch.ok && fromMismatch.status === 403, fromMismatch.status);
  const expired = makeMessage({ from: 'coder', to: 'modeler', kind: 'info', body: '过期消息', at: new Date(Date.now() - 7200000).toISOString(), ttl: 60 });
  const expiredRes = await rawPost(addrA.port, expired);
  check('A2 过期消息 => 410', expiredRes.status === 410, expiredRes.status);
  const tooLarge = { ...makeMessage({ from: 'coder', to: 'modeler', kind: 'info', body: 'x' }), body: 'x'.repeat(70000) };
  const largeRes = await rawPost(addrA.port, tooLarge);
  check('A2 超大消息 => 413', largeRes.status === 413, largeRes.status);
}

console.log('\n[A3] 速率限制 / 投递失败');
{
  const limited = createA2AServer({
    role: 'writer',
    token: 'secret',
    bind: '127.0.0.1',
    port: 0,
    rateLimitPerMin: 2,
    onMessage: async () => true,
  });
  const addr = await limited.start();
  const ctx = { from: 'coder', token: 'secret', port: addr.port, peers: { writer: { ip: '127.0.0.1', online: true } }, timeoutMs: 2000, retries: 0 };
  const r1 = await pingPeer('writer', ctx);
  const r2 = await pingPeer('writer', ctx);
  const r3 = await pingPeer('writer', ctx);
  check('A3 速率限制 => 429', r1.ok && r2.ok && !r3.ok && r3.status === 429, r1.status + ',' + r2.status + ',' + r3.status);

  const failing = createA2AServer({
    role: 'writer',
    token: 'secret',
    bind: '127.0.0.1',
    port: 0,
    onMessage: async () => false,
  });
  const faddr = await failing.start();
  const failed = await sendMessage({ to: 'writer', kind: 'info', body: '投递失败' }, { ...ctx, port: faddr.port });
  check('A3 onMessage=false => 503', !failed.ok && failed.status === 503, failed.status);
  await limited.stop();
  await failing.stop();
}

console.log('\n[A4] notices 回落 / 发现 / 持久化幂等');
{
  const fallbackWs = path.join(ROOT, 'ws');
  mkdirSync(fallbackWs, { recursive: true });
  const offline = await sendWithFallback({ to: 'modeler', kind: 'stop', urgency: 'urgent', body: '立即停止' }, {
    ...ctxToA,
    peers: { modeler: { ip: '127.0.0.1', online: false } },
  }, { workspace: fallbackWs });
  check('A4 离线 => notices 回落', offline.ok && offline.mode === 'notice' && /^N-/.test(offline.id), offline.mode + '/' + offline.id);
  const noticeFile = path.join(fallbackWs, 'notices', offline.id + '.md');
  check('A4 回落文件已落盘且为 urgent/stop', existsSync(noticeFile) && /kind: stop/.test(readFileSync(noticeFile, 'utf8')) && /urgency: urgent/.test(readFileSync(noticeFile, 'utf8')));

  const discovered = discoverPeers({ role: 'coder', peers: { modeler: '100.64.0.1' } });
  check('A4 配置 peer 发现', discovered.source === 'config' && discovered.peers.modeler.ip === '100.64.0.1', JSON.stringify(discovered.peers));

  const msg = received[0];
  await serverA.stop();
  const serverA2 = createA2AServer({
    role: 'modeler',
    token: 'secret',
    bind: '127.0.0.1',
    port: 0,
    stateFile: path.join(ROOT, 'a2a-state.json'),
    peerRoles: { coder: { ip: '127.0.0.1' } },
    onMessage: async () => { throw new Error('不应重复投递'); },
  });
  const addrA2 = await serverA2.start();
  const replay = await rawPost(addrA2.port, msg);
  check('A4 重启后重复 id 仍被去重', replay.status === 200 && replay.body.duplicate === true, JSON.stringify(replay.body));
  await serverA2.stop();
}

console.log('\n[A5] 协议格式化');
{
  const msg = makeMessage({ from: 'coder', to: 'modeler', kind: 'task-handoff', urgency: 'urgent', body: '请接手 T-102', scope: 'T-102' });
  const text = formatMessage(msg);
  check('A5 格式化包含 id/from/body', text.includes(msg.id) && text.includes('来自 coder') && text.includes('请接手 T-102') && text.includes('紧急'));
}

await serverB.stop();
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) process.exit(1);
