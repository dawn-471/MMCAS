# 凭证暴露面登记（模板）

> 原则：**仓库内永无真实凭证**。本文件登记一次 MMCAS 部署涉及的所有凭证渠道、性质与退役/公开处理方式；新增任何凭证渠道前必须先在此登记。
> 开源版本仅保留本模板：部署方请复制本文件为本地登记表（可按需不入公开仓），逐条填写实际位置。

| # | 凭证类型 | 存放位置（示例） | 是否入仓 | 性质 | 退役 / 公开处理 |
|---|---|---|---|---|---|
| 1 | 模型 API key（多 provider） | 部署机 `providers.yaml`（.gitignore）+ dsh 侧 settings/credentials | 否 | 每成员一把，可单独吊销 | 仓库只保留 `providers.example.yaml` 占位，用户自填 |
| 2 | 仓库访问凭据（细粒度 PAT / deploy key） | 成员机 git 配置 / 环境变量 | 否 | 每成员一把、限单仓、可吊销 | 成员退出即吊销；开源版使用部署者的仓库凭据 |
| 3 | 组网预授权 key（Tailscale auth key） | 安装脚本参数 / 环境变量 | 否 | 部署者生成，带过期时间与 tag | 按策略过期/吊销；由 tailnet 管理员自建 |
| 4 | SSH 私钥（Master → 成员远程控制） | 部署机 `~/.ssh/`，安装期生成 | 否 | 公钥分发，私钥不离开 Master | 成员退役后清理成员机 `authorized_keys` |
| 5 | 网盘 / 共享盘凭证 | 由对应工具独立管理（OAuth 等） | 否 | 与 MMCAS 代码无关 | 按各服务自身流程吊销 |
| 6 | 语义检索 embeddings API key（可选） | `<MMCAS_HOME>/memory-embed.json` 的 `apiKeyEnv` 指向的环境变量，或 dsh `.credentials.yaml` 的 `refs` | 否 | 可复用现有 provider key，也可独立一把；默认 `provider=hash` 时不需要 | 不启用语义检索即无需；吊销/缺失时自动回退 hybrid |
| 7 | A2A 团队 token（v1.5） | 包内 `pkg/secrets/a2a-token.txt` → 成员机 `<MMCAS_HOME>/a2a-token.txt`；或环境变量 `MMCAS_A2A_TOKEN` | 否 | 团队共享一把，由 `pack.mjs` 生成；只用于 A2A 消息鉴权 | 轮换后重打包/重跑 setup；缺失时 A2A 关闭，notices 仍可用 |
| 8 | 专家角色 API key（Guide / Reviewer，v1.6） | `<MMCAS_HOME>/guide.json` / `reviewer.json` 的 `apiKeyEnv` 指向的环境变量，或 dsh `.credentials.yaml` 的 `refs` | 否 | 可复用现有 provider key，也可各配一把；Guide 建议用更强专家模型 | 不启用对应角色即无需；吊销/缺失时明确报错，不静默 |

## 凭证生命周期纪律

1. **项目结束**：吊销全部仓库 deploy key、组网 auth key、成员 API key。
2. **成员退出**：单独吊销其全部凭证，不影响他人。
3. **泄露处置**：立即吊销并轮换；随后全量扫描仓库历史（`git log -S` 或 `git grep $(git rev-list --all)`）确认未被污染。
4. **发布纪律**：公开发布前逐条过一遍本表——凡标注"入仓"的条目必须完成脱敏或移除后方可发布。
