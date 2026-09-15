#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 验证 dsh workspace 注册：UI 里应有 AICode + MMCAS
B="http://localhost:9377"
sleep 14
TOKEN=$(grep -o 'token=[^ ]*' "$ROOT/logs/dsh-master.log" | tail -1)
T=$(cygpath -m "$(mktemp -d)")
TAB=$(curl -s -m 20 -X POST "$B/tabs" -H "Content-Type: application/json" -d "{\"userId\":\"devws\",\"sessionKey\":\"ws\",\"url\":\"http://127.0.0.1:3199/?$TOKEN\"}")
TABID=$(echo "$TAB" | grep -o '"tabId":"[^"]*"' | head -1 | sed 's/.*"tabId":"//;s/"//')
echo "tabId=$TABID"
sleep 9
curl -s -m 15 "$B/tabs/$TABID/snapshot?userId=devws" -o "$T/snap.json"
python -c "
import json
j=json.load(open(r'$T/snap.json',encoding='utf-8'))
snap=j.get('snapshot','')
for kw in ['AICode','MMCAS','New Workspace','Add workspace','会话','New session']:
    hits=[l for l in snap.split(chr(10)) if kw in l]
    if hits: print('FOUND:', kw, '|', hits[0][:70])
print('总行数:', len(snap.split(chr(10))))
"
rm -rf "$T"
