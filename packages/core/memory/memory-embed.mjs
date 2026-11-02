import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EMBED_DEFAULTS = {
  provider: 'hash',
  endpoint: 'https://api.openai.com/v1/embeddings',
  model: 'text-embedding-3-small',
  apiKeyEnv: 'MMCAS_EMBED_KEY',
  dim: 0,
  batchSize: 16,
  timeoutMs: 30000,
  maxChars: 8000,
};

export function mmcasHome() {
  return process.env.MMCAS_HOME || (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'mmcas')
    : path.join(os.homedir(), '.mmcas'));
}

export function memoryEmbedConfigPath() {
  return path.join(mmcasHome(), 'memory-embed.json');
}

export function dshHome() {
  return process.env.DSH_HOME || path.join(mmcasHome(), 'dsh-home');
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

function readCredRef(credPath, envName) {
  if (!envName || !existsSync(credPath)) return null;
  try {
    const text = readFileSync(credPath, 'utf8');
    const escaped = envName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp('(?:^|\\n)\\s*' + escaped + '\\s*:\\s*(\\S+)'));
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function intInRange(value, fallback, min, max) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function resolveEmbedConfig(cli = {}) {
  const filePath = cli.embedConfig || process.env.MMCAS_EMBED_CONFIG || memoryEmbedConfigPath();
  const file = readJson(filePath) || {};
  const env = process.env;
  const provider = String(cli.provider || env.MMCAS_EMBED_PROVIDER || file.provider || EMBED_DEFAULTS.provider).toLowerCase();
  if (!['hash', 'openai'].includes(provider)) throw new Error('非法 embeddings provider: ' + provider);
  const endpoint = String(cli.endpoint || env.MMCAS_EMBED_ENDPOINT || file.endpoint || EMBED_DEFAULTS.endpoint);
  const model = String(cli.model || env.MMCAS_EMBED_MODEL || file.model || EMBED_DEFAULTS.model);
  const apiKeyEnv = cli.apiKeyEnv !== undefined
    ? cli.apiKeyEnv
    : (env.MMCAS_EMBED_API_KEY_ENV !== undefined ? env.MMCAS_EMBED_API_KEY_ENV : (file.apiKeyEnv !== undefined ? file.apiKeyEnv : EMBED_DEFAULTS.apiKeyEnv));
  const dim = intInRange(cli.dim || env.MMCAS_EMBED_DIM || file.dim || EMBED_DEFAULTS.dim, EMBED_DEFAULTS.dim, 0, 8192);
  const batchSize = intInRange(cli.batchSize || env.MMCAS_EMBED_BATCH_SIZE || file.batchSize || EMBED_DEFAULTS.batchSize, EMBED_DEFAULTS.batchSize, 1, 128);
  const timeoutMs = intInRange(cli.timeoutMs || env.MMCAS_EMBED_TIMEOUT_MS || file.timeoutMs || EMBED_DEFAULTS.timeoutMs, EMBED_DEFAULTS.timeoutMs, 1000, 120000);
  const maxChars = intInRange(cli.maxChars || env.MMCAS_EMBED_MAX_CHARS || file.maxChars || EMBED_DEFAULTS.maxChars, EMBED_DEFAULTS.maxChars, 200, 100000);
  const apiKey = apiKeyEnv
    ? (env[apiKeyEnv]
      || readCredRef(path.join(dshHome(), '.credentials.yaml'), apiKeyEnv)
      || readCredRef(path.join(mmcasHome(), '.credentials.yaml'), apiKeyEnv))
    : null;
  const hasCli = ['provider', 'endpoint', 'model', 'apiKeyEnv', 'dim', 'batchSize', 'timeoutMs', 'maxChars', 'embedConfig'].some((key) => cli[key] !== undefined);
  const hasEnv = ['MMCAS_EMBED_PROVIDER', 'MMCAS_EMBED_ENDPOINT', 'MMCAS_EMBED_MODEL', 'MMCAS_EMBED_API_KEY_ENV', 'MMCAS_EMBED_DIM', 'MMCAS_EMBED_BATCH_SIZE', 'MMCAS_EMBED_TIMEOUT_MS', 'MMCAS_EMBED_MAX_CHARS', 'MMCAS_EMBED_CONFIG'].some((key) => env[key] !== undefined);
  return {
    provider,
    endpoint,
    model,
    apiKeyEnv: apiKeyEnv || null,
    apiKey: apiKey || null,
    hasKey: !!apiKey,
    dim,
    batchSize,
    timeoutMs,
    maxChars,
    source: hasCli ? 'cli' : (hasEnv ? 'env' : (existsSync(filePath) ? 'file' : 'default')),
    configPath: filePath,
  };
}

export function publicEmbedConfig(cfg) {
  return {
    provider: cfg.provider,
    endpoint: cfg.endpoint,
    model: cfg.model,
    apiKeyEnv: cfg.apiKeyEnv,
    hasKey: cfg.hasKey,
    dim: cfg.dim,
    batchSize: cfg.batchSize,
    timeoutMs: cfg.timeoutMs,
    maxChars: cfg.maxChars,
    source: cfg.source,
    configPath: cfg.configPath,
  };
}

export function normalizeVector(vector) {
  const values = Array.isArray(vector) ? vector.map(Number) : [];
  let sum = 0;
  for (const value of values) sum += value * value;
  if (!sum) return values.map(() => 0);
  const norm = Math.sqrt(sum);
  return values.map((value) => Number((value / norm).toFixed(6)));
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function fetchWithTimeout(url, init, timeoutMs, fetchImpl) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchImpl(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export async function embedTexts(texts, cfg, options = {}) {
  const inputs = Array.isArray(texts) ? texts : [];
  if (!inputs.length) return { vectors: [], dim: cfg.dim || 0, model: cfg.model, usage: null, batches: 0 };
  if (cfg.provider !== 'openai') throw new Error('当前 provider 不支持 embeddings: ' + cfg.provider);
  if (!cfg.endpoint) throw new Error('缺少 embeddings endpoint');
  if (cfg.apiKeyEnv && !cfg.apiKey && !options.allowNoKey) throw new Error('缺少 embeddings API key（' + cfg.apiKeyEnv + '）');
  const fetchImpl = options.fetchImpl || fetch;
  const batchSize = Math.max(1, Math.min(cfg.batchSize || 16, 128));
  const vectors = [];
  let usage = null;
  let model = cfg.model;
  let dim = cfg.dim || 0;
  let batches = 0;
  for (let start = 0; start < inputs.length; start += batchSize) {
    const batch = inputs.slice(start, start + batchSize).map((text) => String(text || '').slice(0, cfg.maxChars || 8000));
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
    const response = await fetchWithTimeout(cfg.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: cfg.model, input: batch, encoding_format: 'float' }),
    }, cfg.timeoutMs || 30000, fetchImpl);
    batches++;
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.text()).slice(0, 240); } catch {}
      throw new Error('embeddings HTTP ' + response.status + (detail ? ': ' + detail : ''));
    }
    let payload;
    try { payload = await response.json(); } catch { throw new Error('embeddings 响应不是 JSON'); }
    const data = Array.isArray(payload.data)
      ? payload.data.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      : [];
    if (data.length !== batch.length) throw new Error('embeddings 返回条数不符：期望 ' + batch.length + '，实际 ' + data.length);
    for (const item of data) {
      if (!Array.isArray(item.embedding) || !item.embedding.length) throw new Error('embeddings 返回空向量');
      const vector = item.embedding.map(Number);
      if (!vector.every(Number.isFinite)) throw new Error('embeddings 向量含非数值');
      if (!dim) dim = vector.length;
      if (vector.length !== dim) throw new Error('embeddings 向量维度不一致');
      vectors.push(vector);
    }
    if (payload.usage && typeof payload.usage === 'object') {
      usage = usage || {};
      for (const [key, value] of Object.entries(payload.usage)) usage[key] = (usage[key] || 0) + (Number(value) || 0);
    }
    if (payload.model) model = payload.model;
  }
  return { vectors, dim, model, usage, batches };
}
