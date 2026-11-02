import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [
  process.env.MMCAS_MEMORY_MODULE,
  path.join(HERE, '..', '..', 'core', 'memory', 'memory-index.mjs'),
  path.join(HERE, '..', '..', '..', 'core', 'memory', 'memory-index.mjs'),
].filter(Boolean);

let cachedModule = null;

export function resolveMemoryModulePath() {
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return path.resolve(candidate);
  }
  return null;
}

export async function loadMemoryModule() {
  if (!cachedModule) {
    const file = resolveMemoryModulePath();
    if (!file) throw new Error('未找到 MMCAS 记忆索引模块（memory-index.mjs）');
    cachedModule = import(pathToFileURL(file).href).catch((err) => {
      cachedModule = null;
      throw err;
    });
  }
  return cachedModule;
}

export async function searchMemoryFromWorkspace(workspace, options = {}) {
  if (!workspace) throw new Error('未配置工作区');
  const mod = await loadMemoryModule();
  return mod.searchMemory(workspace, options);
}

export async function memoryStatsFromWorkspace(workspace, options = {}) {
  if (!workspace) throw new Error('未配置工作区');
  const mod = await loadMemoryModule();
  return mod.memoryStats(workspace, options);
}

export async function handleMemorySearch(workspace, params) {
  const query = String(params.get('q') || '').trim();
  if (!query) return { status: 400, body: { ok: false, error: '缺少 q' } };
  try {
    const out = await searchMemoryFromWorkspace(workspace, {
      query,
      mode: params.get('mode') || 'hybrid',
      role: params.get('role') || 'all',
      limit: params.get('limit') || '20',
      since: params.get('since') || '',
      until: params.get('until') || '',
      backend: params.get('backend') || 'auto',
    });
    return { status: 200, body: { ok: true, ...out } };
  } catch (err) {
    return { status: 400, body: { ok: false, error: err.message } };
  }
}
