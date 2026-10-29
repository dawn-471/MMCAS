/**
 * MMCAS profile patch helpers.
 *
 * dsh 0.2.x keeps live settings in the active profile's cordis.patch.yml. MMCAS
 * scripts must merge their entries into that file instead of overwriting it or
 * writing the legacy settings.yaml (which dsh only imports once and then renames).
 *
 * The helpers below are deliberately syntax-light: profile patches are a
 * top-level YAML list of entries, and MMCAS only owns a handful of entries. We
 * locate top-level `- id: <id>` blocks, replace their config keys, and leave all
 * other entries/comments untouched.
 */
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, lstatSync, realpathSync,
} from 'node:fs';
import path from 'node:path';

export function normalizeText(text) {
  return String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function readText(file, fallback = '') {
  try { return normalizeText(readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeText(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, normalizeText(text).replace(/\n*$/, '\n'), 'utf8');
}

export function yamlScalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const s = String(value ?? '');
  if (s === '') return "''";
  if (/^[A-Za-z0-9_./:@+-]+$/.test(s) && !/^(true|false|null|~)$/i.test(s)) return s;
  return JSON.stringify(s);
}

export function indentLines(text, spaces) {
  const pad = ' '.repeat(spaces);
  return normalizeText(text).split('\n').map((line) => (line ? pad + line : '')).join('\n');
}

function lineIndent(line) {
  const m = /^( *)/.exec(line);
  return m ? m[1].length : 0;
}

function isTopLevelStart(line) {
  if (!line || line.trim() === '') return false;
  if (lineIndent(line) !== 0) return false;
  return line.startsWith('- ') || line.startsWith('#') || /^\S/.test(line);
}

/** Locate one top-level list entry by id. */
export function findEntryRange(lines, id) {
  const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRe = new RegExp(`^-\\s*id:\\s*["']?${escaped}["']?\\s*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isTopLevelStart(lines[i])) { end = i; break; }
  }
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  return { start, end };
}

/** Return one top-level entry block, or null. */
export function getEntry(text, id) {
  const lines = normalizeText(text).split('\n');
  const range = findEntryRange(lines, id);
  if (!range) return null;
  return lines.slice(range.start, range.end).join('\n');
}

/** Replace or append one top-level entry block. */
export function upsertEntry(text, id, block) {
  const lines = normalizeText(text).split('\n');
  // Remove the empty-list marker; a patch cannot hold `[]` and entries together.
  const filtered = lines.filter((line) => line.trim() !== '[]');
  const range = findEntryRange(filtered, id);
  const blockLines = normalizeText(block).replace(/\n*$/, '').split('\n');
  if (range) {
    filtered.splice(range.start, range.end - range.start, ...blockLines);
  } else {
    while (filtered.length && filtered[filtered.length - 1].trim() === '') filtered.pop();
    if (filtered.length) filtered.push('');
    filtered.push(...blockLines);
  }
  return filtered.join('\n').replace(/\n*$/, '\n');
}

/** Remove one top-level entry block. */
export function removeEntry(text, id) {
  const lines = normalizeText(text).split('\n');
  const range = findEntryRange(lines, id);
  if (!range) return lines.join('\n').replace(/\n*$/, '\n');
  lines.splice(range.start, range.end - range.start);
  return lines.join('\n').replace(/\n*$/, '\n');
}

function configRange(lines, entry) {
  let config = -1;
  for (let i = entry.start; i < entry.end; i++) {
    if (/^  config\s*:/.test(lines[i])) { config = i; break; }
  }
  if (config < 0) return null;
  let end = entry.end;
  for (let i = config + 1; i < entry.end; i++) {
    if (lines[i].trim() !== '' && lineIndent(lines[i]) <= 2) { end = i; break; }
  }
  return { start: config, end };
}

function ensureConfig(lines, entry) {
  let range = configRange(lines, entry);
  if (range) {
    if (/^  config\s*:\s*\{\s*\}\s*$/.test(lines[range.start])) lines[range.start] = '  config:';
    return { start: range.start, end: range.end };
  }
  // Insert after the last non-empty line of the entry.
  let at = entry.end;
  while (at > entry.start && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, '  config:');
  return { start: at, end: at + 1 };
}

/** Set simple scalar keys under an entry's `config:`. */
export function setEntryConfigScalars(text, id, scalars) {
  const lines = normalizeText(text).split('\n');
  const entry = findEntryRange(lines, id);
  if (!entry) throw new Error(`profile-patch: entry not found: ${id}`);
  const cfg = ensureConfig(lines, entry);
  for (const [key, value] of Object.entries(scalars || {})) {
    const re = new RegExp(`^    ${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
    let found = -1;
    for (let i = cfg.start + 1; i < cfg.end; i++) if (re.test(lines[i])) { found = i; break; }
    const line = `    ${key}: ${yamlScalar(value)}`;
    if (found >= 0) lines[found] = line;
    else {
      let at = cfg.end;
      while (at > cfg.start + 1 && lines[at - 1].trim() === '') at--;
      lines.splice(at, 0, line);
      cfg.end += 1;
    }
  }
  return lines.join('\n').replace(/\n*$/, '\n');
}

/** Replace one nested block (for example `models:`) under an entry's `config:`. */
export function setEntryConfigBlock(text, id, key, blockLines) {
  const lines = normalizeText(text).split('\n');
  const entry = findEntryRange(lines, id);
  if (!entry) throw new Error(`profile-patch: entry not found: ${id}`);
  const cfg = ensureConfig(lines, entry);
  const re = new RegExp(`^    ${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
  let found = -1;
  for (let i = cfg.start + 1; i < cfg.end; i++) if (re.test(lines[i])) { found = i; break; }
  const block = normalizeText(Array.isArray(blockLines) ? blockLines.join('\n') : blockLines)
    .replace(/\n*$/, '').split('\n');
  if (found >= 0) {
    let end = cfg.end;
    for (let i = found + 1; i < cfg.end; i++) {
      if (lines[i].trim() !== '' && lineIndent(lines[i]) <= 4) { end = i; break; }
    }
    lines.splice(found, end - found, ...block);
  } else {
    let at = cfg.end;
    while (at > cfg.start + 1 && lines[at - 1].trim() === '') at--;
    lines.splice(at, 0, ...block);
  }
  return lines.join('\n').replace(/\n*$/, '\n');
}

/** Create/normalize a profile directory without touching existing content. */
export function ensureProfileScaffold(profileDir, { name, bundles = [] } = {}) {
  mkdirSync(profileDir, { recursive: true });
  const manifestPath = path.join(profileDir, 'package.json');
  if (!existsSync(manifestPath)) {
    const manifest = {
      name: name || `dsh-profile-${path.basename(profileDir)}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...new Set(bundles)] } },
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }
  const patchPath = path.join(profileDir, 'cordis.patch.yml');
  if (!existsSync(patchPath)) {
    writeText(patchPath, [
      '# MMCAS profile patch — managed entries are merged; other entries are preserved.',
      '# dsh 0.2.x stores live settings here (not settings.yaml).',
      '[]',
    ].join('\n'));
  }
  const workspacePath = path.join(profileDir, 'pnpm-workspace.yaml');
  if (!existsSync(workspacePath)) {
    writeText(workspacePath, 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n');
  }
  const rootPath = path.join(profileDir, 'cordis.yml');
  if (!existsSync(rootPath)) {
    writeText(rootPath, '# dsh profile root — edits belong in cordis.patch.yml.\n[]');
  }
}

/** Merge bundles/dependencies into a profile manifest, preserving everything else. */
export function mergeProfileManifest(profileDir, { name, bundles = [], dependencies = {}, patchReload } = {}) {
  const manifestPath = path.join(profileDir, 'package.json');
  let manifest = {};
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch {}
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) manifest = {};
  if (!manifest.name) manifest.name = name || `dsh-profile-${path.basename(profileDir)}`;
  manifest.private = true;
  if (!manifest.dependencies || typeof manifest.dependencies !== 'object' || Array.isArray(manifest.dependencies)) manifest.dependencies = {};
  for (const [key, value] of Object.entries(dependencies || {})) manifest.dependencies[key] = value;
  manifest.dsh = manifest.dsh && typeof manifest.dsh === 'object' ? manifest.dsh : {};
  manifest.dsh.profile = manifest.dsh.profile && typeof manifest.dsh.profile === 'object' ? manifest.dsh.profile : {};
  const current = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : [];
  manifest.dsh.profile.bundles = [...new Set([...current, ...bundles])];
  if (patchReload !== undefined && manifest.dsh.profile.patchReload === undefined) {
    manifest.dsh.profile.patchReload = patchReload;
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}

function linkTarget(linkPath) {
  try {
    const info = lstatSync(linkPath);
    if (info.isSymbolicLink()) return readlinkSync(linkPath);
    return null;
  } catch { return null; }
}

/** Create/replace a profile-local package link (Windows junction). */
export function ensureProfileLink(profileDir, packageName, targetDir) {
  const linkPath = path.join(profileDir, 'node_modules', ...packageName.split('/'));
  mkdirSync(path.dirname(linkPath), { recursive: true });
  const target = realpathSync.native ? realpathSync.native(targetDir) : realpathSync(targetDir);
  const current = linkTarget(linkPath);
  if (current) {
    try { if (realpathSync(current) === target) return linkPath; } catch {}
    rmSync(linkPath, { recursive: true, force: true });
  } else if (existsSync(linkPath)) {
    // A real directory is not ours to delete.
    throw new Error(`profile-patch: ${linkPath} exists and is not a link`);
  }
  symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  return linkPath;
}

/** Repair broken package junctions left by an older dsh profile install. */
export function repairBrokenLinks(profileDir) {
  const nm = path.join(profileDir, 'node_modules');
  if (!existsSync(nm)) return [];
  const removed = [];
  const visit = (dir, depth) => {
    if (depth > 2) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      const target = linkTarget(full);
      if (!target) continue;
      try {
        if (!existsSync(path.join(target, 'package.json'))) {
          rmSync(full, { recursive: true, force: true });
          removed.push(full);
        }
      } catch {}
    }
  };
  // node_modules/@scope/pkg (depth 2)
  try {
    const scopes = readdirSync(nm, { withFileTypes: true });
    for (const scope of scopes) {
      if (!scope.isDirectory()) continue;
      const scopeDir = path.join(nm, scope.name);
      if (scope.name.startsWith('@')) visit(scopeDir, 1);
    }
  } catch {}
  return removed;
}
