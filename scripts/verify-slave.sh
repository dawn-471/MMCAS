#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Slave 视角：仅看板+记忆两按钮，无总控
B="http://localhost:9377"
TOKEN=$(grep -o 'token=[^ ]*' "$ROOT/logs/dsh-slave-test.log" | tail -1)
echo "=== role ==="
curl -s -m 5 "http://127.0.0.1:3210/api/state" | python -c "import json,sys; j=json.load(sys.stdin); print('role =', j.get('role'))"
echo "=== exec 端点拒绝非 Master ==="
curl -s -m 5 -X POST "http://127.0.0.1:3210/api/exec" -H "Content-Type: application/json" -d '{"role":"coder","cmd":"python --version"}'
echo
T=$(cygpath -m "$(mktemp -d)")
TAB=$(curl -s -m 20 -X POST "$B/tabs" -H "Content-Type: application/json" -d "{\"userId\":\"devslave\",\"sessionKey\":\"s\",\"url\":\"http://127.0.0.1:3199/?$TOKEN\"}")
TABID=$(echo "$TAB" | grep -o '"tabId":"[^"]*"' | head -1 | sed 's/.*"tabId":"//;s/"//')
echo "tabId=$TABID"
sleep 10
curl -s -m 15 "$B/tabs/$TABID/snapshot?userId=devslave" -o "$T/snap.json"
python -c "
import json
j=json.load(open(r'$T/snap.json',encoding='utf-8'))
snap=j.get('snapshot','')
for kw in ['MMCAS 总控','MMCAS 任务看板','MMCAS 共享记忆']:
    n=sum(1 for l in snap.split(chr(10)) if kw in l)
    print(kw, '->', n)
"
rm -rf "$T"
