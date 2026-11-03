#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { loadA2ACore, resolveCoreA2APath } from '../lib/a2a-core.mjs';

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

console.log('\n[PA1] 面板 A2A 适配层：模块解析');
{
  for (const name of ['server', 'client', 'discovery', 'protocol']) {
    const file = resolveCoreA2APath(name);
    check('PA1 解析 ' + name, !!file && existsSync(file), file || 'missing');
  }
  const mods = await loadA2ACore();
  check('PA1 加载四个模块', !!(mods.server && mods.client && mods.discovery && mods.protocol));
  check('PA1 协议常量可用', Array.isArray(mods.protocol.ROLES) && mods.protocol.ROLES.includes('modeler'));
}

console.log('\n[PA2] 面板 A2A 适配层：本机往返');
{
  const mods = await loadA2ACore();
  const received = [];
  const server = mods.server.createA2AServer({
    role: 'modeler',
    token: 'panel-token',
    bind: '127.0.0.1',
    port: 0,
    peerRoles: { coder: { ip: '127.0.0.1' } },
    onMessage: async (msg) => { received.push(msg); return true; },
  });
  const addr = await server.start();
  const ctx = {
    from: 'coder',
    token: 'panel-token',
    port: addr.port,
    peers: { modeler: { ip: '127.0.0.1', online: true } },
    timeoutMs: 2000,
    retries: 0,
  };
  const ping = await mods.client.pingPeer('modeler', ctx);
  check('PA2 ping 成功', ping.ok && ping.response.role === 'modeler', JSON.stringify(ping.response));
  const sent = await mods.client.sendMessage({ to: 'modeler', kind: 'query', body: '面板 A2A 往返' }, ctx);
  check('PA2 消息往返', sent.ok && received.length === 1 && received[0].body === '面板 A2A 往返', sent.error || sent.id);
  const formatted = mods.protocol.formatMessage(received[0]);
  check('PA2 格式化可注入', formatted.includes(received[0].id) && formatted.includes('面板 A2A 往返'));
  const status = server.status();
  check('PA2 服务状态计数', status.running && status.received >= 2 && status.accepted === 1, JSON.stringify(status).slice(0, 120));
  await server.stop();
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) process.exit(1);
