#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 双实例并排验证：Master 三按钮 / Slave 两按钮
B="http://localhost:9377"
MTOKEN=$(grep -o 'token=[^ ]*' "$ROOT/logs/dsh-master.log" | tail -1)
STOKEN=$(grep -o 'token=[^ ]*' "$ROOT/logs/dsh-slave-demo.log" | tail -1)
T=$(cygpath -m "$(mktemp -d)")
TAB=$(curl -s -m 20 -X POST "$B/tabs" -H "Content-Type: application/json" -d "{\"userId\":\"devboth\",\"sessionKey\":\"m\",\"url\":\"http://127.0.0.1:3199/?$MTOKEN\"}")
MTAB=$(echo "$TAB" | grep -o '"tabId":"[^"]*"' | head -1 | sed 's/.*"tabId":"//;s/"//')
sleep 9
curl -s -m 15 "$B/tabs/$MTAB/snapshot?userId=devboth" -o "$T/m.json"
python -c "
import json
j=json.load(open(r'$T/m.json',encoding='utf-8'))
s=j.get('snapshot','')
print('Master:', {k: sum(1 for l in s.split(chr(10)) if k in l) for k in ['MMCAS 总控','MMCAS 任务看板','MMCAS 共享记忆']})
"
TAB2=$(curl -s -m 20 -X POST "$B/tabs" -H "Content-Type: application/json" -d "{\"userId\":\"devboth2\",\"sessionKey\":\"s\",\"url\":\"http://127.0.0.1:3200/?$STOKEN\"}")
STAB=$(echo "$TAB2" | grep -o '"tabId":"[^"]*"' | head -1 | sed 's/.*"tabId":"//;s/"//')
sleep 9
curl -s -m 15 "$B/tabs/$STAB/snapshot?userId=devboth2" -o "$T/s.json"
python -c "
import json
j=json.load(open(r'$T/s.json',encoding='utf-8'))
s=j.get('snapshot','')
print('Slave: ', {k: sum(1 for l in s.split(chr(10)) if k in l) for k in ['MMCAS 总控','MMCAS 任务看板','MMCAS 共享记忆']})
"
rm -rf "$T"
