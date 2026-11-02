import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cosineSimilarity, embedTexts, normalizeVector, publicEmbedConfig, resolveEmbedConfig } from './memory-embed.mjs';
import { buildSqliteVec, findVecExtension, searchSqliteVec, sqlitePathFor } from './memory-vec-sqlite.mjs';

export const ROLES = ['modeler', 'coder', 'writer'];

const INDEX_VERSION = 3;
const MAX_INDEX_TEXT = 4000;
const STAMP_RE = /^## (\d{1,2}:\d{2}(?::\d{2})?)\s*$/gm;

export function defaultIndexPath(workspace) {
  const base = process.env.MMCAS_HOME || (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'mmcas')
    : path.join(os.homedir(), '.mmcas'));
  const key = createHash('sha256').update(path.resolve(workspace)).digest('hex').slice(0, 16);
  return path.join(base, 'memory-index', key + '.json');
}

export function tokenize(text) {
  const out = new Map();
  const s = String(text || '').toLowerCase().normalize('NFKC');
  const add = (token) => {
    if (!token) return;
    out.set(token, (out.get(token) || 0) + 1);
  };
  for (const word of s.match(/[a-z0-9][a-z0-9_+.#/-]*/g) || []) {
    add(word);
    for (const part of word.split(/[._/+#-]+/)) {
      if (part && part !== word) add(part);
    }
  }
  for (const run of s.match(/\p{Script=Han}+/gu) || []) {
    if (run.length === 1) add(run);
    else for (let i = 0; i < run.length - 1; i++) add(run.slice(i, i + 2));
  }
  return out;
}

export function scanMemory(workspace) {
  const root = path.join(workspace, 'memory');
  const files = {};
  const entries = [];
  if (!existsSync(root)) return { files, entries };
  for (const role of ROLES) {
    const dir = path.join(root, role);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md')) {
      const file = path.join(dir, name);
      let stat;
      let raw;
      try {
        stat = statSync(file);
        raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      } catch {
        continue;
      }
      const rel = role + '/' + name;
      files[rel] = { mtimeMs: stat.mtimeMs, size: stat.size };
      const date = name.replace(/\.md$/i, '');
      const marks = [];
      STAMP_RE.lastIndex = 0;
      let m;
      while ((m = STAMP_RE.exec(raw))) marks.push({ time: m[1].trim(), start: m.index, bodyStart: STAMP_RE.lastIndex });
      for (let i = 0; i < marks.length; i++) {
        const end = i + 1 < marks.length ? marks[i + 1].start : raw.length;
        const body = raw.slice(marks[i].bodyStart, end).trim();
        if (!body) continue;
        entries.push({ role, date, time: marks[i].time, text: body, file: rel });
      }
    }
  }
  return { files, entries };
}

function filesMatch(a, b) {
  const left = Object.keys(a || {});
  const right = Object.keys(b || {});
  if (left.length !== right.length) return false;
  for (const key of left) {
    if (!Object.hasOwn(b, key)) return false;
    if (Math.abs(a[key].mtimeMs - b[key].mtimeMs) > 0.5 || a[key].size !== b[key].size) return false;
  }
  return true;
}

function buildBaseIndex(scanned) {
  const docs = [];
  const df = Object.create(null);
  for (const entry of scanned.entries) {
    const tf = tokenize(entry.text);
    if (!tf.size) continue;
    docs.push({
      role: entry.role,
      date: entry.date,
      time: entry.time,
      file: entry.file,
      text: entry.text.slice(0, MAX_INDEX_TEXT),
      tf,
    });
  }
  const postings = Object.create(null);
  for (let i = 0; i < docs.length; i++) {
    for (const [token, count] of docs[i].tf) {
      if (!postings[token]) postings[token] = [];
      postings[token].push([i, count]);
      df[token] = (df[token] || 0) + 1;
    }
  }
  const idf = Object.create(null);
  for (const token of Object.keys(df)) {
    idf[token] = Math.log(1 + (docs.length - df[token] + 0.5) / (df[token] + 0.5));
  }
  for (const doc of docs) {
    let sum = 0;
    for (const [token, count] of doc.tf) {
      const weight = (1 + Math.log(count)) * idf[token];
      sum += weight * weight;
    }
    doc.norm = Math.sqrt(sum) || 1;
    delete doc.tf;
  }
  return {
    version: INDEX_VERSION,
    builtAt: new Date().toISOString(),
    files: scanned.files,
    docs,
    postings,
    idf,
    embed: null,
  };
}

async function buildIndexFromScan(scanned, options = {}) {
  const index = buildBaseIndex(scanned);
  const cfg = resolveEmbedConfig(options);
  const provider = options.provider || cfg.provider;
  const builtAt = index.builtAt;
  if (provider === 'openai') {
    if (!index.docs.length) {
      index.embed = { provider: 'openai', model: cfg.model, dim: cfg.dim || 0, builtAt, batches: 0, usage: null };
      return index;
    }
    const embedded = await embedTexts(index.docs.map((doc) => doc.text), cfg, options);
    if (embedded.vectors.length !== index.docs.length) throw new Error('embeddings 返回条数与文档数不符');
    for (let i = 0; i < index.docs.length; i++) index.docs[i].vec = normalizeVector(embedded.vectors[i]);
    index.embed = {
      provider: 'openai',
      model: embedded.model || cfg.model,
      dim: embedded.dim,
      builtAt,
      batches: embedded.batches,
      usage: embedded.usage,
    };
  } else {
    index.embed = {
      provider: 'hash',
      model: 'ngram-tfidf',
      dim: 0,
      builtAt,
    };
  }
  return index;
}

function writeIndex(file, index) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  writeFileSync(tmp, JSON.stringify(index));
  try {
    renameSync(tmp, file);
  } catch {
    try { unlinkSync(file); } catch {}
    renameSync(tmp, file);
  }
}

export async function getIndex(workspace, options = {}) {
  const file = options.index || defaultIndexPath(workspace);
  const scanned = scanMemory(workspace);
  const requestedProvider = options.provider || null;
  if (!options.rebuild) {
    try {
      const cached = JSON.parse(readFileSync(file, 'utf8'));
      if (cached && cached.version === INDEX_VERSION
        && filesMatch(cached.files, scanned.files)
        && (!requestedProvider || cached.embed?.provider === requestedProvider)) {
        return { index: cached, file, rebuilt: false, writeError: null };
      }
    } catch {}
  }
  const index = await buildIndexFromScan(scanned, { ...options, provider: requestedProvider || 'hash' });
  const backend = options.backend || 'auto';
  const wantSqlite = index.embed?.provider === 'openai'
    && (backend === 'sqlite' || (backend === 'auto' && !!findVecExtension(options.vecExt)));
  if (wantSqlite) {
    try {
      const dbFile = sqlitePathFor(file);
      const built = await buildSqliteVec(index, { dbFile, vecExt: options.vecExt, indexPath: file });
      index.embed.sqlite = { file: built.file, dim: built.dim, docs: built.docs, builtAt: index.embed.builtAt };
    } catch (err) {
      index.embed.sqliteError = err.message;
    }
  }
  let writeError = null;
  try {
    writeIndex(file, index);
  } catch (err) {
    writeError = err.message;
  }
  return { index, file, rebuilt: true, writeError };
}

function wordScore(text, terms) {
  const low = String(text || '').toLowerCase();
  let score = 0;
  for (const term of terms) {
    let at = 0;
    while ((at = low.indexOf(term, at)) >= 0) {
      score++;
      at += term.length;
    }
  }
  return score;
}

function inRange(entry, role, since, until) {
  if (role !== 'all' && entry.role !== role) return false;
  if (since && entry.date < since) return false;
  if (until && entry.date > until) return false;
  return true;
}

function hashVectorScores(index, query, role, since, until) {
  const vector = new Map();
  const qtf = tokenize(query);
  let qNorm = 0;
  for (const [token, count] of qtf) {
    if (!Object.hasOwn(index.postings, token) || !Object.hasOwn(index.idf, token)) continue;
    const idf = index.idf[token];
    const weight = (1 + Math.log(count)) * idf;
    qNorm += weight * weight;
    for (const [docIndex, docCount] of index.postings[token]) {
      const doc = index.docs[docIndex];
      if (!inRange(doc, role, since, until)) continue;
      const docWeight = (1 + Math.log(docCount)) * idf;
      vector.set(docIndex, (vector.get(docIndex) || 0) + weight * docWeight);
    }
  }
  qNorm = Math.sqrt(qNorm);
  if (qNorm) {
    for (const [docIndex, dot] of vector) {
      vector.set(docIndex, dot / (qNorm * (index.docs[docIndex].norm || 1)));
    }
  }
  return vector;
}

function denseVectorScores(index, queryVector, role, since, until) {
  const vector = new Map();
  for (let i = 0; i < index.docs.length; i++) {
    const doc = index.docs[i];
    if (!inRange(doc, role, since, until)) continue;
    if (!Array.isArray(doc.vec)) continue;
    vector.set(i, Math.max(0, cosineSimilarity(queryVector, doc.vec)));
  }
  return vector;
}

export async function searchMemory(workspace, options = {}) {
  const query = String(options.query || '').trim();
  if (!query) throw new Error('查询词为空');
  let mode = options.mode || 'hybrid';
  if (!['word', 'vector', 'hybrid', 'semantic'].includes(mode)) throw new Error('非法 mode: ' + mode);
  const role = options.role || 'all';
  if (role !== 'all' && !ROLES.includes(role)) throw new Error('非法 role: ' + role);
  const limit = Math.max(1, parseInt(options.limit || '10', 10) || 10);
  const since = options.since || '';
  const until = options.until || '';
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('非法 --since（YYYY-MM-DD）');
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error('非法 --until（YYYY-MM-DD）');
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const cfg = resolveEmbedConfig(options);
  const requestedMode = mode;
  let fallback = null;
  let backend = 'json';
  let backendNote = null;
  let loaded = null;
  let candidates;
  let vector = new Map();
  let effectiveMode = mode;

  if (mode === 'word') {
    candidates = scanMemory(workspace).entries;
  } else {
    let provider = options.provider || null;
    if (mode === 'semantic') {
      if (cfg.provider !== 'openai') {
        fallback = '语义检索需要 provider=openai（当前 ' + cfg.provider + '），已回退 hybrid';
        mode = 'hybrid';
        effectiveMode = 'hybrid';
      } else {
        provider = 'openai';
      }
    }
    try {
      loaded = await getIndex(workspace, { ...options, provider });
    } catch (err) {
      if (requestedMode !== 'semantic') throw err;
      fallback = err.message + '；已回退 hybrid';
      mode = 'hybrid';
      effectiveMode = 'hybrid';
      loaded = await getIndex(workspace, { ...options, provider: 'hash' });
    }
    const index = loaded.index;
    candidates = index.docs;
    if (mode === 'semantic') {
      const canSemantic = index.embed?.provider === 'openai'
        && index.embed.dim > 0
        && index.docs.every((doc) => Array.isArray(doc.vec) && doc.vec.length === index.embed.dim);
      if (!canSemantic) {
        fallback = '索引不含可用语义向量（provider=' + (index.embed?.provider || 'unknown') + '），已回退 hybrid';
        mode = 'hybrid';
        effectiveMode = 'hybrid';
      } else {
        try {
          const embedded = await embedTexts([query], cfg, options);
          if (embedded.model !== index.embed.model) throw new Error('嵌入模型不匹配：索引 ' + index.embed.model + '，配置 ' + embedded.model);
          if (embedded.dim !== index.embed.dim) throw new Error('嵌入维度不匹配：索引 ' + index.embed.dim + '，配置 ' + embedded.dim);
          const queryVector = normalizeVector(embedded.vectors[0]);
          const sqlite = index.embed.sqlite;
          if (options.backend === 'sqlite' && (!sqlite || !existsSync(sqlite.file))) {
            backendNote = 'sqlite-vec 索引不可用，已回退 JSON 向量';
          }
          if (options.backend !== 'json' && sqlite && existsSync(sqlite.file)) {
            const rows = await searchSqliteVec(sqlite.file, queryVector, {
              role,
              since,
              until,
              limit: Math.min(index.docs.length, Math.max(limit * 5, 50)),
              vecExt: options.vecExt,
              meta: {
                builtAt: index.embed.builtAt,
                model: index.embed.model,
                dim: index.embed.dim,
                docs: index.docs.length,
              },
            });
            if (rows) {
              backend = 'sqlite';
              for (const row of rows) vector.set(row.docIndex, row.similarity);
            } else {
              backendNote = 'sqlite-vec 索引不可用，已回退 JSON 向量';
            }
          }
          if (!vector.size) vector = denseVectorScores(index, queryVector, role, since, until);
          effectiveMode = 'semantic';
        } catch (err) {
          fallback = err.message + '；已回退 hybrid';
          mode = 'hybrid';
          effectiveMode = 'hybrid';
          backend = 'json';
          vector = new Map();
        }
      }
    }
    if (effectiveMode === 'vector' || effectiveMode === 'hybrid') {
      vector = hashVectorScores(index, query, role, since, until);
    }
  }

  const scored = [];
  for (let i = 0; i < candidates.length; i++) {
    const doc = candidates[i];
    if (!inRange(doc, role, since, until)) continue;
    if (effectiveMode === 'semantic' && backend === 'sqlite' && !vector.has(i)) continue;
    const cosine = vector.get(i) || 0;
    const hits = wordScore(doc.text, terms);
    const score = effectiveMode === 'word'
      ? hits
      : effectiveMode === 'vector'
        ? cosine
        : cosine + 0.25 * Math.log1p(hits);
    if (score <= 0) continue;
    scored.push({
      role: doc.role,
      date: doc.date,
      time: doc.time,
      text: doc.text,
      file: doc.file,
      score,
      vectorScore: cosine,
      wordScore: hits,
    });
  }
  scored.sort((a, b) => b.score - a.score
    || b.date.localeCompare(a.date)
    || b.time.localeCompare(a.time)
    || a.file.localeCompare(b.file));
  return {
    query,
    mode: requestedMode,
    effectiveMode,
    fallback,
    backend,
    backendNote,
    provider: loaded?.index.embed?.provider || 'hash',
    indexPath: loaded ? loaded.file : null,
    builtAt: loaded ? loaded.index.builtAt : null,
    rebuilt: loaded ? loaded.rebuilt : false,
    docs: loaded ? loaded.index.docs.length : candidates.length,
    total: scored.length,
    results: scored.slice(0, limit),
  };
}

export async function memoryStats(workspace, options = {}) {
  const loaded = await getIndex(workspace, options);
  const staleDays = Math.max(0, parseInt(options.staleDays || '0', 10) || 0);
  const cutoff = staleDays ? new Date(Date.now() - staleDays * 86400000).toISOString().slice(0, 10) : null;
  let staleDocs = 0;
  let oldestDate = null;
  for (const doc of loaded.index.docs) {
    if (!oldestDate || doc.date < oldestDate) oldestDate = doc.date;
    if (cutoff && doc.date < cutoff) staleDocs++;
  }
  return {
    indexPath: loaded.file,
    builtAt: loaded.index.builtAt,
    rebuilt: loaded.rebuilt,
    writeError: loaded.writeError,
    files: Object.keys(loaded.index.files).length,
    docs: loaded.index.docs.length,
    tokens: Object.keys(loaded.index.postings).length,
    version: loaded.index.version,
    embed: loaded.index.embed,
    staleDays,
    staleCutoff: cutoff,
    staleDocs,
    oldestDate,
  };
}

const VALUE_FLAGS = new Map([
  ['workspace', 'workspace'],
  ['provider', 'provider'],
  ['embed-config', 'embedConfig'],
  ['endpoint', 'endpoint'],
  ['model', 'model'],
  ['api-key-env', 'apiKeyEnv'],
  ['dim', 'dim'],
  ['batch-size', 'batchSize'],
  ['timeout-ms', 'timeoutMs'],
  ['max-chars', 'maxChars'],
  ['backend', 'backend'],
  ['vec-ext', 'vecExt'],
  ['index', 'index'],
  ['stale-days', 'staleDays'],
]);

const USAGE = [
  '用法: node memory-index.mjs --workspace <ws> [选项]',
  '',
  '选项:',
  '  --provider hash|openai            索引类型（默认读取 memory-embed.json，否则 hash）',
  '  --embed-config <file>             embeddings 配置文件（默认 <MMCAS_HOME>/memory-embed.json）',
  '  --endpoint/--model/--api-key-env  覆盖 embeddings 配置',
  '  --dim/--batch-size/--timeout-ms   覆盖 embeddings 参数',
  '  --backend auto|json|sqlite        向量存储后端（默认 auto）',
  '  --vec-ext <path>                  sqlite-vec 扩展路径',
  '  --index <path>                    自定义 JSON 索引缓存路径',
  '  --rebuild                         强制重建（默认构建模式即重建）',
  '  --stats [--stale-days N]          输出索引统计与过期条目提示',
  '  --dry-run                         只统计不调用 embeddings、不写索引',
  '  --show-config                     输出脱敏后的 embeddings 配置',
  '  --json                            JSON 输出',
  '  -h, --help                        显示帮助',
].join('\n');

function parseArgs(argv) {
  const opts = { workspace: path.join(process.cwd(), 'workspace'), backend: 'auto', staleDays: '0' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') { opts.help = true; continue; }
    if (arg === '--json') { opts.json = true; continue; }
    if (arg === '--rebuild') { opts.rebuild = true; continue; }
    if (arg === '--stats') { opts.stats = true; continue; }
    if (arg === '--dry-run') { opts.dryRun = true; continue; }
    if (arg === '--show-config') { opts.showConfig = true; continue; }
    if (arg.startsWith('--')) {
      let name = arg.slice(2);
      let value;
      const eq = name.indexOf('=');
      if (eq >= 0) {
        value = name.slice(eq + 1);
        name = name.slice(0, eq);
      }
      const key = VALUE_FLAGS.get(name);
      if (!key) throw new Error('未知参数: --' + name);
      if (value === undefined) {
        value = argv[++i];
        if (value === undefined) throw new Error('缺少参数值: --' + name);
      }
      opts[key] = value;
      continue;
    }
    throw new Error('未知参数: ' + arg);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  if (opts.showConfig) {
    console.log(JSON.stringify(publicEmbedConfig(resolveEmbedConfig(opts)), null, 2));
    return;
  }
  if (opts.dryRun) {
    const scanned = scanMemory(opts.workspace);
    const cfg = resolveEmbedConfig(opts);
    const provider = opts.provider || cfg.provider;
    const batches = provider === 'openai' ? Math.ceil(scanned.entries.length / Math.max(1, cfg.batchSize)) : 0;
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      provider,
      docs: scanned.entries.length,
      files: Object.keys(scanned.files).length,
      batches,
      config: publicEmbedConfig(cfg),
    }, null, 2));
    return;
  }
  if (opts.stats) {
    const stats = await memoryStats(opts.workspace, opts);
    if (opts.json) console.log(JSON.stringify(stats, null, 2));
    else {
      console.log('索引: ' + stats.indexPath);
      console.log('文档: ' + stats.docs + ' 条 / 文件: ' + stats.files + ' 个 / 词元: ' + stats.tokens + ' 个');
      console.log('类型: ' + (stats.embed?.provider || 'unknown') + (stats.embed?.model ? ' / ' + stats.embed.model : '') + (stats.embed?.dim ? ' / ' + stats.embed.dim + 'd' : ''));
      if (stats.embed?.sqlite) console.log('sqlite-vec: ' + stats.embed.sqlite.file);
      if (stats.embed?.sqliteError) console.log('sqlite-vec 不可用: ' + stats.embed.sqliteError);
      if (stats.writeError) console.log('索引写入失败: ' + stats.writeError);
      console.log('构建: ' + stats.builtAt + (stats.rebuilt ? '（本次重建）' : '（缓存命中）'));
      if (stats.staleDays) console.log('过期提示: ' + stats.staleDocs + ' 条早于 ' + stats.staleCutoff + '（最早 ' + (stats.oldestDate || '—') + '）');
    }
    console.log('INDEX_RESULT=' + JSON.stringify(stats));
    return;
  }
  const started = Date.now();
  const cfg = resolveEmbedConfig(opts);
  const provider = opts.provider || cfg.provider;
  const loaded = await getIndex(opts.workspace, { ...opts, provider, rebuild: true });
  const result = {
    ok: !loaded.writeError,
    indexPath: loaded.file,
    builtAt: loaded.index.builtAt,
    docs: loaded.index.docs.length,
    files: Object.keys(loaded.index.files).length,
    provider: loaded.index.embed?.provider || null,
    model: loaded.index.embed?.model || null,
    dim: loaded.index.embed?.dim || 0,
    batches: loaded.index.embed?.batches || 0,
    sqlite: loaded.index.embed?.sqlite || null,
    sqliteError: loaded.index.embed?.sqliteError || null,
    writeError: loaded.writeError,
    elapsedS: Math.round((Date.now() - started) / 100) / 10,
  };
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('索引: ' + result.indexPath);
    console.log('文档: ' + result.docs + ' 条 / 文件: ' + result.files + ' 个');
    console.log('类型: ' + result.provider + ' / ' + result.model + (result.dim ? ' / ' + result.dim + 'd' : '') + '（批次 ' + result.batches + '）');
    if (result.sqlite) console.log('sqlite-vec: ' + result.sqlite.file);
    if (result.sqliteError) console.log('sqlite-vec 不可用: ' + result.sqliteError);
    if (result.writeError) console.log('索引写入失败: ' + result.writeError);
    console.log('耗时: ' + result.elapsedS + 's');
  }
  console.log('INDEX_RESULT=' + JSON.stringify(result));
  if (!result.ok) process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(2);
  });
}
