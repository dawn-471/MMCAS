#!/usr/bin/env bash
# MMCAS 包内容复查（v1.2，pack 后 / 收包后自检）
# 用法: bash audit-recheck.sh <package-root>
#   <package-root> = build/MMCAS-<role> 目录（含 pkg/ 的层级）或其解压后目录。
set -u
ROOT="${1:?用法: bash audit-recheck.sh <package-root>}"
pass=0; fail=0
check() {
  if [ -e "$ROOT/$1" ]; then pass=$((pass + 1)); echo "  PASS  $1${2:+  — $2}";
  else fail=$((fail + 1)); echo "  FAIL  $1${2:+  — $2}"; fi
}
echo "== MMCAS v1.5 包内容复查: $ROOT =="
# v1.5 新增
check "pkg/core/a2a/a2a-protocol.mjs" "A2A 协议"
check "pkg/core/a2a/a2a-discovery.mjs" "A2A peer 发现"
check "pkg/core/a2a/a2a-server.mjs" "A2A 服务端"
check "pkg/core/a2a/a2a-client.mjs" "A2A 客户端"
check "pkg/core/a2a/a2a.mjs" "A2A CLI"
check "pkg/core/a2a/test-a2a.mjs" "A2A 核心测试"
check "pkg/core/a2a/test-a2a-cli.mjs" "A2A CLI 测试"
check "pkg/core/enable-a2a.ps1" "A2A 防火墙规则"
check "pkg/secrets/a2a-token.txt" "A2A 团队 token"
check "pkg/plugins/dsh-panel-mmcas/lib/a2a-core.mjs" "面板 A2A 适配层"
check "pkg/plugins/dsh-panel-mmcas/test/test-a2a-api.mjs" "面板 A2A 测试"
# v1.4 新增
check "pkg/core/memory/memory-index.mjs" "记忆向量索引（本地缓存）"
check "pkg/core/memory/memory-search.mjs" "记忆检索（word/vector/hybrid/semantic）"
check "pkg/core/memory/memory-embed.mjs" "可选 embeddings 客户端"
check "pkg/core/memory/memory-vec-sqlite.mjs" "sqlite-vec 后端"
check "pkg/core/memory/memory-embed.example.json" "embeddings 配置模板"
check "pkg/core/memory/test-memory-search.mjs" "记忆检索测试"
check "pkg/core/memory/test-memory-semantic.mjs" "语义检索测试"
check "pkg/core/memory/test-memory-sqlite.mjs" "sqlite-vec 测试"
# v1.2 新增
check "pkg/core/audit/audit-run.mjs" "独立审计运行器"
check "pkg/core/audit/instructions/model.md" "审计提示词·数学模型"
check "pkg/core/audit/instructions/code.md" "审计提示词·代码成品"
check "pkg/core/audit/instructions/paper.md" "审计提示词·最终论文"
check "pkg/core/audit/test-audit.mjs" "审计单测"
check "pkg/core/notices/notice.mjs" "notices CLI"
check "pkg/core/notices/test-notice.mjs" "notices 单测"
# v1.2 修订
check "pkg/core/sync/sync-daemon.mjs" "同步守护（含心跳）"
check "pkg/core/sync/test-sync-daemon-detector.mjs" "同步检测器测试"
check "pkg/core/sync/test-sync-daemon-guard.ps1" "同步守卫测试"
check "pkg/core/taskcard/taskcard.mjs" "任务卡 CLI（打回/回程卡）"
check "pkg/core/taskcard/test-taskcard.mjs" "任务卡测试"
check "pkg/core/profile-patch.mjs" "profile patch 合并工具"
check "pkg/core/standard-preset-021.yml" "0.2.1 standard preset 模板"
check "pkg/core/switch-provider.mjs" "provider 切换器（T6.1 出厂默认）"
check "pkg/core/start-agent.bat" "启动器（daemon 确保 + 3080 检查）"
check "pkg/core/start-desktop.bat" "桌面端启动器（独立 DSH_HOME）"
check "pkg/core/codex-bridge/codex-bridge.mjs" "审计通道桥（health 加固）"
# 面板与基座
check "pkg/plugins/dsh-panel-mmcas/lib/index.js" "面板后端（审计室/心跳/桥健康/记忆搜索）"
check "pkg/plugins/dsh-panel-mmcas/lib/client.js" "面板前端（共享记忆搜索）"
check "pkg/plugins/dsh-panel-mmcas/lib/memory-api.mjs" "面板记忆检索适配层"
check "pkg/plugins/dsh-panel-mmcas/test/test-poller.mjs" "poller 测试套件"
check "pkg/plugins/dsh-panel-mmcas/test/test-memory-api.mjs" "面板记忆检索测试"
check "pkg/core/role.md" "角色人格文件"
check "setup.bat" "安装程序"
check "config/providers.example.yaml" "providers 模板"
if [ -e "$ROOT/pkg/core/memory/vec0.dll" ]; then
  pass=$((pass + 1)); echo "  PASS  pkg/core/memory/vec0.dll  — sqlite-vec 加速（可选）"
else
  echo "  WARN  pkg/core/memory/vec0.dll  — 未随包（JSON 向量回退可用）"
fi
echo "== 汇总: ${pass} passed, ${fail} failed =="
[ "$fail" -eq 0 ]
