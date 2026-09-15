#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 角色感知验证：Master 三按钮；Slave 视角（临时改 role 后）两按钮
B="http://localhost:9377"
TOKEN=$(grep -o 'token=[^ ]*' "$ROOT/logs/dsh-master.log" | tail -1)
echo "=== /api/state role 字段 ==="
curl -s -m 5 "http://127.0.0.1:3210/api/state" | python -c "import json,sys; j=json.load(sys.stdin); print('role =', j.get('role'))"
T=$(cygpath -m "$(mktemp -d)")
TAB=$(curl -s -m 20 -X POST "$B/tabs" -H "Content-Type: application/json" -d "{\"userId\":\"devrole\",\"sessionKey\":\"r\",\"url\":\"http://127.0.0.1:3199/?$TOKEN\"}")
TABID=$(echo "$TAB" | grep -o '"tabId":"[^"]*"' | head -1 | sed 's/.*"tabId":"//;s/"//')
echo "tabId=$TABID"
sleep 10
curl -s -m 15 "$B/tabs/$TABID/snapshot?userId=devrole" -o "$T/snap.json"
python -c "
import json
j=json.load(open(r'$T/snap.json',encoding='utf-8'))
snap=j.get('snapshot','')
for kw in ['MMCAS 总控','MMCAS 任务看板','MMCAS 共享记忆']:
    n=sum(1 for l in snap.split(chr(10)) if kw in l)
    print(kw, '->', n)
"
rm -rf "$T"
