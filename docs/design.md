# MMCAS 设计文档 v1.1

> Mathematical Modeling Competition Assistance System（数学建模竞赛辅助系统）
> 2026-09-08 初稿 / v1.1 开工修订。状态：开发期（第一阶段：骨架 + 同步守护）。

## 0. 项目定位

三人小队协同系统。每个成员 = 1 个 Agent（dsh profile）+ 1 个人类，人类随时可干预。
角色：建模手（Master）、编程手、论文手。三名成员异地协作、网络环境各异。
参考 AutoMM，但 MMCAS 是多人、多 agent、人类在环；复用其思路，不复用其单机全自动假设。

设备（示例）：
- 建模手（Master）：台式机（含独立显卡）
- 编程手：高性能台式机（算力最强，唯一运行 agent 的设备）
- 论文手：办公笔记本

## 1. 已定决策

- **无中心服务器**。不引入外部常驻服务作记忆后端/中心节点（自建 DERP 中继、headscale 为可选增强）。
- 传输层三件套：git 私有仓（状态同步）+ Tailscale（控制通道）+ 网盘（大文件，可选）。
- 记忆后端 v1 已落地（append-only 文件流 + 词匹配检索），向量索引留槽位（见 §6）。
- 零注册一键安装：队友不注册任何外部服务（见 §5.2）。
- 合规姿态：系统内不含任何自动 AI 标注/声明功能。
- 代码零隐私：凭证全部配置外置，仓库内永无真实凭证；暴露面登记见 docs/secrets-registry.md（见 §11）。

## 2. 传输层分工

| 层 | 组件 | 职责 | 备注 |
|---|---|---|---|
| 状态同步 | git（GitHub 私有仓） | 工作区/任务卡/记忆文件同步 + 版本历史 | 事实源；git 走 ssh.github.com:443；Gitee 备选 |
| 控制通道 | Tailscale | Master→Slave SSH、Slave 互控、将来 A2A 直连 | pre-auth key 预授权，ACL 即互控开关 |
| 大文件 | 网盘（可选） | 数据集、大附件 | 由部署者自配 |

NAT 现实：三台设备均不可入站（双 NAT / 校园网），一切直连必须经 Tailscale 组网。

## 3. 工作区同步（核心）

### 3.1 比赛工作区仓布局（独立私有仓，比赛期使用）

```
mmcas-workspace/            # 私有仓，唯一事实源
├── tasks/<task-id>.md      # 任务卡，一卡一文件（格式见 specs/task-card.md）
├── workspace/
│   ├── code/
│   ├── data/
│   ├── figures/
│   ├── modeling/           # 建模手产出（符号体系等）
│   └── paper/              # 论文手单写
├── memory/                 # 记忆文件流（append-only，v1 已实现）
│   ├── modeler/
│   ├── coder/
│   └── writer/
├── environment/            # 环境基线（pyproject.toml + uv.lock，方案 B）
├── sync/                   # 环境同步协议区（wheelhouse-*/requirements 已 gitignore）
├── .dsh/skills/            # 三端共享 skills（dsh 项目根扫描，git 同步）
└── docs/                   # device-info-<role>.md（队友设备信息）等
```

注：包源码不在工作区仓内（在 MMCAS 开发仓 packages/），工作区仓只放比赛内容。

### 3.2 冲突语义（按域定死，避免自研 CRDT）

