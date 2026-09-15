#!/usr/bin/env bash
B="http://localhost:9377"
TABID="43ea6d30-f22e-47cb-9600-f1444a1a78c4"
T=$(cygpath -m "$(mktemp -d)")
echo "=== click .mmcas-trigger（带状态码） ==="
curl -s -m 15 -o "$T/click.json" -w "HTTP %{http_code}\n" -X POST "$B/tabs/$TABID/click" -H "Content-Type: application/json" -d '{"userId":"dev","selector":".mmcas-trigger"}'
cat "$T/click.json" 2>/dev/null | head -c 300
echo
sleep 2
echo "=== 快照找 mmcas ==="
curl -s -m 15 "$B/tabs/$TABID/snapshot?userId=dev" -o "$T/snap.json"
grep -c "mmcas" "$T/snap.json" || echo "0 处 mmcas"
grep -o "MMCAS[^\"]*" "$T/snap.json" | head -3
rm -rf "$T"
