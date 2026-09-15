#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
B="http://localhost:9377"
sleep 14
TOKEN=$(grep -o 'token=[^ ]*' "$ROOT/logs/dsh-master.log" | tail -1)
T=$(cygpath -m "$(mktemp -d)")
TAB=$(curl -s -m 20 -X POST "$B/tabs" -H "Content-Type: application/json" -d "{\"userId\":\"dev8\",\"sessionKey\":\"f5\",\"url\":\"http://127.0.0.1:3199/?$TOKEN\"}")
TABID=$(echo "$TAB" | grep -o '"tabId":"[^"]*"' | head -1 | sed 's/.*"tabId":"//;s/"//')
echo "tabId=$TABID"
sleep 11
curl -s -m 15 "$B/tabs/$TABID/snapshot?userId=dev8" -o "$T/snap.json"
echo "=== 渲染自检 ==="
grep -o 'mmcas-diag[^"]*' "$T/snap.json" | head -5
echo "=== MMCAS 按钮 ==="
grep -o 'MMCAS[^"\\]*' "$T/snap.json" | head -4
rm -rf "$T"
