# MMCAS 设计文档 v1.4

> Mathematical Modeling Competition Assistance System（数学建模竞赛辅助系统）
> 2026-09-08 初稿 / v1.1 开工修订 / v1.2 赛后实战修订 / v1.3 dsh 0.2.1 适配 / v1.4 向量记忆检索。
> 状态：v1.0 全链路内测与开源发布完成；v1.2「实战修订」完成；v1.3.0 dsh 0.2.1（CLI + 桌面端）适配已发布（tag `v1.3.0`）；v1.4 向量记忆检索功能完成（待发布）；v1.5 A2A 直连 MVP 已落地（进行中，见 §17）；v1.6 Guide / Reviewer 专家双角色已落地（进行中，见 §18）。

## 0. 项目定位

三人小队协同系统。每个成员 = 1 个 Agent（dsh profile）+ 1 个人类，人类随时可干预。
角色：建模手（Master）、编程手、论文手。三名成员异地协作、网络环境各异。
参考 AutoMM，但 MMCAS 是多人、多 agent、人类在环；复用其思路，不复用其单机全自动假设。

设备（示例）：
- 建模手（Master）：台式机（含独立显卡）
- 编程手：高性能台式机（算力最强，含独立显卡）
- 论文手：办公笔记本

## 1. 已定决策

- **无中心服务器**。不引入外部常驻服务作记忆后端/中心节点（自建 DERP 中继、headscale 为可选增强）。
- 传输层三件套：git 私有仓（状态同步）+ Tailscale（控制通道）+ 网盘（大文件，可选）。
- 记忆后端 v1 已落地（append-only 文件流 + 词匹配检索），向量索引留槽位（见 §6）。
- 零注册一键安装：队友不注册任何外部服务（见 §5.2）。
- 合规姿态：系统内不含任何自动 AI 标注/声明功能。
- 代码零隐私：凭证全部配置外置，仓库内永无真实凭证；暴露面登记见 docs/secrets-registry.md（见 §11）。
- （v1.2）调度以**依赖门控**为准（DAG 偏序）；WIP 硬限制移除，改为可配软约束（见 §15）。
- （v1.2）**会话按任务生命周期管理**：新卡开新会话接取、打回回原会话续做（见 §12）。
- （v1.2）跨端治理走**文件消息层**（notices，随 git 同步）；必须即时打断的事项用 steer 投递（见 §13）。
- （v1.2）**独立审计专家实例**：本地桥接较强专家模型，一键对数学/代码/论文三维度出具第三方审计（见 §14）。

## 2. 传输层分工

| 层 | 组件 | 职责 | 备注 |
|---|---|---|---|
| 状态同步 | git（GitHub 私有仓） | 工作区/任务卡/记忆文件同步 + 版本历史 | 事实源；git 走 ssh.github.com:443；Gitee 备选 |
| 控制通道 | Tailscale | Master→Slave SSH、Slave 互控、**A2A 直连（v1.5，HTTP 19400）** | pre-auth key 预授权，ACL 即互控开关；A2A 需放行 Slave→Master 19400 |
| 大文件 | 网盘（可选） | 数据集、大附件 | 由部署者自配 |

NAT 现实：三台设备均不可入站（双 NAT / 校园网），一切直连必须经 Tailscale 组网。

## 3. 工作区同步（核心）

### 3.1 比赛工作区仓布局（独立私有仓，比赛期使用）

