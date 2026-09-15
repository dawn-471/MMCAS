#!/usr/bin/env bash
# MMCAS sync-daemon 活体验证：临时裸仓 + 双工作副本
# 用法: bash test-live.sh
set -e
SCRIPT_DIR=$(cygpath -w "$(cd "$(dirname "$0")" && pwd)")
DAEMON="$SCRIPT_DIR/sync-daemon.mjs"

TMP=$(mktemp -d)
T=$(cygpath -m "$TMP")
trap 'echo "=== daemon.log（诊断） ==="; cat "$T/daemon.log" 2>/dev/null; rm -rf "$TMP"' EXIT

git init --bare -b main "$T/repo.git"
git clone -q "$T/repo.git" "$T/node-a"
git clone -q "$T/repo.git" "$T/node-b"

echo "hello from a" > "$T/node-a/file.txt"
cat > "$T/sync.config.json" <<EOF
{"repoDir": "$T/node-a", "pullIntervalSec": 5, "logDir": "$T/logs", "authorName": "test-a", "authorEmail": "a@test.local", "remote": "origin", "branch": "main"}
EOF

node "$DAEMON" --config "$T/sync.config.json" > "$T/daemon.log" 2>&1 &
DPID=$!

sleep 8
echo "=== 测试1: node-a 自动 commit+push, node-b pull ==="
( cd "$TMP/node-b" && git pull -q && cat file.txt )

echo "hello from b" > "$TMP/node-b/b-file.txt"
( cd "$TMP/node-b" && git add b-file.txt && git -c user.name=b -c user.email=b@test.local commit -qm "b push" && git push -q )

echo "=== 测试2: node-b push 后, daemon 应自动 pull 到 node-a ==="
sleep 10
kill "$DPID" 2>/dev/null || true
cat "$TMP/node-a/b-file.txt" && echo "--- PULL OK ---"

echo "=== daemon 日志尾部 ==="
tail -5 "$T/daemon.log"