| 数据 | 写者 | 冲突语义 |
|---|---|---|
| memory/*.md | 每 agent 只写自己目录 | 无冲突（并集合并） |
| tasks/<id>.md | 卡片持有者 | 无冲突（状态流转单写） |
| paper/ | 论文手 | 单写者，他人只读 |
| code/ | 各人模块 | git 原生合并 |

git 保底：冲突永不静默丢失，冲突文件由人类裁决。

### 3.3 同步循环

- 同步守护（pkg-core 内，独立进程）：文件变更自动 commit/push；定时 pull（默认 60s 一轮）。
- 冲突/网络失败：暂停 push、退避重试、写状态文件提示人类介入，绝不静默覆盖。
- 版本一致 = 同一 commit。
- 权威边界（自 AutoMM）：渲染视图 ≠ 事实源；git 工作区状态 ≠ 工作流状态。

## 4. 控制通道与权限

- **组网**：Tailscale，三机各拿稳定 100.x IP。
- **Slave**：OpenSSH Server + 防火墙规则限定 `RemoteAddress 100.64.0.0/10`（Tailscale 网段）；本地 policy（auto-approve/ask-human/deny）**v1 未实现**，当前由 Tailscale ACL 单层控制。
- **Master 隔离**：不装 SSH server；Tailscale ACL 显式拒绝 Slave→Master SSH。物理 + 策略双保险。
- **互控开关**：Tailscale ACL 为主（Master 改 ACL 即开关）；Slave 本地 policy 为辅（细粒度授权）。
- **互控流程**：v1 用**长期 Master 私钥 + Tailscale ACL**（key 常驻；限时 SSH key / 逐次审批机制后置未实现）。
- 控制面 = SSH 命令（软件级：装包/跑实验/管进程/性能模式）。BIOS 级不做。

**部署状态（内测）**：tailnet 与 ACL v1 已落地（三 tag + Master→Slave 全端口 + 互控开；关闭互控 = 删两条互通规则重新提交）；成员设备经预授权 key 接入（带过期与 tag 约束）。

## 5. 三包结构与零注册安装

### 5.1 包结构（开发仓 packages/ 下）

- `packages/core`（共享）：同步守护、provider 管理、任务卡插件、记忆插件（槽位）、A2A（槽位）、SSH 工具。
- role 层（互不相同）：role.md（人格，装机时注入 dsh profile persona）、skills/、tools 白名单、模型配置。
  - `packages/modeler`（Master）：数学建模知识库（AutoMM knowledge/ 全目录可搬）、文献、建模方法论。
  - `packages/coder`：数值计算、优化求解、并行/长任务队列、可视化。
  - `packages/writer`：论文写作、图表规范、排版。

### 5.2 零注册原则

队友计算机能力不强，**不注册任何外部服务**（无 GitHub/Tailscale 账号）：

- **git**：PortableGit 便携版塞包（免安装）。仓库访问用部署者预生成的细粒度 PAT / deploy key（每队友一把、限单仓、可吊销），git author 署名各自角色。队友全程无感知。
- **Tailscale**：部署者后台预生成 auth key（设过期时间 + tag），包内脚本 `tailscale up --authkey=tskey-xxx` 自动上线。设备归入部署者 tailnet；ACL 即互控开关，写死 Slave 不可 SSH Master。
- **运行环境**：Node 便携 + pnpm + dsh（版本锁定 0.1.2-rc.1）+ uv（Windows 单文件），全部随包（vendor 四件套）。
- **API 多源**：见 §5.5。

### 5.3 分发与升级

- 首次交付：单个 zip → 网盘分享 / 群文件。
- 升级：**工作区内容**由同步守护自动 git pull；**包本体**（脚本/插件）更新需重新分发 zip 或由 Master 远程替换（sync-daemon 只同步工作区仓，不含包源码）。
- 运维：Master 经 Tailscale SSH 远程诊断修复（控制通道即运维通道）。

### 5.4 设备确认

编程手苹果笔记本**不跑 agent**，仅台式机安装 coder 包。

### 5.5 API 多源配置（多 URL 多 key）

设计目标：支持多家官方 API + 中转站，UI 切换。**配置全部外置，仓库只放 example**。

```yaml
# providers.yaml（本地配置，.gitignore，不入仓）
providers:
  - id: deepseek
    name: DeepSeek 官方
    base_url: https://api.deepseek.com
    api_key: sk-xxx
    models: [deepseek-v4.1-flash-expires-on-0910, deepseek-v4-pro, deepseek-v4-flash]
  - id: relay-a
    name: 中转站 A
    base_url: https://relay.example.com/v1
    api_key: sk-xxx
    models: [claude-xxx, gpt-xxx]
default: deepseek
```

- 切换实现：pkg-core 面板把选中 provider 写入 dsh 的 credentials/settings 配置并提示重载会话（dsh 多 provider 的实际机制在开发期实测验证）。
- 每位成员的 key 由部署者统一创建分配（可单独吊销），或留空由 UI 填入。

**2026-09-08 本机实测结论**（dsh 0.1.2-rc.1，读 `dsh-llm-deepseek` 包 README）：

- 官方适配器 `dsh-llm-deepseek` 支持 `baseURL` 覆写（"optionally behind an OpenAI-compatible gateway named by baseURL"）→ **中转站（OpenAI 兼容网关）直接可用**。
- 凭证走 `apiKeyEnv`（credentials seam：`~/.dsh/.credentials.yaml` refs 映射，或环境变量），per-request resolve。
- settings 文档的 `llm-deepseek:` 段可覆盖任意字段，**无需重启**（"changes the next request without a restart"）。
- `dsh-llm-pi-ai` 适配器支持挂载更多 provider 路由（各家官方 API），与 DeepSeek 适配器并存（路由名不冲突，deepseek-official 重复注册会 DUPLICATE_ADAPTER）。

落地方式（2026-09-09 实测）：MMCAS 切换器 = providers.yaml 选中项 → 写 `~/.dsh/settings.yaml` 的 `llm-deepseek:` 段（baseURL/apiKeyEnv/reasoningEffort + models 目录，catalog 由 providers.yaml 的 models 生成，供 UI 模型选择器展示）+ credentials refs + `agent-default-model`（`--model` 可选指定，缺省取 models 首项）。已实测：临时 DSH_HOME 从零生成配置 → dsh headless 冒烟通过。

**PackyAPI Codex 通道（2026-09-09 落地，第二个来源，与 DeepSeek 并存）**：

- 约束：该 key 属 PackyAPI **codex 分组**，平台有反二次分发检测——直连（curl / SDK / dsh 适配器）被拦，**仅标准 Codex 客户端可用**（实测：chat completions 报 `protocol_not_supported`；responses 直连被拦；伪造 Codex 请求头 3 次中 1 次被拦，不可靠）。另需代理（部分地区返回 403「当前地区暂不支持访问模型」）。
- 方案：本地 `codex-bridge` 服务（`packages/core/codex-bridge/`）以真实 `codex exec --json` 为上游，暴露 OpenAI Responses 端点（SSE 流式）；dsh 侧 `llm-pi-ai` 路由 `codexbridge` 指向 `http://127.0.0.1:3220/v1`（`api: openai-responses`），UI 模型选择器出现「PackyAPI (Codex)」分组，与 DeepSeek 分组并列。
- 模型：`gpt-5.6-sol`、`gpt-5.6-terra`（该 key 仅这两个可用，其他模型报「分组 codex 无可用渠道」；每次调用固定 ~13K 输入 token，约 11K 走缓存）。
- 安装：`install-bridge.mjs`（setup.bat 自动调用）写 `%LOCALAPPDATA%\mmcas\codex-home\{auth.json,config.toml}` + `codex-bridge.json` + dsh `llm-pi-ai` 段 + credentials 引用（幂等）；启动：`start-bridge.bat`（start-agent.bat 自动拉起）。
- 端到端实测：dsh headless → pi-ai 路由 → bridge → codex CLI → PackyAPI 返回正确文本；队友包解压 → install-bridge → bridge → 调用 全链路通过。
- 队友端依赖：codex CLI（setup.bat 用便携 node 的 npm 安装，~380MB）+ 代理。**codex CLI 自动读 Windows 系统代理**（2026-09-09 实测：系统代理开启时零配置可调用；同环境 curl 直连被拦、走代理成功），故队友开着代理客户端（系统代理开关/TUN）即**无需任何额外配置**；仅代理不走系统代理时才需写包内 `config/proxy.txt`。

## 6. 记忆后端（v1 已落地，2026-09-09 更新）

- 已实现：append-only 文件流（memory/<role>/，memory-log/memory-search 工具 + 词匹配检索）+ 三副本 git 同步并集合并。
- 后置槽位：本地向量索引（vec/sqlite）、ForeSight 推导层复用——v1 未实现。
- 已查证：不引入 dsh 生态第三方记忆插件（persona 写死"记忆只走 MMCAS 文件流"）。

## 7. 总控面板（v5 = dsh 内嵌插件 @mmcas/dsh-panel）

- 定位：dsh 侧栏内嵌抽屉（总控/任务看板/共享记忆三按钮），**不是独立服务**；数据走 host 插件回环 HTTP 127.0.0.1:3210。
- P0：任务看板 + 同步水位 ✅。
- P1：记忆浏览 ✅（共享记忆抽屉）、agent/设备状态 ✅、provider 切换 UI ✗（用 CLI 切换器，UI 后置）。
- P2：权限审批 UI ✗、SSH 控制台入口 ◐（Master 操控门户 /api/exec，非完整 SSH 终端）。

## 8. AutoMM 复用清单

复用：
1. 四层结构 + 权威边界（规范层不含状态；Runner 唯一裁决；schema 验结构、白名单约束副作用；渲染视图 ≠ 事实源）。
2. 状态机语义：阶段/状态分离、gates 严格迁移表、回退最早冲突阶段 + stale 传播、错误归属三分（证据/公式/代码）。**改造：简化为三状态 todo/doing/done，人类随时可直接编辑卡片；审批需求走批注区、不进状态机（见 specs/task-card.md）。**
3. daemon 单动作 + 独占锁 + 对账（同步循环并发安全模板）。
4. 长计算任务队列异步（编程手跑大实验）。
5. knowledge/ 全目录（建模手 skills 素材）。
6. monitor.py + index.html（本地面板形态）。
7. agent_runtime.py registry + JSON Schema 验证调用。

不适用：单机全自动推进、单人类、"不撰写论文"（论文手补上）、邮件通知、git 仅中转。

## 9. 开发顺序（2026-09-09 全部完成，除队友实装）

1. ✅ 仓库骨架 + 三包 + 任务卡格式（三状态 + 批注式审批）
2. ✅ 同步循环守护（v0.1 双端活体验证）
3. ✅ Tailscale + SSH 通道 + policy（tailnet/ACL v1/auth keys）
4. ✅ dsh 多 provider 机制实测 + 切换器（单元验证 19/19，含 catalog 生成）
5. ✅ 三包组装（vendor/setup/pack/write-config，dry-run 验证）
6. ✅ 三角色 role.md + persona 注入（headless+web 双形态实测）
7. ✅ 任务卡护栏 taskcard.mjs（单元验证 12/12：迁移/依赖门控/WIP/删除防护/deps 编辑）
8. ✅ SSH 工具集 sshctl.mjs + setup 装 OpenSSH Server
9. ✅ 记忆插件 v1（memory-log/memory-search，文件流+检索；向量检索后置槽位）
10. ✅ 总控面板（v5 = dsh 内嵌插件 @mmcas/dsh-panel，三按钮 + 看板 CRUD + 轮询器 + 环境同步）
11. ✅ A2A 查证：dsh 生态无现成 A2A 插件 → v1 协同走 git 文件通道，A2A 自研后置
12. ⏳ 队友设备实装：两包分发 + 三条边打洞实测（需队友在场）

## 10. 已定 / 待观察

- 远端仓库平台：**已定 GitHub 私有仓**（git 走 ssh.github.com:443）。仓库地址配置在 `%LOCALAPPDATA%\mmcas\workspace-repo.txt`（pack 时写入包内 config/），**不硬编码在脚本里**；Gitee 仅作网络不稳时的备选。
- 人类沟通渠道：即时通讯工具（系统不接管）。
- 待观察：队友网络实测（若 GitHub 不稳定再切 Gitee）。

## 11. 隐私与开源纪律

- **代码零隐私**：不写真实姓名、地点、学校、账号、路径。文档中必要的人员/设备描述（§0）已随开源版本完成脱敏。
- **凭证零入库**：所有 key/token 只存在于本地配置文件（.gitignore 覆盖）或环境变量；代码只读配置，仓库永远只有 `*.example` 占位。开源 = 零改动。
- **暴露面登记**：所有涉及凭证的位置、性质、开源前处理方式统一登记于 `docs/secrets-registry.md`，新增凭证渠道必须先登记。
- **开源路线**：完成且运行良好后开源到 GitHub；开源前执行：脱敏 docs（人员/设备/地点）、清 git 历史中的敏感信息（如有）、README 只写功能与差异。
