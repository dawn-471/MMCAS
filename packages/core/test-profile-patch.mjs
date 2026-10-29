#!/usr/bin/env node
/** profile-patch.mjs 单元验证：合并写入不破坏 dsh 0.2.x profile 设置。 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ensureProfileScaffold, mergeProfileManifest, upsertEntry, getEntry, removeEntry,
  setEntryConfigScalars, setEntryConfigBlock, writeText, readText, ensureProfileLink, repairBrokenLinks,
} from './profile-patch.mjs';

const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-profile-patch-'));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}

console.log('\n[P1] scaffold + manifest merge');
{
  const profile = path.join(ROOT, 'web');
  ensureProfileScaffold(profile, { name: 'dsh-profile-web', bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] });
  mergeProfileManifest(profile, {
    name: 'dsh-profile-web',
    bundles: ['@mmcas/dsh-panel'],
    dependencies: { '@mmcas/dsh-panel': 'link:D:/tmp/mmcas-panel' },
    patchReload: 'startup',
  });
  const manifest = JSON.parse(readFileSync(path.join(profile, 'package.json'), 'utf8'));
  check('P1 bundles 追加且去重', manifest.dsh.profile.bundles.filter((x) => x === '@deepseek-ai/dsh-base').length === 1 && manifest.dsh.profile.bundles.includes('@mmcas/dsh-panel'), JSON.stringify(manifest.dsh.profile.bundles));
  check('P1 dependency 写入', manifest.dependencies['@mmcas/dsh-panel'] === 'link:D:/tmp/mmcas-panel');
  check('P1 patchReload 写入', manifest.dsh.profile.patchReload === 'startup');
  check('P1 pnpm-workspace/cordis.yml 已生成', existsSync(path.join(profile, 'pnpm-workspace.yaml')) && existsSync(path.join(profile, 'cordis.yml')));
}

console.log('\n[P2] 顶层 entry 合并/替换/保留');
{
  const profile = path.join(ROOT, 'web');
  const patchFile = path.join(profile, 'cordis.patch.yml');
  writeText(patchFile, [
    '# user settings',
    '- id: llm-deepseek',
    "  name: '@deepseek-ai/dsh-llm-deepseek-api-key'",
    '  config:',
    '    baseURL: https://old.example/v1',
    '    customKeep: yes',
    '    models:',
    '      - id: old-model',
    '- id: mmcas-panel',
    '  config:',
    '    workspaceDir: D:/ws',
  ].join('\n'));
  let patch = readText(patchFile);
  patch = upsertEntry(patch, 'system-prompt', '- id: system-prompt\n  config:\n    personaPrefix: |\n      role\n');
  patch = upsertEntry(patch, 'llm-deepseek', '- id: llm-deepseek\n  config:\n    baseURL: https://new.example/v1\n');
  check('P2 新 entry 追加', !!getEntry(patch, 'system-prompt'));
  check('P2 已有 entry 替换后只出现一次', (patch.match(/^- id: llm-deepseek$/gm) || []).length === 1);
  check('P2 其他 entry 保留', !!getEntry(patch, 'mmcas-panel') && patch.includes('customKeep: yes') === false);
  patch = setEntryConfigScalars(patch, 'llm-deepseek', { apiKeyEnv: 'MMCAS_PROVIDER_KEY', reasoningEffort: 'high' });
  patch = setEntryConfigBlock(patch, 'llm-deepseek', 'models', ['    models:', '      - id: new-model', '        name: New Model']);
  check('P2 scalar 写入', /^    apiKeyEnv: MMCAS_PROVIDER_KEY$/m.test(patch) && /^    reasoningEffort: high$/m.test(patch));
  check('P2 block 替换', patch.includes('- id: new-model') && !patch.includes('old-model'));
  const removed = removeEntry(patch, 'system-prompt');
  check('P2 removeEntry 删除指定项且保留其他项', !getEntry(removed, 'system-prompt') && !!getEntry(removed, 'llm-deepseek'));
}

console.log('\n[P3] config: {} / 缺失 config / 幂等');
{
  const profile = path.join(ROOT, 'desktop');
  ensureProfileScaffold(profile, { name: 'dsh-profile-desktop' });
  const patchFile = path.join(profile, 'cordis.patch.yml');
  writeText(patchFile, [
    '- id: mmcas-panel',
    '  config: {}',
    '- id: agent-default-model',
    '  name: "@deepseek-ai/dsh-agent-default-model"',
    '  config:',
    '    provider: deepseek-official',
    '    model: old',
    '    reasoningEffort: high',
  ].join('\n'));
  let patch = readText(patchFile);
  patch = setEntryConfigScalars(patch, 'mmcas-panel', { port: 19398 });
  patch = setEntryConfigScalars(patch, 'agent-default-model', { model: 'new-model' });
  patch = setEntryConfigScalars(patch, 'agent-default-model', { model: 'new-model' });
  check('P3 config:{} 展开并写入', /^  config:$/m.test(patch) && /^    port: 19398$/m.test(patch));
  check('P3 保留 reasoningEffort', /^    reasoningEffort: high$/m.test(patch));
  check('P3 重复写不产生重复 key', (patch.match(/^    model:/gm) || []).length === 1);
  check('P3 顶层条目数不变', (patch.match(/^- id:/gm) || []).length === 2);
}

console.log('\n[P4] 链接与失效链接清理');
{
  const target = path.join(ROOT, 'panel-pkg');
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, 'package.json'), '{"name":"@mmcas/dsh-panel"}\n');
  const profile = path.join(ROOT, 'desktop');
  ensureProfileLink(profile, '@mmcas/dsh-panel', target);
  const link = path.join(profile, 'node_modules', '@mmcas', 'dsh-panel');
  check('P4 junction 创建', lstatSync(link).isSymbolicLink());
  const brokenTarget = path.join(ROOT, 'gone-pkg');
  mkdirSync(brokenTarget, { recursive: true });
  writeFileSync(path.join(brokenTarget, 'package.json'), '{}\n');
  ensureProfileLink(profile, '@mmcas/dsh-gone', brokenTarget);
  rmSync(brokenTarget, { recursive: true, force: true });
  const removed = repairBrokenLinks(profile);
  check('P4 失效链接被清理', removed.some((p) => p.includes('dsh-gone')) && !existsSync(path.join(profile, 'node_modules', '@mmcas', 'dsh-gone')));
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
process.exit(fail === 0 ? 0 : 1);