```
mmcas-workspace/            # 私有仓，唯一事实源
├── tasks/<task-id>.md      # 任务卡，一卡一文件（格式见 specs/task-card.md）
├── notices/                # 跨端消息层（v1.2，见 §13.1）
├── workspace/
│   ├── code/
│   ├── data/
│   ├── figures/
│   ├── modeling/           # 建模手产出（符号体系等）
│   ├── paper/              # 论文手单写
│   └── audit/              # 独立审计报告（v1.2，见 §14）
├── memory/                 # 记忆文件流（append-only，v1 已实现）
│   ├── modeler/
│   ├── coder/
│   └── writer/
├── environment/            # 环境基线（pyproject.toml + uv.lock，方案 B）
├── sync/                   # 环境同步协议区 + 守护测试脚本（wheelhouse-*/requirements 已 gitignore）
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

### 3.4 入库前体检与冲突守卫（sync-daemon v0.2.1）

同步守护在提交链路内置三道守卫（事故驱动的修订）：

1. **冲突守卫**：存在未解决合并（`git ls-files -u` 非空）时**拒绝提交、不动 index**——`git add` 在 UU 文件上的语义是"以工作区内容标记冲突已解决"，会把冲突标记提交进历史并静默清掉 UU 状态；冲突模式跨重启持久化（启动时从 `sync.state.json` 读回）。
2. **入库前体检**：`git add` **之前**扫描待提交文本文件——
   - 成对冲突标记（`<<<<<<<` + `>>>>>>>`，成对才算）⇒ 硬拦截（避开 markdown 里合法的 `=======` 下划线）；
   - 非法码点（U+FFFD、U+FE30–FE4F）⇒ **按文件类判定**（见第 3 条）；
   - 疑似 GBK 乱码签名命中 ≥3 次 ⇒ 仅告警（启发式；可配置升级为拦截）。
   命中即进入 `blocked` 模式：不提交、不 push，等待人工处理，日志一次性打点。
3. **文件分类口径**（按扩展名白名单）：
   - **代码类**（`.py/.js/.ts/.mjs/.cjs/.yaml/.yml/.toml/.ini/.cfg/.bat/.ps1/.sh`）：非法码点硬拦截——代码里出现非法码点必是缺陷，编译/词法必崩；
   - **散文/数据类**（`.md/.tex/.txt/.json/.jsonl/.csv/.tsv`）：非法码点仅告警——文档可能**引用**乱码样例（事故记录本身），一律硬拦截会"把事故记录挡在门外"、逼人绕过守卫。
   - **数据文件（含代码目录下的 JSON 日志等）不会触发硬拦截**，此口径为正式结论。

### 3.5 同步基建运维（v1.2）

- **存活看门狗**：`sync.state.json` 心跳停滞在面板显性告警（三端）；`start-agent.bat` 启动时确保守护在跑（与 master 启动器对齐）。判据 = `at` 字段持续推进，进程存在 ≠ 在工作。
- **迁移自检**：setup「工作区已存在」分支同步刷新 repo 级 `core.sshCommand`（历史缺口：包目录迁移/重装后 sshCommand 仍指旧绝对路径，push 全败）；附一次性自检脚本。
- **凭据额度可见**：桥 `/health` 暴露额度/429 状态，面板可见（额度耗尽不再静默）。

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

- `packages/core`（共享）：同步守护、provider 管理、任务卡插件、**记忆文件流与向量检索（v1.4）**、**A2A 直连（v1.5）**、SSH 工具、**审计工具链（v1.2）**、**notices CLI（v1.2）**。
- role 层（互不相同）：role.md（人格；装机时注入 dsh——0.2.x 起 = system-prompt.personaPrefix + preset-standard persona 覆盖）、skills/、tools 白名单、模型配置。
  - `packages/modeler`（Master）：数学建模知识库、文献、建模方法论。
  - `packages/coder`：数值计算、优化求解、并行/长任务队列、可视化。
  - `packages/writer`：论文写作、图表规范、排版。
- 专家层（非执行，v1.6）：`packages/guide`（Guide：方向/模型/实现路线）、`packages/reviewer`（Reviewer：模型/代码漏洞审核）；共享 `packages/core/audit/audit-run.mjs`，不接任务卡、不执行工作。

### 5.2 零注册原则

队友计算机能力不强，**不注册任何外部服务**（无 GitHub/Tailscale 账号）：

- **git**：PortableGit 便携版塞包（免安装）。仓库访问用部署者预生成的细粒度 PAT / deploy key（每队友一把、限单仓、可吊销），git author 署名各自角色。队友全程无感知。
- **Tailscale**：部署者后台预生成 auth key（设过期时间 + tag），包内脚本 `tailscale up --authkey=tskey-<one-time-key>` 自动上线。设备归入部署者 tailnet；ACL 即互控开关，写死 Slave 不可 SSH Master。
- **运行环境**：Node 便携 + pnpm + dsh（版本锁定 0.2.1-rc.3）+ uv（Windows 单文件），全部随包（vendor 四件套）。
- **API 多源**：见 §5.5。

### 5.3 分发与升级

- 首次交付：单个 zip → 网盘分享 / 群文件。
- 升级：**工作区内容**由同步守护自动 git pull；**包本体**（脚本/插件）更新需重新分发 zip 或由 Master 远程替换（sync-daemon 只同步工作区仓，不含包源码）。
- 运维：Master 经 Tailscale SSH 远程诊断修复（控制通道即运维通道）。
- 版本纪律：三端 dsh 版本锁定 0.2.1-rc.3——**升级 dsh 时须重跑 poller / 压缩 / 面板回归**（预览期破坏性变更频繁；0.2.x 起 agent 平面迁至 agent preset，MMCAS 以同 id 覆盖 preset-standard 注入 Role）。

### 5.4 设备确认

编程手备用的笔记本电脑**不跑 agent**，仅台式机安装 coder 包。

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

**本机实测结论**（dsh 0.2.1-rc.3，读 `dsh-llm-deepseek` 包 README）：

- 官方适配器 `dsh-llm-deepseek` 支持 `baseURL` 覆写（"optionally behind an OpenAI-compatible gateway named by baseURL"）→ **中转站（OpenAI 兼容网关）直接可用**。
- 凭证走 `apiKeyEnv`（credentials seam：`~/.dsh/.credentials.yaml` refs 映射，或环境变量），per-request resolve。
- settings 文档的 `llm-deepseek:` 段可覆盖任意字段，**无需重启**（"changes the next request without a restart"）。
- `dsh-llm-pi-ai` 适配器支持挂载更多 provider 路由（各家官方 API），与 DeepSeek 适配器并存（路由名不冲突，deepseek-official 重复注册会 DUPLICATE_ADAPTER）。

落地方式（实测）：MMCAS 切换器 = providers.yaml 选中项 → 写活动 profile 的 `cordis.patch.yml`（`llm-deepseek:` 条目的 baseURL/apiKeyEnv/reasoningEffort + models 目录，catalog 由 providers.yaml 的 models 生成，供 UI 模型选择器展示）+ credentials refs + `agent-default-model`（`--model` 可选指定，缺省取 models 首项）。dsh 0.2.x 的 `settings.yaml` 只做一次性导入兼容；已实测：临时 DSH_HOME 从零生成配置 → dsh headless 冒烟通过。

**出厂默认（v1.2）**：`switch-provider.mjs` 生成 catalog 时默认携带 `inputModalities`（含 imagePixelBudget/imageMaxBytes，参数化）——**视觉能力开箱可用**（实战实证：`read_image` 是刚需，缺省声明会在本地门禁被拒）；`reasoningEffort` 按角色默认（coder=max / writer=high / modeler=high，可覆盖）。

**PackyAPI Codex 通道（第二个来源，与 DeepSeek 并存）**：

- 约束：该 key 属 PackyAPI **codex 分组**，平台有反二次分发检测——直连（curl / SDK / dsh 适配器）被拦，**仅标准 Codex 客户端可用**（实测：chat completions 报 `protocol_not_supported`；responses 直连被拦；伪造 Codex 请求头 3 次中 1 次被拦，不可靠）。另需代理（部分地区返回 403「当前地区暂不支持访问模型」）。
- 方案：本地 `codex-bridge` 服务（`packages/core/codex-bridge/`）以真实 `codex exec --json` 为上游，暴露 OpenAI Responses 端点（SSE 流式）；dsh 侧 `llm-pi-ai` 路由 `codexbridge` 指向 `http://127.0.0.1:3220/v1`（`api: openai-responses`），UI 模型选择器出现「PackyAPI (Codex)」分组，与 DeepSeek 分组并列。
- 模型：`gpt-5.6-sol`、`gpt-5.6-terra` 等（白名单在桥配置 `models` 字段，改名单需重启桥；`gpt-6-astra`/`gpt-5.6-luna` 实测可调）。
- 安装：`install-bridge.mjs`（setup.bat 自动调用）写 `%LOCALAPPDATA%\mmcas\codex-home\{auth.json,config.toml}` + `codex-bridge.json` + dsh `llm-pi-ai` 段 + credentials 引用（幂等）；启动：`start-bridge.bat`（start-agent.bat 自动拉起）。
- 端到端实测：dsh headless → pi-ai 路由 → bridge → codex CLI → 返回正确文本；队友包解压 → install-bridge → bridge → 调用 全链路通过。
- 队友端依赖：codex CLI（setup.bat 用便携 node 的 npm 安装）+ 代理。**codex CLI 自动读 Windows 系统代理**（实测：系统代理开启时零配置可调用），故队友开着代理客户端（系统代理开关/TUN）即**无需任何额外配置**；仅代理不走系统代理时才需写包内 `config/proxy.txt`。
- 工具桥（v2.6）：桥接支持工具调用——请求带 tools[] 时把 schema 渲染进 prompt，模型以 `tool_call` 文本块表达调用，桥转 Responses function_call；dsh 执行后回传继续。含三段式提醒 + few-shot + 反编造规则 + 自动纠错重试；「内层沙箱拒绝」被标注为预期噪音（忽略、勿报告）。排查口诀：`Connection error.` = 桥没跑；`stream ended before a terminal response event` = baseURL 被改回直连。

