# pkg-core

MMCAS 共享核心，三个角色包共用。队友侧对其完全无感知。

## 组件

| 组件 | 状态 | 说明 |
|---|---|---|
| `sync/sync-daemon.mjs` | v0.2.1 | 工作区仓同步守护：自动 commit/push + 定时 pull；入库前体检（冲突标记/非法码点/乱码告警）；单实例锁含过期检测与接管；冲突跨重启保持 |
| `config/providers.example.yaml` | 规范 | 多 URL 多 key 的 API 来源配置（真实配置本地化，不入仓） |
| `config/sync.config.example.json` | 规范 | 同步守护配置示例 |
| `switch-provider.mjs` | v1 | provider/模型切换：写 dsh settings（baseURL/apiKeyEnv/reasoningEffort + catalog）+ credentials + agent-default-model；`--model` 指定模型 |
| `taskcard/taskcard.mjs` | v3 | 任务卡 CLI 护栏：三状态迁移 + 依赖门控 + WIP≤2 + deps 编辑 + 删除防护（被依赖时拒绝，`--force` 可强制） |
| `panel/panel.mjs` | v1 | 旧本地渲染器（已退役，面板改为 dsh 内嵌插件 @mmcas/dsh-panel） |
| `memory/memory-log.mjs` + `memory-search.mjs` | v1 | 记忆文件流 + 词匹配检索（向量检索后置槽位） |
| `ssh/sshctl.mjs` | v1 | Master→Slave 控制：status / discover（从 device-info-*.md 自动填设备）/ shell / copy / pull |
| `write-config.mjs` | v1 | 队友机配置生成：sync.config.json + providers.yaml + persona（{WORKSPACE}/{CORE} 占位符替换）+ dsh workspace 注册 + 面板挂载 |
| `register-workspace.mjs` | v1 | 幂等注册 git 仓为 dsh workspace |
| `setup/` | v1 | setup.bat（9 步带失败汇总）+ start-agent/sync/panel.bat |
| A2A 插件 | 后置 | v1 协同走 git 文件通道；A2A 自研后置（dsh 生态无现成插件） |

## 零依赖原则

- 同步守护 / 任务卡 / 切换器 / 记忆：Node >= 18，零 npm 依赖。
- 所有凭证从本地配置文件/环境变量读取；仓库内只有 `*.example` 占位。
