#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 抓页面 → 提取含 mmcas 的 script URL → 验证其响应
T=$(cygpath -m "$(mktemp -d)")
TOKEN=$(grep -o 'token=[^ ]*' "$ROOT/logs/dsh-master.log" | tail -1)
URL="http://127.0.0.1:3199/?$TOKEN"
curl -s -c "$T/cj.txt" -m 8 -L "$URL" -o "$T/page.html" -w "首访: %{http_code}\n"
curl -s -b "$T/cj.txt" -m 8 "http://127.0.0.1:3199/" -o "$T/page.html" -w "主页: %{http_code}\n"
echo "=== 含 mmcas 的 script 引用 ==="
grep -oE '/plugins/[^"]*mmcas[^"]*' "$T/page.html" | head -3
# 提取第一个含 mmcas 的完整 URL（转义 &amp; → &）
SRC=$(grep -oE '/plugins/[^"]*mmcas[^"]*' "$T/page.html" | head -1 | sed 's/&amp;/\&/g')
echo "=== 请求该 script ==="
curl -s -b "$T/cj.txt" -m 10 "http://127.0.0.1:3199$SRC" -o "$T/client.js" -w "HTTP %{http_code} size=%{size_download}\n"
echo "=== 内容片段 ==="
head -c 200 "$T/client.js" 2>/dev/null
echo
grep -c "mmcas" "$T/client.js" 2>/dev/null || true
rm -rf "$T"