### 5.6 桌面端（dsh Electron）

- 官方桌面端运行时自带 dsh（0.2.1-rc.3），profile 固定为 `profiles/desktop`，页面 origin 为 `dsh-app://app`，宿主端口为随机（`--port 0`）。
- MMCAS 的 `write-config` 在 MMCAS 独立 `DSH_HOME` 下生成 `profiles/desktop`，并把 `mmcas-panel.port` 固定为 19398；桌面端必须通过 `MMCAS-Desktop` / `start-desktop.bat` 启动（设置 `DSH_HOME=%LOCALAPPDATA%\mmcas\dsh-home`）。
- 不要用 `dsh --profile desktop` / `dsh plugin --profile desktop` 管理该 profile：0.2.1 起 CLI 明确拒绝，profile 由 Electron 独占管理。
- 若桌面端已在运行，先完全退出再启动，避免沿用默认 `~/.dsh` 或旧 profile。

## 6. 记忆后端（v1.4：文件流 + 本地向量索引）

- 已实现：append-only 文件流（memory/<role>/，memory-log）+ 三副本 git 同步并集合并。
- v1.4：零依赖本地向量索引（中文 bigram + 英文/数字词元 TF-IDF、倒排表、余弦）；`memory-search` 支持 `word|vector|hybrid|semantic` 四模式；索引为本机派生缓存（`MMCAS_HOME/memory-index`），**不随 git 同步**，memory 文件变更后自动重建（见 §16）。
- v1.4 可选增强：OpenAI 兼容 `/embeddings` 生成稠密向量（`memory-embed.json` + `apiKeyEnv`），sqlite-vec `vec0` 作为 ANN 后端（role/date 元数据过滤）；任一不可用时回退 JSON/TF-IDF，索引 schema 以 `version` 隔离。
- v1.4 入口：CLI + 面板「共享记忆」搜索框（`GET /api/memory/search`），支持模式/角色/日期/limit 与降级提示。
- 已查证：不引入 dsh 生态第三方记忆插件（persona 写死"记忆只走 MMCAS 文件流"）。

## 7. 总控面板（v6 = dsh 内嵌插件 @mmcas/dsh-panel，合并版）

- 定位：dsh 侧栏内嵌抽屉，**不是独立服务**；数据走 host 插件回环 HTTP（web：127.0.0.1:3210，端口可配，web 端口 +11 约定；桌面端：固定 19398，dsh-app:// 无端口）。
- **按钮（三端一致）**：总控 / 任务看板 / 共享记忆（v1.4 含搜索）/ **审核室**（v1.6）/ **指导室**（v1.6，仅 Master）。
- **总控抽屉**：同步水位 + 成员设备 + **上下文水位**（v1.2）+ **消息区（A2A / notices）**（v1.5）+ 环境同步区 + 操控门户（仅 Master）。
- **任务看板**：三列板（priority 排序）+ 新建/编辑/详情（DAG 门控 + 权限护栏）+ **30s 自动 git 同步**（fetch → 落后则 merge（快进优先）→ 领先则 push；单飞——定时器与 HTTP 共用一次同步；默认不 add/commit 以免与守护抢锁；冲突/失败显式上报）+「刷新」「立即同步」按钮 + WIP 计数显示（限制可配，默认不限）。
- **调度核心（自动接取 v2，进主线）**：
  - autoClaim：轮询器按规则**自动认领**（todo→doing 写盘）+ 向目标会话注入接取报文（"已自动接取…不要重复认领"）；`autoClaim` 可回退为"只提醒不翻牌"。
  - **注入失败即回滚**（绝不把卡挂在没人干的 doing 上）；注入目标 = 最近活跃且可用 agent，支持 `targetSessionId` 钉死。
  - notified 与 tick 历史**落盘**（环形保留最近 20 条）；状态文件**按角色分目录**（`%LOCALAPPDATA%\mmcas\<role>\poller.json`，含旧文件自动迁移）。
  - **单例锁**（v1.2）：多实例共用状态目录时，第二实例自动禁用 autoClaim 并在 `/api/state` 显性上报（防重复派发）。
  - 派发前**二次读卡**（只认文件最末状态，防重编号/打回后的过期快照派发）+ 复核"非 doing 且无活跃 claim"；目标会话**排除已处理该卡的会话**（card→session 映射参与去重）。
- **上下文水位**：`/api/state` 暴露 token-meter 读数（各端最近会话），接近阈值警示（§12.4）。
- **审核室 / 指导室**（v1.6）：审核室审 model/code；指导室仅 Master（direction/model/code）；报告 + 通知（§14 / §18）。
- 既述能力：记忆浏览 ✅、设备状态 ✅、provider 切换 UI ✗（用 CLI 切换器，UI 后置）、权限审批 UI ✗、SSH 控制台 ◐（Master 操控门户 /api/exec，非完整 WebTTY）。
- 工程约束（多实例并存）：host 数据服务端口必须可配 + EADDRINUSE 防御；client 端 API base 从页面端口推导（3199→3210、3200→3211，其余一律 3210；桌面端 dsh-app:// 固定 19398）；演示/对比用 `--patch` 双实例（同 id 覆盖整份 config，须写全字段）。

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

## 9. 版本与开发顺序

### v1.0 内测版（2026-09-08 起，全部完成）

1. ✅ 仓库骨架 + 三包 + 任务卡格式（三状态 + 批注式审批）
2. ✅ 同步循环守护（双端活体验证）
3. ✅ Tailscale + SSH 通道（tailnet/ACL v1/auth keys）
4. ✅ dsh 多 provider 机制实测 + 切换器（单元验证 19/19，含 catalog 生成）
5. ✅ 三包组装（vendor/setup/pack/write-config，dry-run 验证）
6. ✅ 三角色 role.md + persona 注入（headless+web 双形态实测）
7. ✅ 任务卡护栏 taskcard.mjs（单元验证 12/12：迁移/依赖门控/WIP/删除防护/deps 编辑）
8. ✅ SSH 工具集 sshctl.mjs + setup 装 OpenSSH Server
9. ✅ 记忆插件 v1（memory-log/memory-search，文件流+检索；向量检索后置槽位）
10. ✅ 总控面板（dsh 内嵌插件 @mmcas/dsh-panel：三按钮 + 看板 CRUD + 轮询器 + 环境同步）
11. ✅ A2A 查证：dsh 生态无现成 A2A 插件 → v1 协同走 git 文件通道，A2A 自研后置
12. ✅ 能力层（阶段四）：三角色 role.md 强化 + 11 个角色 skills + 资源库索引（上游直取）
13. ✅ 队友设备实装 → 赛事实战 → 赛后退役（设备侧收口全部完成）

