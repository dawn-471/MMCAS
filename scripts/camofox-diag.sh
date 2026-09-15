#!/usr/bin/env bash
B="http://localhost:9377"
TABID="452e1bd5-35b9-492f-8b82-bdd221e434d6"
sleep 8
T=$(cygpath -m "$(mktemp -d)")
curl -s -m 15 "$B/tabs/$TABID/snapshot?userId=dev3" -o "$T/snap.json"
echo "=== 诊断文本 ==="
grep -o 'mmcas-diag[^"]*' "$T/snap.json" | head -5
echo "=== MMCAS 按钮 ==="
grep -o 'MMCAS[^"]*' "$T/snap.json" | head -4
rm -rf "$T"
