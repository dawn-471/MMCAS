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
echo "== MMCAS v1.2 包内容复查: $ROOT =="
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
check "pkg/core/switch-provider.mjs" "provider 切换器（T6.1 出厂默认）"
check "pkg/core/start-agent.bat" "启动器（daemon 确保 + 3080 检查）"
check "pkg/core/codex-bridge/codex-bridge.mjs" "审计通道桥（health 加固）"
# 面板与基座
check "pkg/plugins/dsh-panel-mmcas/lib/index.js" "面板后端（审计室/心跳/桥健康）"
check "pkg/plugins/dsh-panel-mmcas/lib/client.js" "面板前端"
check "pkg/plugins/dsh-panel-mmcas/test/test-poller.mjs" "poller 测试套件"
check "pkg/core/role.md" "角色人格文件"
check "setup.bat" "安装程序"
check "config/providers.example.yaml" "providers 模板"
echo "== 汇总: ${pass} passed, ${fail} failed =="
[ "$fail" -eq 0 ]