### v1.3 dsh 0.2.1 适配（已完成，2026-10-29）

- **CLI + 桌面端**：适配 dsh 0.2.1-rc.3；桌面端使用独立 `DSH_HOME`、`MMCAS-Desktop` 启动器与面板端口 19398。
- **profile 合并**：`write-config` / `switch-provider` / `install-bridge` 按条合并 `cordis.patch.yml`，保留 dsh 设置、插件与自定义 panel 端口。
- **preset 同步**：standard preset 加入 `time-context` / `tool-schedule`，移除 `backgroundMode` / `tool-ralph` / 旧 subagent 行。
- **Reviewer 迁移**：审核室配置落到 MMCAS 自有 `reviewer.json`，旧 `settings.yaml` / `.imported` 只读兼容。
- **稳定性**：冷会话 `prompt` signal、目标会话活跃度、审计报告唯一文件名、credentials `refs`、New Session 本地化匹配。

### v1.4 向量化记忆检索（功能完成，2026-11-02）

- **Phase 1**：零依赖本地索引（中文 bigram / 英文数字词元、TF-IDF、倒排表、余弦）；`memory-search` 四模式（word / vector / hybrid / semantic）；角色 / 日期 / limit / JSON / stats；缓存自动重建与 BOM 兼容。
- **Phase 2**：可选语义嵌入后端（OpenAI 兼容 embeddings，批处理/超时/模型与维度校验）与 sqlite-vec ANN 后端（`vec0` + role/date 元数据过滤）；失败回退 JSON/hybrid。
- **Phase 3**：面板「共享记忆」搜索框、模式/角色筛选、分数与降级提示；`GET /api/memory/search` 三端一致。
- **回归**：87 项记忆相关单测（基础 28 / 语义 26 / sqlite-vec 17 / 面板 16）。

### v1.5 A2A 直连通道（MVP 已落地，2026-11-03）

- **核心**：`packages/core/a2a/`（protocol / discovery / server / client / CLI），HTTP 端口 19400，Tailscale 100.x 直连。
- **协议**：`{v,id,from,to,kind,urgency,scope,body,at,replyTo,ttl}`；幂等、TTL、64KB 上限、from/to/kind 校验。
- **鉴权**：每角色 token（`<MMCAS_HOME>/a2a-tokens.json`；单 token / 环境变量回退）+ Tailscale ACL；token→from 与 IP→role 双校验。
- **投递**：面板宿主内 A2A 服务收到消息后复用 `injectToSession`（urgent/stop=steer，其余 queue）；失败/离线自动回落 `notices/`。
- **入口**：`a2a.mjs send/ping/status/peers/config`；面板总控 A2A 状态 + 消息发送（优先 A2A，失败回落）。
- **桌面端**：A2A 随面板宿主启动，token 路径与端口一致；面板数据端仍为 19398，A2A 19400。
- **回归**：48 项 A2A 测试（核心 22 / 适配 10 / 面板 9 / CLI 7）；实机 tailnet 演练与 token 轮换/吊销入口待 M2。

### v1.6 专家双角色 Guide / Reviewer（已落地，2026-11-04）

- **角色包**：`packages/guide`（方向/模型/实现路线）与 `packages/reviewer`（模型/代码审核）；B-Audit 审计提示词与“更好数学模型”思路迁入系统。
- **共享运行器**：`audit-run.mjs --mode reviewer|guide`；独立 `reviewer.json` / `guide.json`；报告 `audit/` / `guidance/`。
- **边界**：Guide 仅 Master 发起、只给方向与路线；Reviewer 只审数学建模内容（model/code），不评写作；两者都不接任务卡、不执行。
- **面板**：审核室（全员）+ 指导室（仅 Master）；配置、状态、预算确认、报告与通知。
- **回归**：Guide 9 + 面板 Guide 7；Reviewer 16 项回归通过。

### v1.2 实战修订（已完成，2026-09-16 发布）

来源：实战反馈（建议书十项）+ 队友端回收材料分析。六个工作流（W0–W6，详见 ROADMAP 与项目管理条目）：

- **调度核心**：合并两套面板增强（autoClaim v2 + 30s git 同步）；重复/过期派发修复（含单例锁）；WIP 硬限制移除；轮询器回归测试套件。
- **会话与上下文**：压缩三件套挂载与调参；新卡开新会话；打回回原会话；上下文水位守门。
- **跨端通道与治理**：notices 消息层；停止指令；回程卡；打回机制强化。
- **独立审计**：一键三维度审计（数学模型/代码/论文）+ 预算守门。
- **同步基建**：v0.2.1 收口与激活；迁移自检；看门狗；额度可见；EADDRINUSE 清晰提示。
- **打包发布**：出厂默认统一（视觉能力/推理档位）；三端重打包与升级流程验证。

## 10. 已定 / 待观察

- 远端仓库平台：**已定 GitHub 私有仓**（git 走 ssh.github.com:443）。仓库地址配置在 `%LOCALAPPDATA%\mmcas\workspace-repo.txt`（pack 时写入包内 config/），**不硬编码在脚本里**；Gitee 仅作网络不稳时的备选。
- 人类沟通渠道：即时通讯工具（系统不接管）。
- 待观察：dsh 预览期变动（锁定 0.2.1-rc.3，升级时重跑 poller/压缩/面板回归）；极端单卡上下文（压缩之外由水位守门 + 交接纪律兜底）；notices 常态时延（秒级～分钟级，紧急走 steer）。
- 上游反馈包（不与本仓混）：dsh 沙箱子进程间歇 `Access is denied` / 管道不可用（实战高频痛点，样本可提取）；单独整理。

## 11. 隐私与开源纪律

- **代码零隐私**：不写真实姓名、地点、学校、账号、路径。文档中必要的人员/设备描述（§0）已随开源版本完成脱敏。
- **凭证零入库**：所有 key/token 只存在于本地配置文件（.gitignore 覆盖）或环境变量；代码只读配置，仓库永远只有 `*.example` 占位。开源 = 零改动。
- **暴露面登记**：所有涉及凭证的位置、性质、开源前处理方式统一登记于 `docs/secrets-registry.md`，新增凭证渠道必须先登记。
- **开源路线**：完成且运行良好后开源到 GitHub；开源前执行：脱敏 docs（人员/设备/地点）、清 git 历史中的敏感信息（如有）、README 只写功能与差异。
- **发布状态**：v1.2.0 与 v1.3.0 已开源（MIT）；v1.3.0 tag 指向 dsh 0.2.1 适配完成点；v1.4 功能已完成、待发布；v1.5 A2A MVP 与 v1.6 Guide/Reviewer 已落地（本地回归通过，实机演练/费用标定待完成）。后续修订按 Milestone 推进，每次发布重复上述检查。

