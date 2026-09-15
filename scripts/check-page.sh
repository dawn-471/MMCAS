#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 抓 dsh 页面 HTML，检查 client 插件 script 注入
T=$(cygpath -m "$(mktemp -d)")
TOKEN=$(grep -o 'token=[^ ]*' "$ROOT/logs/dsh-master.log" | tail -1)
URL="http://127.0.0.1:3199/?$TOKEN"
echo "token: ${TOKEN:0:30}..."
curl -s -c "$T/cj.txt" -m 8 -L "$URL" -o "$T/page1.html" -w "首访: %{http_code} size=%{size_download}\n" || echo "首访失败"
curl -s -b "$T/cj.txt" -m 8 "http://127.0.0.1:3199/" -o "$T/page2.html" -w "主页: %{http_code} size=%{size_download}\n" || echo "主页失败"
echo "--- 页面中的 plugins 引用 ---"
grep -oE '"/plugins/[^"]*"' "$T/page2.html" 2>/dev/null | head -6
echo "--- mmcas 引用 ---"
grep -o 'mmcas[^"]*' "$T/page2.html" 2>/dev/null | head -4
echo "--- 页面开头 ---"
head -c 300 "$T/page2.html" 2>/dev/null
rm -rf "$T"
