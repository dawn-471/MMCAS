#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 验证：会话清空 + workspace 保留（AICode/MMCAS）+ 面板按钮
B="http://localhost:9377"
TOKEN=$(grep -o 'token=[^ ]*' "$ROOT/logs/dsh-master.log" | tail -1)
T=$(cygpath -m "$(mktemp -d)")
TAB=$(curl -s -m 20 -X POST "$B/tabs" -H "Content-Type: application/json" -d "{\"userId\":\"devfinal\",\"sessionKey\":\"f\",\"url\":\"http://127.0.0.1:3199/?$TOKEN\"}")
TABID=$(echo "$TAB" | grep -o '"tabId":"[^"]*"' | head -1 | sed 's/.*"tabId":"//;s/"//')
echo "tabId=$TABID"
sleep 9
curl -s -m 15 "$B/tabs/$TABID/snapshot?userId=devfinal" -o "$T/snap.json"
python -c "
import json
j=json.load(open(r'$T/snap.json',encoding='utf-8'))
snap=j.get('snapshot','')
lines=snap.split(chr(10))
for kw in ['treeitem','Ungrouped','MMCAS 总控','Settings','AICode']:
    hits=[l for l in lines if kw in l]
    print(kw, '->', len(hits), '处', (hits[0][:60] if hits else ''))
print('--- 会话树部分 ---')
started=False
for l in lines:
    if 'tree ' in l or 'treeitem' in l:
        print(l[:80])
"
rm -rf "$T"
