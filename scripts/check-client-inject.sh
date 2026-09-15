#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 检查 dsh 页面 HTML 中 client 插件 script 注入清单
set -e
T=$(cygpath -m "$(mktemp -d)")
TOKEN=$(grep -o 'token=[^ ]*' "$ROOT/logs/dsh-master.log" | tail -1)
URL="http://127.0.0.1:3199/?$TOKEN"
curl -s -c "$T/cj.txt" -m 8 "$URL" -o /dev/null -w "首访: %{http_code}\n"
curl -s -b "$T/cj.txt" -m 8 "http://127.0.0.1:3199/" -o "$T/page.html" -w "页面: %{http_code} %{size_download}\n"
grep -oE '"/plugins/[^"]*"' "$T/page.html" | head -8
echo "mmcas 出现次数: $(grep -c mmcas "$T/page.html" || true)"
rm -rf "$T"
