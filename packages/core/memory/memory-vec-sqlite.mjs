import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_NAMES = ['vec0.dll', 'vec0.so', 'vec0.dylib'];

export function findVecExtension(explicit) {
  if (explicit) return existsSync(explicit) ? path.resolve(explicit) : null;
  if (process.env.MMCAS_VEC_EXT) {
    return existsSync(process.env.MMCAS_VEC_EXT) ? path.resolve(process.env.MMCAS_VEC_EXT) : null;
  }
  const candidates = [];
  for (const name of EXT_NAMES) {
    candidates.push(path.join(HERE, name));
    candidates.push(path.join(process.cwd(), 'vendor', 'sqlite-vec', name));
    candidates.push(path.join(HERE, '..', '..', '..', 'vendor', 'sqlite-vec', name));
  }
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return path.resolve(candidate);
  }
  return null;
}

export async function loadSqlite() {
  try {
    return await import('node:sqlite');
  } catch {
    return null;
  }
}

export async function sqliteReady(explicit) {
  const extension = findVecExtension(explicit);
  if (!extension) return { ok: false, reason: '未找到 sqlite-vec 扩展（vec0.dll）', extension: null, sqlite: null };
  const sqlite = await loadSqlite();
  if (!sqlite) return { ok: false, reason: '当前 Node 不支持 node:sqlite（需 >= 22.5）', extension, sqlite: null };
  return { ok: true, reason: null, extension, sqlite };
}

export function sqlitePathFor(jsonPath) {
  return String(jsonPath || 'memory.json').replace(/\.json$/i, '.sqlite');
}

export async function buildSqliteVec(index, options = {}) {
  const ready = await sqliteReady(options.vecExt);
  if (!ready.ok) throw new Error(ready.reason);
  const dim = index.embed?.dim || index.docs?.[0]?.vec?.length || 0;
  if (!dim) throw new Error('索引没有稠密向量（dim=0）');
  if (!index.docs.every((doc) => Array.isArray(doc.vec) && doc.vec.length === dim)) {
    throw new Error('文档向量缺失或维度不一致');
  }
  const dbFile = options.dbFile || sqlitePathFor(options.indexPath || 'memory.sqlite');
  mkdirSync(path.dirname(dbFile), { recursive: true });
  const tmp = dbFile + '.' + process.pid + '.tmp';
  try { rmSync(tmp, { force: true }); } catch {}
  const { DatabaseSync } = ready.sqlite;
  const db = new DatabaseSync(tmp, { allowExtension: true });
  try {
    db.loadExtension(ready.extension);
    db.exec('CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT)');
    db.exec(`CREATE VIRTUAL TABLE vec USING vec0(embedding float[${dim}], role text, date text)`);
    const meta = db.prepare('INSERT INTO meta(k, v) VALUES (?, ?)');
    meta.run('version', String(index.version));
    meta.run('builtAt', index.builtAt);
    meta.run('provider', index.embed.provider);
    meta.run('model', index.embed.model);
    meta.run('dim', String(dim));
    meta.run('docs', String(index.docs.length));
    const insert = db.prepare('INSERT INTO vec(rowid, embedding, role, date) VALUES (?, ?, ?, ?)');
    db.exec('BEGIN');
    for (let i = 0; i < index.docs.length; i++) {
      const doc = index.docs[i];
      insert.run(BigInt(i + 1), JSON.stringify(doc.vec), doc.role, doc.date);
    }
    db.exec('COMMIT');
  } finally {
    try { db.close(); } catch {}
  }
  try { rmSync(dbFile, { force: true }); } catch {}
  renameSync(tmp, dbFile);
  return { file: dbFile, dim, docs: index.docs.length, extension: ready.extension };
}

export async function searchSqliteVec(dbFile, queryVector, options = {}) {
  if (!existsSync(dbFile)) return null;
  const ready = await sqliteReady(options.vecExt);
  if (!ready.ok) return null;
  const { DatabaseSync } = ready.sqlite;
  let db;
  try {
    db = new DatabaseSync(dbFile, { allowExtension: true });
    db.loadExtension(ready.extension);
    if (options.meta) {
      const rows = db.prepare('SELECT k, v FROM meta').all();
      const meta = Object.fromEntries(rows.map((row) => [row.k, row.v]));
      for (const [key, value] of Object.entries(options.meta)) {
        if (String(meta[key]) !== String(value)) return null;
      }
    }
    const where = ['embedding MATCH ?'];
    const params = [JSON.stringify(queryVector)];
    if (options.role && options.role !== 'all') { where.push('role = ?'); params.push(options.role); }
    if (options.since) { where.push('date >= ?'); params.push(options.since); }
    if (options.until) { where.push('date <= ?'); params.push(options.until); }
    const limit = Math.max(1, Math.min(options.limit || 10, 1000));
    params.push(limit);
    const rows = db.prepare(`SELECT rowid, distance FROM vec WHERE ${where.join(' AND ')} ORDER BY distance LIMIT ?`).all(...params);
    return rows.map((row) => {
      const distance = Number(row.distance);
      return {
        docIndex: Number(row.rowid) - 1,
        distance,
        similarity: Math.max(0, Math.min(1, 1 - (distance * distance) / 2)),
      };
    });
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch {}
  }
}