## 12. 会话生命周期与上下文（v1.2）

### 12.1 上下文压缩（compaction 三件套）

dsh 自带压缩三件套（`compaction-basic` + `command-compact` + `tool-result-pruner`），常规随 agent preset 挂载。0.1.x 时代 MMCAS 为保住 persona 禁用 presets，**连带把压缩全部关掉**（实战暴露：长任务撞上下文上限，多会话静默失败），v1.2 改为在 profile patch 显式重挂。**0.2.x 更新**：agent 平面（含压缩）整体归 agent preset，MMCAS 不再禁用 preset，改为同 id 覆盖 `preset-standard`——persona 前缀 = Role 文档，压缩三件套随 preset 挂载；下面这组 v1.2 参数保留在覆盖的 `compaction` 组内（模板块见 `packages/core/standard-preset-021.yml`）：

```yaml
- id: compaction-basic
  disabled: false
  config:
    thresholdRatio: 0.7        # 默认 0.8；更早触发，留溢出余量
    retainTokens: 8192         # 保留最近 8K token 原文
- id: command-compact
  disabled: false
- id: tool-result-pruner
  disabled: false
  config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 }
```

参数落点：master profile patch 的 preset 覆盖、write-config 生成的队友 profile patch（同一模板块）与 `standard-preset-021.yml` 本体。验证：长会话压测（自动压缩触发 + `/compact` + 溢出恢复）+ 压缩后接续工作不断链。

### 12.2 新卡开新会话（替代"单会话吸尘器"）

旧行为 = 向"第一个活动会话"反复注入：既打断人类正在进行的上下文，又挤占长会话（叠加压缩缺失极易触顶）。v1.2：轮询器**认领后新建会话**（标题 `T-xxx 标题`、cwd=工作区、归入 MMCAS workspace）→ 注入接取提示；card→session 映射持久化（轮询器状态文件）。任务 ↔ 会话一一对应，天然隔离上下文。

### 12.3 打回回原会话

`done → todo`（打回）时查 card→session 映射：原会话存在 ⇒ 注入原会话续做（不丢上下文）；原会话已删/不存在 ⇒ 新建会话兜底。与 §13.4 打回机制同批落地。

### 12.4 上下文守门（压缩之外的双保险）

- 面板显示各端"最近会话 token 水位"（`/api/state` 暴露 token-meter 读数）+ 阈值警示；
- persona 纪律：接近上限时**先落盘交接**（卡批注 + memory），再继续或换会话。

## 13. 跨端通道与治理（v1.2）

### 13.1 notices 消息层（文件通道，复用环境同步先例）

- 协议：工作区仓 `notices/` 目录（git 同步）+ `N-xxxx.md/json`：
  `from / to / kind(裁决请求|错误上报|停止指令|一般) / urgency(normal|urgent) / scope(卡号|方向|线) / body / status(pending→delivered→acked) / at`
- 投递：目标端轮询器消费——normal ⇒ `followup`（排队唤醒）；urgent ⇒ `steer`（立即打断当前步，要求目标端 agent 在线，离线则排队至上线）。投递写回执（delivered）；agent 处理后置 acked。
- 入口：面板总控抽屉「消息」区（收发件箱/状态/一键发送；Master ⇄ 任意端、Slave → Master）+ CLI `notice.mjs send|list|ack`（agent 可直接用）+ persona 使用纪律（何时发消息 vs 写卡批注）。

### 13.2 停止指令

`kind=stop` + scope（单卡 / 方向=卡集合 / 整线）；投递走 steer 即时打断。收到方纪律：**立即停手** → 涉及卡打回或标注"已停" → 回执说明停在哪一步。Modeler 侧面板在卡详情提供"停止该方向"快捷入口。

### 13.3 回程卡（成员 → Master 的问题通道）

- coder/writer 可创建**受限卡**：owner 强制=modeler、必填 `origin: coder|writer`、标题/说明/证据引用；护栏拒绝其他字段组合。
- 面板"收件箱/待处置"过滤（Modeler 一键转正式卡或回复）。
- CLI 受限通道：`taskcard.mjs create --from <role>`（权限校验 + 测试用例）。

### 13.4 打回机制（强化）

- `done → todo` 打回**必须带 reason**（自动写入卡批注）；通知原持有人（原会话续做，见 §12.3）；卡面 `rework: n` 追溯字段；面板按钮文案"打回（需填原因）"。
- 纪律（persona/rules）：对已完成任务的需求变更、追加要求、结果不达标 ⇒ **必须打回**，禁止默默改；打回即时生效（不等人类说）。
- 治理文档：`memory/shared/rules.md` 增补（打回/回程/消息纪律）；三个角色文档与 specs v4 同步。

## 14. 审核者 Reviewer（v1.2 / v1.6 收敛）

- **命名与定位**：**Reviewer（审核者）**——MMCAS 第四方：独立**工作流**（不接任务卡、不进三联通调度、不参与看板），但属**系统内组件**（配置 / 入口 / 报告 / 通知均在体系内）。
- 定位：只审**数学模型 / 代码成品**，聚焦数学建模内容本身（假设、推导、数值正确性、可复现性、代码与结论一致性）；**不评写作与排版**。`paper` 维度仅保留 CLI 兼容，面板不再展示。
- 通道（可配置）：`<MMCAS_HOME>/reviewer.json`（`endpoint / apiKeyEnv / model / protocol / maxFeeCny`）——默认走本地 `codex-bridge` → `gpt-6-astra`；可换成任意 OpenAI 兼容端点（responses 或 chat/completions 协议），**换专家模型只改配置**；桥不可用时给降级提示（不静默失败）；面板「审核室」可直接读写该配置。
- **形态**：面板「审核室」（三端）：选维度（model/code）→（可选）补充说明 → 执行 → 报告落 `workspace/audit/AUDIT-<维度>-<ts>.md` + 生成一条通知（§13.1）。
- **实现要点**：
  - 运行器 `pkg/core/audit/audit-run.mjs --mode reviewer`（CLI 与面板同源）：材料收集（维度白名单目录，排除 `_*`/产物目录/数据扩展名，按 mtime 预算截断）→ 脱敏 → payload → 本地桥 **Responses SSE** → 报告 + `.meta.json`。
  - 提示词位于 `packages/reviewer/instructions/{model,code,paper}.md`（从 B-Audit 实战提示词迁入；`packages/core/audit/instructions` 保留只读回退）。
  - **预算守门**：估算费用 = 材料字符 × 7e-5 元（B-Audit 实战标定）；> 阈值需显式确认（面板弹窗 / CLI `--confirm`）；材料 > 60 万字符上限拒绝。
  - **桥健康可见（§3.5）**：桥 `/health` 暴露 `lastUpstreamError`（401/402/429 + 摘要）与 `lastSuccessAt`；面板审核室与总控可读（经 `/api/bridge/health` 代理）。
