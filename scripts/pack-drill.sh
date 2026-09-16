#!/usr/bin/env bash
# T6.4 装包演练（隔离模式）：解压发布包 → 包内组件自检 + write-config/switch/audit 隔离生成 + 断言。
# 全程不触碰本机 MMCAS 运行时（所有产物落 build/_drill-<role>/）。
# 用法: bash scripts/pack-drill.sh [role]（默认 modeler）
ROLE="${1:-modeler}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_W="$(cygpath -m "$ROOT" 2>/dev/null || echo "$ROOT")"
ZIP="$ROOT_W/build/MMCAS-$ROLE.zip"
PKR="$ROOT_W/build/_drill-$ROLE"
PK="$PKR/pkgroot"
DSH="$PKR/dsh-home"

echo "== [1/6] 解压发布包 ($ZIP) =="
rm -rf "$PKR"; mkdir -p "$PKR"
powershell -NoProfile -Command "Expand-Archive -Force '$ZIP' '$PK'" >/dev/null || { echo "解压失败"; exit 1; }
ls "$PK" | head -8

echo "== [2/6] 包内容复查 =="
bash "$PK/MMCAS-audit-recheck.sh" "$PK" | tail -2 || { echo "内容复查失败"; exit 1; }

echo "== [3/6] 包内回归测试套件 =="
cd "$PK" || exit 1
for t in "pkg/plugins/dsh-panel-mmcas/test/test-poller.mjs" "pkg/core/taskcard/test-taskcard.mjs" "pkg/core/notices/test-notice.mjs" "pkg/core/audit/test-audit.mjs" "pkg/core/sync/test-sync-daemon-detector.mjs"; do
  line=$(node "$t" 2>&1 | tail -1)
  echo "  $t → $line"
done

echo "== [4/6] write-config 隔离生成（临时 base + dsh-home） =="
node "$PK/pkg/core/write-config.mjs" --role "$ROLE" --base "$PK" --dsh-home "$DSH" || { echo "write-config 失败"; exit 1; }
test -f "$PK/config/sync.config.json" && echo "  OK sync.config.json"
test -f "$PK/config/providers.yaml" && echo "  OK providers.yaml"
test -f "$DSH/profiles/web/cordis.patch.yml" && echo "  OK dsh web profile patch"
test -d "$DSH/skills" && echo "  OK skills 目录"
test -f "$DSH/profiles/mmcas-$ROLE/cordis.patch.yml" && echo "  OK 角色 profile patch" || ls "$DSH/profiles/" 2>/dev/null

echo "== [5/6] switch-provider 隔离演练（dry-run） =="
node "$PK/pkg/core/switch-provider.mjs" switch deepseek --config "$PK/config/providers.yaml" --settings "$DSH/settings.yaml" --credentials "$DSH/.credentials.yaml" --role "$ROLE" --dry-run 2>&1 | head -14

echo "== [6/6] audit dry-run =="
mkdir -p "$PKR/ws/workspace/modeling"
echo "# 演练材料" > "$PKR/ws/workspace/modeling/m1.md"
node "$PK/pkg/core/audit/audit-run.mjs" --dimension model --workspace "$PKR/ws" --dry-run 2>&1 | tail -1

echo ""
echo "== 演练完成（隔离目录: $PKR） =="
