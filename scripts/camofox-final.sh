#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 最终验证：新 token 页面，找 MMCAS 按钮与诊断
B="http://localhost:9377"
sleep 14
TOKEN=$(grep -o 'token=[^ ]*' "$ROOT/logs/dsh-master.log" | tail -1)
T=$(cygpath -m "$(mktemp -d)")
TAB=$(curl -s -m 20 -X POST "$B/tabs" -H "Content-Type: application/json" -d "{\"userId\":\"dev6\",\"sessionKey\":\"f3\",\"url\":\"http://127.0.0.1:3199/?$TOKEN\"}")
TABID=$(echo "$TAB" | grep -o '"tabId":"[^"]*"' | head -1 | sed 's/.*"tabId":"//;s/"//')
echo "tabId=$TABID"
sleep 9
curl -s -m 15 "$B/tabs/$TABID/snapshot?userId=dev6" -o "$T/snap.json"
echo "=== MMCAS 按钮 ==="
grep -o 'button \\"MMCAS[^"]*' "$T/snap.json" | head -3
echo "=== 诊断 ==="
grep -o 'mmcas-diag[^"]*' "$T/snap.json" | head -4
rm -rf "$T"
