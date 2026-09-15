#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# v2 验证：三按钮 + 位置 + CRUD 端点
B="http://localhost:9377"
sleep 14
TOKEN=$(grep -o 'token=[^ ]*' "$ROOT/logs/dsh-master.log" | tail -1)
T=$(cygpath -m "$(mktemp -d)")
echo "=== API 端点自测 ==="
curl -s -m 5 "http://127.0.0.1:3210/api/tasks" | head -c 150; echo
echo "--- 创建任务 ---"
curl -s -m 5 -X POST "http://127.0.0.1:3210/api/tasks" -H "Content-Type: application/json" -d '{"title":"面板 CRUD 测试","owner":"writer","desc":"验证写端点"}'; echo
echo "--- 更新状态 todo->doing ---"
curl -s -m 5 -X PUT "http://127.0.0.1:3210/api/tasks" -H "Content-Type: application/json" -d '{"id":"T-003","status":"doing"}'; echo
echo "--- 非法迁移 doing->todo 再 done（应为 400 非法或成功）---"
curl -s -m 5 -X PUT "http://127.0.0.1:3210/api/tasks" -H "Content-Type: application/json" -d '{"id":"T-003","status":"done"}'; echo
echo "--- exec 端点（writer 未上线，应返回错误而非崩溃）---"
curl -s -m 40 -X POST "http://127.0.0.1:3210/api/exec" -H "Content-Type: application/json" -d '{"role":"writer","cmd":"python --version"}'; echo
echo "--- 删除任务 ---"
curl -s -m 5 -X DELETE "http://127.0.0.1:3210/api/tasks" -H "Content-Type: application/json" -d '{"id":"T-003"}'; echo

echo "=== 浏览器验证 ==="
TAB=$(curl -s -m 20 -X POST "$B/tabs" -H "Content-Type: application/json" -d "{\"userId\":\"dev9\",\"sessionKey\":\"v2\",\"url\":\"http://127.0.0.1:3199/?$TOKEN\"}")
TABID=$(echo "$TAB" | grep -o '"tabId":"[^"]*"' | head -1 | sed 's/.*"tabId":"//;s/"//')
echo "tabId=$TABID"
sleep 9
curl -s -m 15 "$B/tabs/$TABID/snapshot?userId=dev9" -o "$T/snap.json"
echo "--- MMCAS 按钮 ---"
grep -o 'button \\"MMCAS[^"]*' "$T/snap.json" | head -6
rm -rf "$T"