- 材料边界：只发**摘编/汇总**，不发原始二进制数据包；打包后过敏感扫描（队伍号/用户名/路径替换）。
- **Guide 另见 §18**：Reviewer 往回查漏洞；Guide 往前指方向。

## 15. 调度修订：WIP 硬限制移除（v1.2）

- **背景**：v1 为每角色设 `doing ≤ 2` 硬限制。实战反馈：多线并行任务互相不掣肘时被硬卡，整体进度受阻（曾出现单端热改上限的临时措施）。
- **论证**：顺序约束的真实载体是**依赖门控**（DAG：deps 全 done 才可接取）——它精确表达"谁等谁"；WIP 硬限制是粗粒度近似：挡不住该挡的（无依赖关系的并行本就不互斥），却卡住不该卡的。并行失控的替代约束 = deps + priority 排序（关键路径优先）+ 卡粒度纪律 + 停止指令（§13.2）+ 人类终审。
- **语义**：`wipLimit` 默认 `0 = 不限制`（可配正整数）；面板保留计数显示与 priority 排序；"被依赖卡优先"逻辑不变。
- **执行点**（五处同改）：panel host 校验、`taskcard.mjs` 护栏、三份 role.md 表述、运行时 profile patch、面板徽标显示。
- **兼容**：旧文档/旧包的"≤2"表述随 v1.2 全量替换；specs v4 废除该字段（或写 `wipLimit: 0` 说明）。

## 16. 记忆向量检索（v1.4）

### 16.1 目标与边界

- 目标：在不改变"记忆文件流为唯一事实源"的前提下，让 `memory-search` 支持中文近邻/模糊匹配、语义召回与混合排序，降低跨会话记忆召回漏检。
- 边界：默认 `hash` 模式**不调用任何嵌入 API、不下载模型、不新增 npm 依赖**；语义模式仅在显式配置 `provider=openai` 时启用。索引只是可重建的本机缓存，丢失无数据风险。
- 兼容：旧命令 `memory-search <查询词>` 仍可用；默认模式由词匹配升级为 hybrid，`--mode word` 可回到 v1 行为；语义失败自动回退 hybrid 并在结果中显式标注。

### 16.2 数据与索引

- 数据源：`workspace/memory/<role>/YYYY-MM-DD.md`，条目格式 `## HH:MM` + 正文（沿用 v1）。
- 索引位置：`MMCAS_HOME/memory-index/<sha256(绝对工作区路径)[:16]>.json`（默认 `%LOCALAPPDATA%\mmcas\memory-index`）；**不写入工作区仓**。
- 索引内容（v3）：`version / builtAt / files{mtimeMs,size} / docs[]（含可选 vec[]）/ postings{token:[[docIndex,tf]]} / idf / embed{provider,model,dim,builtAt,sqlite?}`。
- 生命周期：每次检索先遍历 memory 文件（mtime/size 签名）；文件集合、mtime 或 size 变化即整库重建（比赛工作区记忆量小，优先正确性）；文件删除自动从索引消失；写入采用临时文件 + rename 原子替换；索引损坏/不可写时退化为内存索引，不阻断检索。
- BOM：读取时剥离 UTF-8 BOM，避免首条 `## HH:MM` 被漏解析。

### 16.3 向量化与打分

- 词元：拉丁字母/数字按词切分（保留 `_ + . # / -` 复合词，并拆子词）；中文按连续汉字段取 **bigram**（单字段保留 unigram），兼顾短语与单字查询。
- 权重：`w = (1 + ln(tf)) * idf`，`idf = ln(1 + (N - df + 0.5)/(df + 0.5))`（BM25 风格，恒正）。
- 余弦：`cos(q,d) = Σ wq·wd / (|q|·|d|)`；文档范数在建索引时预计算，查询只扫倒排表命中的文档。
- 混合：`score = cos + 0.25 * ln(1 + literalHits)`；`literalHits` 为查询词（空格切分）在正文中的字面命中次数。`word` 模式仅用 `literalHits`，`vector` 模式仅用哈希余弦，`semantic` 模式用稠密向量余弦（仍叠加字面命中提升）。
- 语义向量：嵌入结果做 L2 归一化后存储；查询向量同样归一化。模型/维度必须与索引 `embed` 元数据一致，否则回退 hybrid。
- sqlite-vec：`vec0(embedding float[dim], role text, date text)`，rowid = docIndex+1；KNN 用 L2 距离，归一化后 `similarity = max(0, 1 - d²/2)`；查询 meta（builtAt/model/dim/docs）不一致即拒绝使用并回退 JSON。
- 排序：分数降序 → 日期降序 → 时间降序 → 文件路径稳定排序；`total` 保留过滤后总数，`limit` 只截断展示。

### 16.4 CLI

```bash
node memory-search.mjs --workspace <ws> <查询词> \
  [--role modeler|coder|writer|all] [--limit N] \
  [--mode word|vector|hybrid|semantic] [--since YYYY-MM-DD] [--until YYYY-MM-DD] \
  [--provider hash|openai] [--embed-config <file>] \
  [--backend auto|json|sqlite] [--vec-ext <path>] \
  [--index <path>] [--rebuild] [--json]
node memory-search.mjs --workspace <ws> --stats [--stale-days N] [--json]

node memory-index.mjs --workspace <ws> \
  [--provider hash|openai] [--embed-config <file>] \
  [--backend auto|json|sqlite] [--dry-run] [--show-config] [--json]
node memory-index.mjs --workspace <ws> --stats [--stale-days N] [--json]
```

- embeddings 配置：`<MMCAS_HOME>/memory-embed.json`（模板 `packages/core/memory/memory-embed.example.json`），将 `provider` 设为 `openai`，字段 `endpoint / model / apiKeyEnv / dim / batchSize / timeoutMs / maxChars`；key 优先读同名环境变量，其次读 dsh `.credentials.yaml` 的 `refs`，不落日志。
- `--json` 输出 `query / mode / effectiveMode / fallback / backend / indexPath / builtAt / docs / total / results[]`，供面板与 agent 直接消费。
- 无查询词 exit 2；非法 role/mode/日期 exit 2；空工作区返回 0 条而非报错；语义失败回退 hybrid 且 `fallback` 非空。

### 16.5 默认离线，语义 / ANN 可选

