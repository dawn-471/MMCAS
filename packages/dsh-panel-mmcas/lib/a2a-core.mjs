import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const FILES = {
  server: 'a2a-server.mjs',
  client: 'a2a-client.mjs',
  discovery: 'a2a-discovery.mjs',
  protocol: 'a2a-protocol.mjs',
};

const cache = {};

function candidates(file, coreDir) {
  const out = [];
  if (coreDir) out.push(path.join(String(coreDir), 'a2a', file));
  out.push(path.join(HERE, '..', '..', 'core', 'a2a', file));
  out.push(path.join(HERE, '..', '..', '..', 'core', 'a2a', file));
  return out;
}

export function resolveCoreA2APath(name, coreDir) {
  const file = FILES[name] || name;
  for (const candidate of candidates(file, coreDir)) {
    if (existsSync(candidate)) return path.resolve(candidate);
  }
  return null;
}

export async function loadA2ACore(coreDir) {
  const result = {};
  for (const [name, file] of Object.entries(FILES)) {
    const resolved = resolveCoreA2APath(name, coreDir);
    if (!resolved) throw new Error('未找到 A2A 模块: ' + file);
    const key = resolved.toLowerCase();
    if (!cache[key]) cache[key] = import(pathToFileURL(resolved).href);
    result[name] = await cache[key];
  }
  return result;
}
