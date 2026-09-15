#!/usr/bin/env bash
# 下载 MMCAS 三包离线组件到 vendor/（本机构建缓存，不入仓）
# 用法: bash scripts/download-vendor.sh
set -euo pipefail
cd "$(dirname "$0")/.."
V=vendor
mkdir -p "$V"

echo "[1/3] 探测 Node v22 LTS 最新版本（npmmirror）..."
NODE_VERSION=$(curl -sL https://npmmirror.com/mirrors/node/index.json | grep -o '"version":"v22\.[0-9.]*"' | head -1 | grep -o 'v22\.[0-9.]*')
echo "  -> ${NODE_VERSION}"
curl -L --fail -o "$V/node.zip" "https://npmmirror.com/mirrors/node/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip" &

echo "[2/3] 探测 PortableGit 最新版本（GitHub API，镜像下载）..."
PG_INFO=$(curl -sL -m 15 "https://api.github.com/repos/git-for-windows/git/releases/latest")
PG_TAG=$(echo "$PG_INFO" | grep -o '"tag_name": "[^"]*"' | head -1 | sed 's/.*"tag_name": "//; s/"$//')
PG_FILE=$(echo "$PG_INFO" | grep -o 'PortableGit-[0-9.]*-64-bit.7z.exe' | head -1)
echo "  -> ${PG_TAG} / ${PG_FILE}"
if [ -z "$PG_FILE" ]; then echo "  !! PortableGit 探测失败"; exit 1; fi
curl -L --fail -m 600 -o "$V/portablegit.exe" "https://npmmirror.com/mirrors/git-for-windows/${PG_TAG}/${PG_FILE}" &

echo "[3/4] Tailscale MSI 1.102.3（官方源，已实测 200 OK）..."
curl -L --fail -m 600 -o "$V/tailscale.msi" "https://pkgs.tailscale.com/stable/tailscale-setup-1.102.3-amd64.msi" &

echo "[4/4] uv（Windows 单文件，环境同步用；GitHub 直链，需代理时自动读 HTTPS_PROXY）..."
curl -L --fail -m 600 -o "$V/uv.zip" "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip" &

wait
echo "=== 下载完成 ==="
ls -la "$V"
