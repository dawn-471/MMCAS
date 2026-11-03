# Roadmap

> 本文件与 GitHub 的 [Milestones](https://github.com/dawn-471/MMCAS/milestones) / Issues 同步维护。
> 当前版本：**v1.3.0（dsh 0.2.1 适配版，2026-10-29 / tag `v1.3.0`）**　开发线：**v1.4（功能完成，待发布）→ v1.5（进行中，A2A MVP 已落地）**

## v1.3 · dsh 0.2.1 适配（已发布，2026-10-29 / tag `v1.3.0`）

- [x] **CLI + 桌面端统一适配 dsh 0.2.1-rc.3**：profile / preset / 会话注入链路回归
- [x] **profile 合并式配置**：`write-config` / `switch-provider` / `install-bridge` 按条合并 `cordis.patch.yml`，保留 dsh 设置、已装插件与自定义 panel 端口
- [x] **桌面端接入**：`MMCAS-Desktop` 启动器、独立 `DSH_HOME`、`profiles/desktop` 自动生成、面板固定 19398
- [x] **standard preset 0.2.1 同步**：加入 `time-context` / `tool-schedule`，移除 `backgroundMode` / `tool-ralph` / 旧 subagent 行
- [x] **Reviewer 配置迁移**：审阅室改用 MMCAS 自有 `reviewer.json`；旧 `settings.yaml` / `.imported` 只读兼容
- [x] **稳定性修复**：冷会话 `prompt` signal、目标会话活跃度、审计报告唯一文件名、credentials `refs` 安全写入、New Session 本地化匹配
- [x] **回归**：poller 47、audit 16、profile-patch 16、switch-provider 全部通过；notices / taskcard / sync 回归通过

## v1.4 · 向量化记忆检索（功能完成，2026-11-02）

- [x] **零依赖向量索引**：中文 bigram + 英文/数字词元 TF-IDF，倒排表 + 余弦相似度；索引缓存于 `MMCAS_HOME/memory-index`，属本机派生数据、不随 git 同步
- [x] **检索模式**：`memory-search --mode word|vector|hybrid|semantic`，默认 hybrid；保留原词匹配模式并作为无索引降级路径
- [x] **索引生命周期**：按 memory 文件 mtime/size 自动重建；文件删除同步移除；UTF-8 BOM 兼容；原子写缓存
- [x] **筛选与输出**：角色 / `--since` / `--until` / `--limit` / `--json` / `--stats`
- [x] **语义嵌入后端**：OpenAI 兼容 `/embeddings`（`memory-embed.json` + `apiKeyEnv`）；批处理、超时、归一化、模型/维度校验；失败自动回退 hybrid
- [x] **sqlite-vec 后端**：`memory-index --backend sqlite` 建 `vec0`（role/date 元数据过滤、KNN、索引元数据校验）；无扩展/`node:sqlite` 时回退 JSON 向量；`download-vendor.sh` 拉取 Windows 扩展并随包
- [x] **面板共享记忆搜索**：共享记忆抽屉搜索框 + 模式/角色筛选 + 分数/回退提示；`GET /api/memory/search` 兼容开发仓与打包布局
- [x] **记忆维护（提示）**：`--stats --stale-days N` 输出过期条数与最早日期（非破坏性）
- [x] **回归**：87 项记忆相关单测（基础 28 / 语义 26 / sqlite-vec 17 / 面板 16），覆盖 mock embeddings、批量、鉴权、回退、KNN、元数据过滤、BOM、缓存
- [ ] **记忆归档工具**：按角色/日期归档旧文件（可选，延后到 v1.5）

## v1.5 · A2A 直连通道（进行中，2026-11-03）

> 主线：Agent 间实时直连（A2A），补足 git / notices 文件通道的时延；并行：面板 WebTTY、角色技能与审计维度；可选：记忆归档。原则不变：零注册、Tailscale 组网、凭证不入仓、人类在环。

### M0 · 设计冻结（约 1 周）

- [x] **A2A 协议 v1**：envelope `{v, id, from, to, kind, urgency, scope, body, at, replyTo, ttl}`；类型 `ping / query / reply / task-handoff / stop / error / ruling / info`；幂等键、TTL、错误码、消息大小上限（64KB）、非法 from/to/kind 校验
- [x] **传输选型**：Tailscale 100.x 直连 + HTTP（WS 留作后续）；端口默认 19400（与 web 面板 3210 / 桌面面板 19398 分离）；peer 发现（Tailscale status / 配置覆盖）
- [x] **鉴权边界**：Tailscale ACL + 应用层团队 token 双保险；拒绝未知 peer/错误 from；日志不打印 token；每角色独立 token 轮换列入 M2
- [x] **降级契约**：A2A 超时/离线/投递失败 ⇒ 自动回落 `notices/` 文件通道（沿用现有语义、去重与回执）
- [x] **入口草图**：`a2a.mjs` CLI（send/ping/status/peers/config）+ 面板总控 A2A 状态与发送；测试矩阵与验收清单

### M1 · A2A MVP（约 2 周）

- [x] **服务端**：`packages/core/a2a/a2a-server.mjs`（监听、Bearer 鉴权、幂等去重、TTL、速率限制、状态落盘、IP→role 校验）
- [x] **客户端**：`packages/core/a2a/a2a-client.mjs`（send/broadcast/ping/status；超时、重试、失败分类）
- [x] **会话注入**：query/task-handoff/stop 按 urgency 走 followup/steer，复用 poller 注入与 scope→会话解析
- [x] **notices 降级**：不可达/503 自动写 notices（保留 kind/urgency/scope）；面板与 CLI 均显式提示回落
- [x] **面板 + CLI**：在线 peer / 收发/失败/回落计数；消息收发入口；桌面端沿用同一面板宿主与端口
- [x] **测试**：44 项 A2A 测试（核心 18 / 面板适配 10 / 面板集成 9 / CLI 7），覆盖 ping/query/幂等/超时/限流/非法输入/降级

### M2 · A2A 加固（约 1–2 周）

- [ ] **鉴权轮换与最小权限**：每角色独立 token、轮换/吊销（当前为团队共享 token）
- [x] **稳定性（基础）**：幂等、TTL、速率限制、状态落盘、Broken peer 自动回落
- [ ] **稳定性（补强）**：重连/心跳、背压、消息分片、离线队列上限
- [x] **可观测**：面板显示 peer 在线数、收/发/失败/回落计数与最近错误；日志不打印 token
- [x] **打包安装**：`pack.mjs` 生成/注入团队 token，`setup.bat` 复制 token + 防火墙规则，`write-config` 写 `a2aPort`（web/desktop 均生效），`audit-recheck.sh` 校验
- [ ] **实机演练**：三端 Tailscale 下 A2A ⇄ notices 故障切换；断网/重启/重复投递；Slave→Master 19400 ACL 放行

### M3 · 并行项（可与 M1/M2 并行）

- [ ] **面板 WebTTY**：先做 Windows PTY 技术 spike（`node-pty` 预编译或内置 pipes 半交互），再落地 Master 交互终端 + 命令审计 + 权限门；不可行时降级并在面板明示
- [ ] **角色技能**：新增 2–3 个 skill（如敏感性分析、图表-数字溯源、复现清单），每项含模板、示例与验收
- [ ] **审计维度**：新增 1–2 个维度（如假设检验、证据链、数值稳定性），扩 instructions 与面板选项
- [ ] **记忆归档（可选）**：`memory-archive.mjs --before <date> --dry-run/--apply`，旧日文件移入 `archive/`；搜索默认排除、`--include-archive` 可选

### v1.5 验收标准

- [x] **A2A（本地）**：loopback 双实例 ping/query/幂等/限流/错误 token 拒绝/降级全通过
- [ ] **A2A（实机）**：同 tailnet 两端 ping/query < 2s；Slave→Master 19400 ACL 放行；三端演练
- [x] **面板**：通道状态可见、消息可发可收；离线/降级显式提示（含桌面端）
- [ ] **WebTTY**：Master 可在面板执行交互式命令，命令审计落盘；Slave 不可入站
- [ ] **技能/审计**：新增内容有模板、示例与测试；旧包兼容
- [x] **回归（本地）**：A2A + notices + poller + memory + audit 全绿
- [ ] **回归（发行）**：三端重打包与实机演练通过
- [x] **文档**：design §17 / ROADMAP / secrets-registry / README / core README 同步

### 风险与约束

- dsh 预览期 API 变动：A2A 走独立模块 + 本地 HTTP，减少对 dsh 内部接口的耦合；消息注入复用面板宿主
- Windows PTY 需原生依赖；失败则降级为半交互 WebTTY，不阻塞主线
- Tailscale ACL / 端口策略需部署者配合：需放行 Slave→Master TCP 19400（仅 A2A 消息，非远程控制）；零注册原则不变
- 消息风暴/重放：幂等键 + TTL + 速率限制 + token；当前 token 为团队共享，轮换/吊销列入 M2
- 桌面端：A2A 运行在面板宿主内，使用同一 token 文件与 19400 端口，与面板数据端 19398 分离
- **不在 v1.5 范围**：跨 tailnet 联邦、公网中继、完整 RBAC、独立中心服务

## v1.2 · 实战修订（已完成，2026-09-16 发布）

- [x] **调度核心**：面板合并（自动接取轮询器 + 看板 30s git 同步）、修复重复/过期派发、去掉 WIP 硬限制（依赖门控为准）、补齐轮询器回归测试
- [x] **会话与上下文**：启用 dsh 内置压缩（compaction）三件套；新任务自动开新会话接取、打回回原会话续做；上下文水位告警
- [x] **跨端通道与治理**：消息层（裁决请求 / 错误上报 / 停止指令）、回程卡（成员 → Master 的问题卡）、打回机制强化（原因必填 + 通知 + 追溯）
- [x] **Reviewer（审阅人）**：一键对数学模型 / 代码 / 论文成品做第四方独立审阅；通道可配置（本地桥或任意 OpenAI 兼容端点，responses/chat 双协议）
- [x] **同步基建**：sync-daemon v0.2.1 收口与下发、迁移自检（repo 配置刷新）、守护看门狗、凭据额度可见
- [x] **打包发布**：出厂默认项统一（模型目录 / 视觉能力）、三端重打包与升级流程验证

## 更远（v1.5 之后候选）

- 跨 tailnet 联邦 / 公网中继
- 完整 RBAC / 审批工作流
- 移动端只读面板

---

## English

- Current: **v1.3.0** (dsh 0.2.1 compatibility, 2026-10-29, tag `v1.3.0`). Development line: **v1.4** (feature-complete, pending release) → **v1.5** (in progress; A2A MVP shipped locally).
- **v1.5 (in progress; A2A MVP shipped locally)**: A2A realtime direct channel — Tailscale 100.x + HTTP on port 19400 (separate from panel 3210/19398), peer discovery, team-token auth, idempotency/TTL/rate limits/state persistence, session injection (followup/steer), automatic `notices/` fallback, CLI (`a2a.mjs send/ping/status/peers/config`), panel status/send, desktop-compatible; 44 A2A tests (core 18 / adapter 10 / panel 9 / CLI 7). Remaining: per-role token rotation, reconnect/heartbeat/backpressure, real three-end Tailscale drill + Slave→Master 19400 ACL, WebTTY, role skills/audit dimensions, optional memory archive.
- **v1.4 (feature-complete)**: dependency-free vector memory search (CJK bigram + Latin/number TF-IDF, inverted index, cosine, local index cache under `MMCAS_HOME`); `word|vector|hybrid|semantic` modes; optional OpenAI-compatible embeddings with batch/timeout/model checks and hybrid fallback; optional sqlite-vec `vec0` backend with role/date metadata filtering and JSON fallback; in-panel shared-memory search (`/api/memory/search`); stale-entry stats; 87-test regression.
- **v1.3 (shipped)**: full dsh 0.2.1 support for CLI and Desktop; merge-based profile configuration; one-click Desktop onboarding (`MMCAS-Desktop`, isolated `DSH_HOME`, panel 19398); standard preset sync (`time-context` / `tool-schedule`); reviewer config migration to `reviewer.json` with legacy `settings.yaml` / `.imported` compatibility; cold-session injection, target-session activity, audit report naming, credentials refs, and localized New Session fixes; full regression.
- **v1.2 (shipped)**: scheduler core hardening (auto-claim poller into the mainline, fix duplicate/stale dispatch, remove the hard WIP cap, regression tests); sessions & context (enable built-in compaction, per-task session lifecycle, context waterline warnings); cross-end messaging & governance (notices, stop commands, return cards, rework flow); independent audit instance (one-click third-party audits via a local bridge); sync infra (v0.2.1 rollout, migration self-check, watchdog); packaging & defaults.
- **Later (after v1.5)**: cross-tailnet federation / public relay, full RBAC / approval workflows, mobile read-only panel.
