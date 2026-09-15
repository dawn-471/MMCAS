#!/usr/bin/env bash
# 验证修复后的按钮与抽屉（tabId 已存在）
B="http://localhost:9377"
TABID="1fe33c8c-0442-4ff7-b360-17fdcda8b2bd"
T=$(cygpath -m "$(mktemp -d)")
sleep 6
curl -s -m 15 "$B/tabs/$TABID/snapshot?userId=dev5" -o "$T/snap.json"
echo "=== 快照尾部（footer 区）==="
tail -c 700 "$T/snap.json"
echo
echo "=== mmcas 关键词 ==="
grep -o 'mmcas[^"\\]*' "$T/snap.json" | head -5
rm -rf "$T"