- 默认 `hash` 模式完全离线、零 npm 依赖、零外部调用，覆盖中文 bigram 模糊召回与词匹配排序。
- `semantic` 需要真正的语义向量；sqlite-vec 只负责存储与近邻检索，**不产生向量**。因此语义模式仅在配置 OpenAI 兼容 `/embeddings` 时启用，复用现有 provider key 或独立 key 均可。
- `sqlite-vec` 作为可选 ANN 后端：Node ≥ 22.5（内置 `node:sqlite`）+ 随包 `vec0.dll`；无扩展、无 `node:sqlite`、DB 缺失或元数据不匹配时自动回退 JSON 向量，检索不中断。
- 选型门槛：记忆条目规模增长到 ANN 有收益（约 > 1 万条）或需要跨语言/同义词语义召回时启用语义 + sqlite-vec；否则 hash 足以覆盖比赛期记忆量。

### 16.6 面板与运维

- 面板 `GET /api/memory/search?q=&mode=&role=&limit=&since=&until=&backend=`：返回 `{ok, results[], total, mode, effectiveMode, fallback, backend, provider, ...}`；非法参数 400，缺工作区 400。
- 面板「共享记忆」抽屉：搜索框 + 模式/角色筛选 + 分数 + 降级提示；无查询时显示最近条目。
- 维护：`--stats --stale-days N` 输出 `staleDocs / staleCutoff / oldestDate`（非破坏性提示）；`memory-archive.mjs --before <date>` 默认 dry-run、`--apply` 移动到 `memory/<role>/archive/`，搜索默认排除、`--include-archive` 包含。
- 打包：`download-vendor.sh` 从 npmmirror 拉取 `sqlite-vec-windows-x64@0.1.9`，`pack.mjs` 复制 `vec0.dll` 到 `pkg/core/memory/`，`audit-recheck.sh` 校验记忆模块与测试随包。

## 17. A2A 直连通道（v1.5）

### 17.1 目标与边界

- 目标：在 git / notices 文件通道之外，提供 Agent 间**实时消息**（询问/回复/任务转交/停止/裁决），降低跨端协作时延。
- 边界：A2A 不是远程控制通道；SSH 仍只用于 Master→Slave 运维。A2A 只传消息，不执行命令。
- 原则：零注册、Tailscale 组网、凭证不入仓、人类在环；A2A 不可用时必须自动回落 notices，不静默丢消息。

### 17.2 协议 v1

- envelope：`{v:1, id, from, to, kind, urgency, scope, body, at, replyTo?, ttl}`。
- `id`：`A-YYYYMMDD-HHMMSS-xxxxxx`；`kind`：`ping / query / reply / task-handoff / stop / error / ruling / info`；`urgency`：`normal / urgent`。
- 校验：from/to/kind/urgency、body 非空且 ≤ 64KB、`at` 合法、`ttl` 1–86400 秒、过期拒绝（30s 时钟容差）、`replyTo` 格式。
- 幂等：服务端按 `id` 去重（最近 500 条，落盘 `<MMCAS_HOME>/a2a-state.json`）；重复投递返回 `duplicate:true`，不二次注入。
- 错误码：400 参数、401 鉴权、403 目标/来源不符、410 过期、413 超大、429 限流、503 投递失败。

### 17.3 传输、端口与发现

- 传输：HTTP（`/a2a/v1/ping|status|messages`）；默认端口 **19400**，与 web 面板数据端（3210/3211）和桌面面板数据端（19398）分离。
- 绑定：优先 Tailscale IPv4；不可用时回退 `127.0.0.1` 并在面板标注（仅本机）。`config.a2a.bind` 可覆盖。
- 发现：`tailscale status --json` 中 `mmcas-<role>` 主机名 → role/IP；也支持 `config.a2a.peers` 固定映射（`{ip, port?, online?}`）用于离线/测试。主机名不符时必须在 `a2a.peers` 显式配置。
- 桌面端：A2A 随面板宿主在 Electron 内启动，读取同一 `<MMCAS_HOME>/a2a-token.txt`，端口/防火墙规则与 CLI 端一致；`config.a2aPort` 由 `write-config` 同时写入 web/desktop profile。

### 17.4 鉴权与安全

- Tailscale ACL 负责网络层；应用层要求 `Authorization: Bearer <token>`，常量时间比较。
- 每角色 token：`pack.mjs` 生成/复用 `<MMCAS_HOME>/a2a-tokens.json`（role→token），随包 `secrets/a2a-tokens.json`，`setup.bat` 复制到成员机；服务端按 token 识别发送方角色，并校验 `from` 一致；单 token 文件/`MMCAS_A2A_TOKEN` 作为回退。三端包须复用同一映射。
- IP→role 校验：服务端按发现结果拒绝 `from` 与来源 IP 不匹配的消息；未知 peer 不投递。
- 速率限制：默认 120 条/分钟/IP；超出 429。日志不打印 token。
- 防火墙：`enable-a2a.ps1` 创建入站规则，仅允许 `100.64.0.0/10` 访问 TCP 19400；Tailscale ACL 还需放行 Slave→Master 19400。

### 17.5 投递、会话与降级

- 接收：面板宿主 A2A 服务调用 `injectToSession`；`urgent` 或 `stop` 用 `steer` 立即打断，其余 `queue`。
- 目标：`scope` 中的 `T-xxx` 优先映射到 poller 的 card→session；无映射时选最近活跃会话。
- 发送：面板/CLI 先尝试 A2A；网络失败、超时、401/403/503 时写 `notices/`（保留 kind/urgency/scope 与来源说明），返回 `mode:"notice"` 供 UI 显式提示。
- 幂等与回执：A2A 消息 id 去重；notices 回落沿用现有 delivered/acked 生命周期。

### 17.6 入口

```bash
node a2a.mjs send modeler --body "请确认假设" --kind query [--urgent] [--scope T-101]
node a2a.mjs ping coder
node a2a.mjs status [--json]
node a2a.mjs peers
node a2a.mjs config
```

- 面板：总控「消息」区显示 A2A 运行状态（bind:port、peer 在线数、收发/失败/回落计数、最近错误）；发送表单勾选「优先 A2A」，失败自动回落并提示。
- 面板 API：`GET /api/a2a/status`、`POST /api/a2a/send`、`POST /api/a2a/refresh`。

### 17.7 打包与运维

- `pack.mjs`：复制 `packages/core/a2a/`、生成/复用每角色 token 映射 `a2a-tokens.json`、复制 `enable-a2a.ps1`。
- `setup.bat`：调用 `enable-a2a.ps1`（Tailscale 网段 19400）并复制 token 映射到 `%LOCALAPPDATA%\mmcas\a2a-tokens.json`（单 token 回退）。
- `write-config`：web/desktop profile 的 `mmcas-panel` 均写 `a2aPort`（默认 19400）。
- `audit-recheck.sh`：校验 A2A 模块、测试、面板适配层、token 与防火墙脚本随包。
- 默认未配置 token 时 A2A 关闭、notices 照常；不会因 A2A 缺失阻断协作。

### 17.8 当前状态与后续

