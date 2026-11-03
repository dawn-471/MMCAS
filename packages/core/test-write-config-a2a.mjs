#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const ROOT = mkdtempSync(path.join(tmpdir(), 'mmcas-write-config-a2a-'));
const BASE = path.join(ROOT, 'base');
const HOME = path.join(ROOT, 'mmcas');
const DSH_HOME = path.join(HOME, 'dsh-home');
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

mkdirSync(path.join(BASE, 'pkg', 'plugins', 'dsh-panel-mmcas'), { recursive: true });
mkdirSync(path.join(BASE, 'pkg', 'core'), { recursive: true });
mkdirSync(path.join(BASE, 'config'), { recursive: true });
mkdirSync(path.join(BASE, 'workspace'), { recursive: true });
mkdirSync(DSH_HOME, { recursive: true });
copyFileSync(path.join(REPO, 'packages', 'coder', 'role.md'), path.join(BASE, 'pkg', 'core', 'role.md'));
copyFileSync(path.join(REPO, 'packages', 'core', 'standard-preset-021.yml'), path.join(BASE, 'pkg', 'core', 'standard-preset-021.yml'));
copyFileSync(path.join(REPO, 'packages', 'core', 'config', 'providers.example.yaml'), path.join(BASE, 'config', 'providers.example.yaml'));
writeFileSync(path.join(BASE, 'pkg', 'core', 'register-workspace.mjs'), 'process.exit(0);\n');

const r = spawnSync(process.execPath, [
  path.join(REPO, 'packages', 'core', 'write-config.mjs'),
  '--role', 'coder',
  '--base', BASE,
  '--dsh-home', DSH_HOME,
], {
  encoding: 'utf8',
  env: { ...process.env, MMCAS_HOME: HOME, MMCAS_A2A_PORT: '19401', MMCAS_FORCE_DESKTOP: '1' },
  timeout: 30000,
});

console.log('\n[WC1] write-config：web/desktop a2aPort');
if (r.status !== 0) console.log((r.stderr || r.stdout || '').trim());
{
  check('WC1 write-config exit0', r.status === 0, (r.stderr || r.stdout || '').trim().slice(0, 160));
  const web = path.join(DSH_HOME, 'profiles', 'web', 'cordis.patch.yml');
  const desktop = path.join(DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml');
  const webText = existsSync(web) ? readFileSync(web, 'utf8') : '';
  const desktopText = existsSync(desktop) ? readFileSync(desktop, 'utf8') : '';
  check('WC1 web patch 存在', existsSync(web));
  check('WC1 desktop patch 存在', existsSync(desktop));
  check('WC1 web patch 含 a2aPort=19401', /a2aPort:\s*19401/.test(webText));
  check('WC1 desktop patch 含 a2aPort=19401', /a2aPort:\s*19401/.test(desktopText));
  check('WC1 desktop panel port 仍为 19398', /port:\s*19398/.test(desktopText));
  check('WC1 web profile 含 mmcas-panel', /id:\s*mmcas-panel/.test(webText));
}

rmSync(ROOT, { recursive: true, force: true });
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) process.exit(1);
