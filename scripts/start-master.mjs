#!/usr/bin/env node
/**
 * MMCAS start-master —— 建模手 dsh web 打开器（v5 最终形态）
 * 前置: dsh 已由 start-master.bat 启动（输出重定向到 logs/dsh-master.log）
 * 本脚本: 轮询日志抓取带 token 的 URL → 直接打开浏览器
 * 注意: v1 旧版还生成 panel.html 指挥中心单页（已作废，面板 = dsh 内嵌插件 @mmcas/dsh-panel）
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const LOG = path.join(ROOT, 'logs', 'dsh-master.log');

function openBrowser(dshUrl) {
  execSync(`start "" "${dshUrl}"`, { stdio: 'ignore', shell: 'cmd.exe' });
  console.log('[mmcas] 已在浏览器打开:', dshUrl);
}

function poll() {
  if (!existsSync(LOG)) return false;
  const txt = readFileSync(LOG, 'utf8');
  const m = txt.match(/dsh web: (http:\/\/127\.0\.0\.1:3199\/\?token=\S+)/);
  if (m) { openBrowser(m[1]); return true; }
  if (/error|Error|EADDRINUSE/i.test(txt.slice(0, 4000))) {
    console.error('[mmcas] dsh 启动失败，查看 logs/dsh-master.log');
    return true; // 停止轮询
  }
  return false;
}

if (poll()) process.exit(0);
const timer = setInterval(() => { if (poll()) { clearInterval(timer); process.exit(0); } }, 2000);
setTimeout(() => { console.error('[mmcas] 等待 dsh 就绪超时（60s），查看 logs/dsh-master.log'); process.exit(1); }, 60000);
