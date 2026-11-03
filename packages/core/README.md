# pkg-core

MMCAS 共享核心，三个角色包共用。队友侧对其完全无感知。

## 组件

| 组件 | 状态 | 说明 |
|---|---|---|
| `sync/sync-daemon.mjs` | v0.2.1 | 工作区仓同步守护：自动 commit/push + 定时 pull；入库前体检（冲突标记/非法码点/乱码告警）；单实例锁含过期检测与接管；冲突跨重启保持 |
| `config/providers.example.yaml` | 规范 | 多 URL 多 key 的 API 来源配置（真实配置本地化，不入仓） |
| `config/sync.config.example.json` | 规范 | 同步守护配置示例 |
| `switch-provider.mjs` | v2 | provider/模型切换：写活动 profile 的 `cordis.patch.yml`（llm-deepseek / agent-default-model；保留已有键）+ credentials；legacy settings.yaml 只读/兼容同步；`--model` 指定模型 |
| `taskcard/taskcard.mjs` | v3 | 任务卡 CLI 护栏：三状态迁移 + 依赖门控 + WIP 可配（默认 0=不限）+ deps 编辑 + 删除防护（被依赖时拒绝，`--force` 可强制） |
| `panel/panel.mjs` | v1 | 旧本地渲染器（已退役，面板改为 dsh 内嵌插件 @mmcas/dsh-panel） |
| `memory/memory-embed.example.json` | v1.4 | 可选 embeddings 配置模板（`<MMCAS_HOME>/memory-embed.json`） |
| `memory/memory-log.mjs` + `memory-index.mjs` + `memory-search.mjs` | v1.4 | 记忆文件流 + 词匹配/哈希向量/混合/语义检索；可选 OpenAI 兼容 embeddings 与 sqlite-vec；本机索引缓存按文件变更自动重建 |
| `ssh/sshctl.mjs` | v1 | Master→Slave 控制：status / discover（从 device-info-*.md 自动填设备）/ shell / copy / pull |
| `write-config.mjs` | v2 | 队友机配置生成：sync.config.json + providers.yaml + 合并式 web/desktop profile（persona、preset-standard、面板、port=19398 桌面、a2aPort=19400）+ dsh workspace 注册 |
| `register-workspace.mjs` | v1 | 幂等注册 git 仓为 dsh workspace |
| `profile-patch.mjs` | v1 | dsh profile patch 合并工具：按 id 替换/追加、config 键/块更新、manifest 合并、链接修复 |
| `setup/` | v1 | setup.bat（9 步带失败汇总）+ start-agent/sync/panel/desktop.bat + enable-a2a.ps1（Tailscale 19400） |
| `a2a/a2a-protocol.mjs` + `a2a-discovery.mjs` + `a2a-server.mjs` + `a2a-client.mjs` + `a2a.mjs` | v1.5 | Agent 间实时直连：HTTP 19400、团队 token、幂等/TTL/限流、Tailscale peer 发现、notices 回落；CLI send/ping/status/peers/config |

## 记忆检索（v1.4）

```bash
node memory/memory-search.mjs --workspace <ws> "数值稳定性"
node memory/memory-search.mjs --workspace <ws> --mode semantic --json "蒙特卡洛"
node memory/memory-index.mjs --workspace <ws> --provider openai --backend sqlite
node memory/memory-search.mjs --workspace <ws> --stats --stale-days 30
```

- 默认 `hash`：离线、零依赖，索引缓存于 `<MMCAS_HOME>/memory-index/`。
- 语义：把 `memory/memory-embed.example.json` 复制为 `<MMCAS_HOME>/memory-embed.json`，把 `provider` 改为 `openai`，填写 `endpoint / model / apiKeyEnv`；key 放同名环境变量或 dsh `.credentials.yaml` 的 `refs`。
- sqlite-vec：`scripts/download-vendor.sh` 拉取 `vec0.dll`；缺失、DB 损坏或元数据不匹配时自动回退 JSON 向量。

## A2A（v1.5）

```bash
node a2a/a2a.mjs send modeler --body "请确认模型假设" --kind query
node a2a/a2a.mjs ping coder
node a2a/a2a.mjs status --json
node a2a/a2a.mjs peers
```

- 默认端口 19400，token 读取 `MMCAS_A2A_TOKEN` 或 `<MMCAS_HOME>/a2a-token.txt`；token 由 `pack.mjs` 生成、`setup.bat` 下发。
- 面板总控显示 A2A 状态并可直接发送；失败/离线自动写 `notices/`，不阻塞协作。
- 桌面端与 CLI 共用同一 token 与端口；面板数据端仍为 19398。

## 零依赖原则

- 同步守护 / 任务卡 / 切换器 / 记忆（含默认 hash 向量检索）/ A2A：Node >= 18，零 npm 依赖；语义 embeddings 与 sqlite-vec 为可选增强（缺失时自动回退）。
- 所有凭证从本地配置文件/环境变量读取；仓库内只有 `*.example` 占位。
