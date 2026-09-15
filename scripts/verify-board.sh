#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 看板 UI 验证：过滤按钮 + priority 徽标 + 等待依赖标记
B="http://localhost:9377"
TOKEN=$(grep -o 'token=[^ ]*' "$ROOT/logs/dsh-master.log" | tail -1)
T=$(cygpath -m "$(mktemp -d)")
TAB=$(curl -s -m 20 -X POST "$B/tabs" -H "Content-Type: application/json" -d "{\"userId\":\"devboard\",\"sessionKey\":\"b\",\"url\":\"http://127.0.0.1:3199/?$TOKEN\"}")
TABID=$(echo "$TAB" | grep -o '"tabId":"[^"]*"' | head -1 | sed 's/.*"tabId":"//;s/"//')
sleep 9
curl -s -m 15 -X POST "$B/tabs/$TABID/evaluate" -H "Content-Type: application/json" -d '{"userId":"devboard","expression":"document.querySelectorAll(\"button\")[5].click(); \"ok\""}' >/dev/null
sleep 3
curl -s -m 15 "$B/tabs/$TABID/snapshot?userId=devboard" -o "$T/snap.json"
python -c "
import json
j=json.load(open(r'$T/snap.json',encoding='utf-8'))
snap=j.get('snapshot','')
for kw in ['任务看板','全部','我的任务','新建任务','待办','进行中','完成']:
    n=sum(1 for l in snap.split(chr(10)) if kw in l)
    print(kw, '->', n)
"
rm -rf "$T"
