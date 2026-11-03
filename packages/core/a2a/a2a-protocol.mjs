import { randomBytes } from 'node:crypto';

export const A2A_VERSION = 1;
export const ROLES = ['modeler', 'coder', 'writer'];
export const KINDS = ['ping', 'query', 'reply', 'task-handoff', 'stop', 'error', 'ruling', 'info'];
export const URGENCIES = ['normal', 'urgent'];
export const KIND_LABEL = {
  ping: '连通检查',
  query: '询问',
  reply: '回复',
  'task-handoff': '任务转交',
  stop: '停止指令',
  error: '错误上报',
  ruling: '裁决请求',
  info: '一般',
};

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

export function newMessageId(now = new Date()) {
  return 'A-' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate())
    + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds())
    + '-' + randomBytes(3).toString('hex');
}

export function isRole(value) {
  return ROLES.includes(String(value || ''));
}

export function makeMessage(input = {}) {
  const msg = {
    v: A2A_VERSION,
    id: input.id || newMessageId(),
    from: String(input.from || ''),
    to: String(input.to || ''),
    kind: String(input.kind || 'info'),
    urgency: input.urgency === 'urgent' ? 'urgent' : 'normal',
    scope: String(input.scope || '').trim(),
    body: String(input.body || ''),
    at: input.at || new Date().toISOString(),
    ttl: Number(input.ttl || 3600),
  };
  if (input.replyTo) msg.replyTo = String(input.replyTo);
  const checked = validateMessage(msg, { maxBodyBytes: input.maxBodyBytes, skipExpiry: true });
  if (!checked.ok) throw new Error(checked.error);
  return msg;
}

export function validateMessage(msg, options = {}) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { ok: false, code: 400, error: '消息必须是 JSON 对象' };
  if (msg.v !== A2A_VERSION) return { ok: false, code: 400, error: '不支持的消息版本: ' + msg.v };
  if (!/^A-\d{8}-\d{6}-[a-z0-9]{4,16}$/.test(String(msg.id || ''))) return { ok: false, code: 400, error: '非法消息 id' };
  if (!isRole(msg.from)) return { ok: false, code: 400, error: '非法 from: ' + msg.from };
  if (!isRole(msg.to) && msg.to !== 'all') return { ok: false, code: 400, error: '非法 to: ' + msg.to };
  if (!KINDS.includes(String(msg.kind))) return { ok: false, code: 400, error: '非法 kind: ' + msg.kind };
  if (!URGENCIES.includes(String(msg.urgency))) return { ok: false, code: 400, error: '非法 urgency: ' + msg.urgency };
  if (typeof msg.body !== 'string') return { ok: false, code: 400, error: 'body 必须是字符串' };
  const bodyBytes = Buffer.byteLength(msg.body, 'utf8');
  if (!bodyBytes) return { ok: false, code: 400, error: 'body 不能为空' };
  const maxBodyBytes = Number(options.maxBodyBytes || 65536);
  if (bodyBytes > maxBodyBytes) return { ok: false, code: 413, error: 'body 超过上限（' + bodyBytes + ' > ' + maxBodyBytes + ' 字节）' };
  if (msg.scope !== undefined && typeof msg.scope !== 'string') return { ok: false, code: 400, error: 'scope 必须是字符串' };
  if (msg.scope && String(msg.scope).length > 200) return { ok: false, code: 400, error: 'scope 过长' };
  const at = Date.parse(msg.at);
  if (!Number.isFinite(at)) return { ok: false, code: 400, error: '非法 at 时间' };
  const ttl = Number(msg.ttl);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 86400) return { ok: false, code: 400, error: '非法 ttl（1..86400 秒）' };
  if (msg.replyTo && !/^A-\d{8}-\d{6}-[a-z0-9]{4,16}$/.test(String(msg.replyTo))) {
    return { ok: false, code: 400, error: '非法 replyTo' };
  }
  if (!options.skipExpiry) {
    const now = Number(options.now || Date.now());
    if (at + ttl * 1000 < now - 30000) return { ok: false, code: 410, error: '消息已过期' };
  }
  return { ok: true, code: 200, error: '' };
}

export function isUrgent(msg) {
  return msg && (msg.urgency === 'urgent' || msg.kind === 'stop');
}

export function formatMessage(msg) {
  const label = KIND_LABEL[msg.kind] || msg.kind;
  return '【MMCAS A2A 消息 ' + msg.id + '｜' + label + (isUrgent(msg) ? '｜紧急' : '') + '】来自 ' + msg.from + '：\n'
    + (msg.body || '')
    + (msg.scope ? '\n（相关：' + msg.scope + '）' : '')
    + (msg.replyTo ? '\n（回复：' + msg.replyTo + '）' : '')
    + '\n处理完成后请回复或回执。';
}

export function fallbackNoticeKind(kind) {
  if (kind === 'stop' || kind === 'error' || kind === 'ruling' || kind === 'info') return kind;
  return 'info';
}
