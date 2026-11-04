#!/usr/bin/env node
import path from 'node:path';
import { memoryStats, searchMemory } from './memory-index.mjs';

const VALUE_FLAGS = new Map([
  ['workspace', 'workspace'],
  ['role', 'role'],
  ['limit', 'limit'],
  ['mode', 'mode'],
  ['index', 'index'],
  ['since', 'since'],
  ['until', 'until'],
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
  ['stale-days', 'staleDays'],
]);

const USAGE = [
  '用法: node memory-search.mjs --workspace <ws> <查询词> [选项]',
  '',
  '选项:',
  '  --role modeler|coder|writer|all   角色过滤（默认 all）',
  '  --limit N                         返回条数（默认 10）',
  '  --mode word|vector|hybrid|semantic 检索模式（默认 hybrid）',
  '  --since YYYY-MM-DD                起始日期',
  '  --until YYYY-MM-DD                截止日期',
  '  --provider hash|openai            覆盖索引 provider（semantic 需 openai）',
  '  --embed-config <file>             embeddings 配置',
  '  --backend auto|json|sqlite        语义向量后端（默认 auto）',
  '  --index <路径>                    自定义索引缓存路径',
  '  --rebuild                         强制重建索引',
  '  --stats [--stale-days N]          输出索引统计（无需查询词）',
  '  --include-archive                 包含 memory/<role>/archive/',
  '  --json                            JSON 输出',
  '  -h, --help                        显示帮助',
].join('\n');

function parseArgs(argv) {
  const opts = {
    workspace: path.join(process.cwd(), 'workspace'),
    role: 'all',
    limit: '10',
    mode: 'hybrid',
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') { opts.help = true; continue; }
    if (arg === '--json') { opts.json = true; continue; }
    if (arg === '--rebuild') { opts.rebuild = true; continue; }
    if (arg === '--stats') { opts.stats = true; continue; }
    if (arg === '--include-archive') { opts.includeArchive = true; continue; }
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
    positional.push(arg);
  }
  opts.query = positional.join(' ').trim();
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  if (opts.stats) {
    try {
      const stats = await memoryStats(opts.workspace, opts);
      if (opts.json) console.log(JSON.stringify(stats, null, 2));
      else {
        console.log('索引: ' + stats.indexPath);
        console.log('文档: ' + stats.docs + ' 条 / 文件: ' + stats.files + ' 个 / 词元: ' + stats.tokens + ' 个');
        console.log('类型: ' + (stats.embed?.provider || 'unknown') + (stats.embed?.model ? ' / ' + stats.embed.model : '') + (stats.embed?.dim ? ' / ' + stats.embed.dim + 'd' : ''));
        if (stats.embed?.sqlite) console.log('sqlite-vec: ' + stats.embed.sqlite.file);
        if (stats.embed?.sqliteError) console.log('sqlite-vec 不可用: ' + stats.embed.sqliteError);
        console.log('构建: ' + stats.builtAt + (stats.rebuilt ? '（本次重建）' : '（缓存命中）'));
        if (stats.staleDays) console.log('过期提示: ' + stats.staleDocs + ' 条早于 ' + stats.staleCutoff + '（最早 ' + (stats.oldestDate || '—') + '）');
      }
    } catch (err) {
      console.error(err.message);
      process.exit(2);
    }
    return;
  }
  if (!opts.query) {
    console.error(USAGE);
    process.exit(2);
  }
  let out;
  try {
    out = await searchMemory(opts.workspace, opts);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (opts.json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (out.fallback) console.error('[memory-search] ' + out.fallback);
  if (out.backendNote) console.error('[memory-search] ' + out.backendNote);
  if (!out.results.length) {
    console.log('共 0 条命中');
    return;
  }
  for (const result of out.results) {
    const score = out.effectiveMode === 'word' ? String(result.score) : result.score.toFixed(3);
    console.log(`[${result.role} ${result.date} ${result.time}] (分=${score})`);
    console.log('  ' + result.text.slice(0, 300).replace(/\n/g, '\n  '));
    console.log('');
  }
  console.log(`共 ${out.total} 条命中${out.total > out.results.length ? `（显示前 ${out.results.length}）` : ''}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(2);
});
