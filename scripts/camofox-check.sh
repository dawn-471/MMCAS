#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 用 Camofox HTTP API 打开 dsh 页面并检查 MMCAS 按钮
B="http://localhost:9377"
TOKEN=$(grep -o 'token=[^ ]*' "$ROOT/logs/dsh-master.log" | tail -1)
URL="http://127.0.0.1:3199/?$TOKEN"
# 创建标签
TAB=$(curl -s -m 15 -X POST "$B/tabs" -H "Content-Type: application/json" -d "{\"userId\":\"dev\",\"sessionKey\":\"mmcas-check\",\"url\":\"$URL\"}")
echo "创建: $TAB"
TABID=$(echo "$TAB" | grep -o '"tabId":"[^"]*"' | head -1 | sed 's/.*"tabId":"//;s/"//')
echo "tabId=$TABID"
sleep 8
# 快照
SNAP=$(curl -s -m 15 "$B/tabs/$TABID/snapshot?userId=dev")
echo "=== 快照（前 2000 字符）==="
echo "$SNAP" | head -c 2000
echo
echo "=== 含 mmcas 的节点 ==="
echo "$SNAP" | grep -io "mmcas[^]]*" | head -5