- 已落地：协议/发现/服务端/客户端/CLI、面板状态与发送、通知回落、桌面端、打包/token/防火墙、48 项测试。
- 待办（M2/M3）：token 轮换/吊销入口、重连/背压/离线队列、实机 tailnet 三端演练；完整 PTY WebTTY 见 §19；记忆归档与半交互终端已落地；角色技能/审计维度收敛见 §18。

## 18. 专家双角色：Guide / Reviewer（v1.6）

### 18.1 定位与分工

- **Guide（指导者）**：往前看。用更强/更贵的专家模型判断方向、识别关键矛盾、给出 2–3 条攻坚路线与分工；不写代码、不写论文、不改任务卡。
- **Reviewer（审核者）**：往回看。只审数学模型与代码漏洞（假设、推导、数值正确性、可复现性、代码与结论一致性）；不评写作/排版。
- 两者都独立于三端执行 agent 与任务链，但配置、入口、报告、通知全部在 MMCAS 内；避免“自己审自己/自己指导自己”。
- 执行仍由建模手、编程手、论文手完成；专家角色的输出是**建议/审核报告**，不是执行结果。

### 18.2 与 dsh-superagent 设计对齐（参考）

参考 `deepseek-ai/dsh-superagent-prototype`（MIT，研究原型）的“少占用人类注意力”原则，落成四条约束：

1. **只在被请求时运行**：Guide 仅 Master 显式发起；Reviewer 由三端显式发起。无自动巡检、无主动插话。
2. **一次请求 = 一个工作项**：每次运行有 id、维度、发起时间、材料快照、模型/配置、报告路径与 meta；本端串行执行，互不干扰。
3. **报告即交付**：完成/失败/预算超限才发通知；正常运行不产生噪音。报告明确区分证据/推测/必须修正。
4. **面板只显示需要人处理的事**：运行中、失败、待确认预算、最近报告；健康状态不占空间。

与 superagent 的 Source/Trigger/Ticket/Assignment/Report 对应关系：MMCAS 暂不引入完整工作项状态机，先做轻量版（面板内存状态 + 报告落盘）；持久化工作项/重试队列留作 v1.7 候选。

### 18.3 实现

- 共享运行器：`packages/core/audit/audit-run.mjs`，`--mode reviewer|guide`。
- Reviewer：`--dimension model|code`（`paper` 仅 CLI 兼容）；提示词 `packages/reviewer/instructions/*.md`；配置 `<MMCAS_HOME>/reviewer.json`；报告 `workspace/audit/AUDIT-*.md`。
- Guide：`--dimension direction|model|code`；提示词 `packages/guide/instructions/*.md`；配置 `<MMCAS_HOME>/guide.json`；报告 `workspace/guidance/GUIDE-*.md`。
- 材料收集：Reviewer 用 model→`workspace/modeling+analysis`、code→`workspace/code`；Guide direction 额外包含 `tasks/` 与 `workspace/paper`，model/code 按需组合。
- 协议：Responses（SSE）或 chat/completions；默认本地 `codex-bridge`（3220），可换任意 OpenAI 兼容端点。
- 脱敏/预算/字符上限沿用 v1.2：内置路径/邮箱/手机号规则，`--scrub` 追加；估算 ¥/字符按 B-Audit 标定；超阈值需确认。
- 角色包：`packages/guide/`、`packages/reviewer/`（role.md + README + config.example.json + instructions/），随 `pack.mjs` 打入 `pkg/guide`、`pkg/reviewer`。

### 18.4 面板

- Master 侧按钮：**审核室**（全员可见）与**指导室**（仅 Master，控制专家模型成本）。
- 审核室：model/code 两个维度；配置 `reviewer.json`；报告 `audit/`。
- 指导室：direction/model/code；配置 `guide.json`；报告 `guidance/`；显示预算阈值、桥健康、运行状态与最近结果。
- API：`POST /api/audit`、`GET /api/audit/status`、`GET|PUT /api/audit/config`；`POST /api/guide`、`GET /api/guide/status`、`GET|PUT /api/guide/config`。
- 完成时向 modeler 写一条 notices 通知；不自动创建任务卡。

### 18.5 安全与成本

- 不发送原始二进制/大数据包；只发文本摘编，先脱敏再打包。
- 预算阈值：Reviewer 默认 ¥30，Guide 默认 ¥50；超过阈值面板弹窗/CLI `--confirm`。
- key 仍存 dsh `.credentials.yaml` 的 `refs`，面板不回显；配置 JSON 只存 `apiKeyEnv`。
- 专家角色不执行命令、不改工作区；只读材料、写报告。
- 桌面端与 CLI web 共用同一面板宿主；专家调用走面板宿主，无需额外端口。

### 18.6 当前状态

- 已落地：Guide/Reviewer 角色包、共享运行器、双层配置、面板两室、B-Audit 提示词迁入、Guide 三分支提示词、预算/脱敏/报告、Guide 9 + 面板 7 项测试。
- 待办：专家工作项持久化（跨重启恢复/重试）、Guide 与任务卡联动（建议转卡）、实机专家模型调用与费用标定。

## 19. 半交互 WebTTY（v1.5 M3 MVP）

### 19.1 定位与边界

- 面板内终端，仅 Master 可见/可用；用于远程诊断、查看日志、跑交互式命令，不必另开 SSH 客户端。
- 当前是**半交互 MVP**：持久 shell 进程 + stdin/stdout 管道 + 轮询输出；不具备完整 PTY 的 TAB 补全、Ctrl+C 信号语义、全屏 TUI。完整 PTY 列入后续 spike。
- Slave 不开放入站终端；Master 侧仍受 Tailscale ACL 与人类操作约束。

### 19.2 实现

- 面板宿主维护单终端会话：`{proc, seq, chunks, running, shell, cwd}`；输出按 seq 分块缓存（最多 800 块）。
- 端点：`GET /api/terminal/status`、`POST /api/terminal/open`、`POST /api/terminal/input`、`GET /api/terminal/poll?since=N`、`POST /api/terminal/close`。
- 输入逐条写审计日志 `<MMCAS_HOME>/terminal-audit.log`（时间 + 角色 + 命令）；不记录输出；UI 提示不要输入密钥。
- 默认 shell：Windows `cmd.exe /Q /K chcp 65001`，其他平台 `$SHELL -i`；测试可覆盖 `config.terminal.shell/args`。
- 面板「终端」抽屉：输出区 + 命令输入 + 清屏/重开/关闭；打开时自动连接，关闭抽屉不杀进程（可重开接管）。

### 19.3 当前状态

- 已落地：Master-only 终端、持久 shell、轮询输出、命令审计、Slave 403、6 项面板测试。
- 待办：完整 PTY（TAB/Ctrl+C/全屏）、多终端标签、输出持久化/回放、命令白名单/审批。
