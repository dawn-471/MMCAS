# 任务卡格式规范 v4

任务卡是 MMCAS 协同的指挥面。一卡一文件，放在比赛工作区仓 `tasks/` 目录，git 同步。

> 版本历史：v1 骨架 / v2 三状态简化 / v3 DAG 偏序调度（依赖门控+原子认领）/ v3.1 端点权限 / **v4 实战修订**（打回机制强化、回程卡受限通道、WIP 硬限制移除）。

## 文件与命名

- 路径：`tasks/T-XXX.md`（XXX 为三位递增编号，如 T-001）
- 正式卡由建模手（Master）创建，创建时分配 owner（执行者角色）
- 回程卡由 coder/writer 经受限通道创建（见「回程卡」节）

## Frontmatter

```yaml
---
id: T-001
title: 建立问题一的需求预测模型
status: todo          # todo | doing | done
owner: coder          # 执行者角色：modeler | coder | writer
priority: P0          # P0（关键路径，先做）| P1 | P2（可延后）
created: 2026-09-09
updated: 2026-09-09
deps: [T-000]         # 依赖的任务 id 列表（可为空）
origin: coder         # 可选：回程卡来源角色（coder | writer；正式卡不写此字段）
rework: 1             # 可选：打回次数（出现打回后由工具维护，初始不写）
---
```

## 状态机（v4）

```
todo ──开始──> doing ──完成──> done
  ^              │              │
  │   退回 ──────┘              │
  │                             │
  └───────── 打回（需原因）─────┘
```

合法迁移（其余一律拒绝）：

| 从 | 到 | 说明 |
|---|---|---|
| todo | doing | 执行者认领开始（依赖门控：所有 deps 必须 done） |
| doing | done | 产出物提交并自检通过 |
| doing | todo | 退回待办（重新排队） |
| done | todo | **打回**（发现新问题/需求变更/结果不达标；**reason 必填**，见「打回机制」） |

- 删除状态：blocked、review。阻塞/审批需求由人类直接在卡片正文批注，不走状态。
- **进行中谁在执行** = owner 字段（面板以 W/C/M 头像显示）。
- 打回与退回的区别：**打回** = 对已完成成果的推翻重做（触发续做通知 + 追溯计数）；**退回** = 执行中途重新排队（轻量）。

## 调度规则 v4（DAG 偏序调度）

### 依赖门控（防提前接取/重复劳动/编造数据）

1. 卡从 todo → doing 前，**所有 deps 必须 status=done**；护栏拒绝未满足的迁移并提示等待项。
2. deps 表达"产出物依赖"：论文卡依赖编程卡（论文引用编程的数字）；编程卡可依赖建模卡的符号/数据约定。
3. 依赖未满足的卡留在 todo 列，面板显示「⏳ 等待 T-XXX」，不渲染"开始"按钮。
4. 打回一张卡时，若其下游卡已开始/完成，护栏**提示受影响的卡**（级联提醒，不自动级联——是否连带重做由人类/Modeler 裁定）。

### 接取规则（防错接/抢接）

1. **owner 匹配**：agent 只接 owner 为自己角色的卡（coder 只接 owner=coder）。
2. **顺序**：同角色多卡就绪时，先 priority 高的；同优先级先接"被他人 deps 引用"的卡（关键路径优先）。轮询器自动注入按同规则排序（priority 升序 + 被引用数降序），手动接取时 agent 按本纪律执行。
3. **WIP 软约束（v4）**：`wipLimit` 默认 **0 = 不限制**（可配正整数，配置入口：面板配置项 `wipLimit` / 环境变量 `MMCAS_WIP_LIMIT`）。并行约束以依赖门控为主；`wipLimit>0` 时按老语义拦截并提示。面板始终显示各角色 doing 计数。
4. **原子认领**：todo→doing 的迁移即认领（git 单写者 + 状态机护栏保证不双接）。

### 发布纪律（建模手）

1. 发布粒度 = 独立可交付单元（一个子问题一张卡；一题多方法时按方法拆卡，便于审计与并行）。
2. 发布时必填 owner、priority、deps；在卡正文写明**验收标准**（什么算完成）。
3. 发布后确认：卡出现在 todo 列、deps 指向正确、下游已开始或等待中。
4. 任务变更：改卡正文 + 批注区说明；涉及依赖/优先级调整时同步相关卡。

### 打回机制（v4 强化）

- **触发纪律**：对已完成任务的需求变更、追加要求、结果不达标 ⇒ **必须打回**，禁止默默改；打回即时生效（不等人类说）。
- 操作：`update tasks <id> todo --reason <原因>`——护栏强制 reason 非空；工具自动完成：
  1. status → todo，updated 刷新；
  2. reason 写入批注区（`- <日期> 打回：<原因>`）；
  3. frontmatter `rework` 计数 +1（无则新增）；
  4. 发出续做通知：原会话存在 ⇒ 注入原会话续做；已删/不存在 ⇒ 新建会话兜底。
- 面板按钮文案："打回（需填原因）"。
- 人类（Modeler）拥有同样的打回通道；agent 对卡面变更同样受本纪律约束。

### 回程卡（v4 新增，成员 → Master 的问题通道）

- 目的：coder/writer 向 Modeler 回传问题（裁决请求/错误上报/资源需求），不再依赖"正文里写、人类手动转达"。
- 受限建卡通道：`taskcard.mjs create tasks "<标题>" --from <coder|writer> --desc <说明>`；护栏强制：
  - owner **固定 modeler**；priority **固定 P1**；deps 为空；
  - 必填 `origin: <角色>`（frontmatter）；
  - 正文含「问题描述」与「证据引用」区段（文件路径/卡号/日志摘要）；
  - 同通道传入 `--owner/--priority/--deps` 一律拒绝（防误用）。
- 处置：Modeler 面板"收件箱"过滤（`origin` 非空且 status=todo）→ 一键转正式卡（新建正式卡引用原卡）或回复批注后置 done。

### 异常处理

- 卡死：执行者失败/停滞时在卡上写进度记录；建模手终审兜底，必要时 owner 改派（重分配）。
- 插队：建模手调整 priority（`taskcard.mjs edit <id> --priority <P0-P2>` 或面板编辑）并在批注说明。

## 正文约定

```markdown
## 目标
一句话说清要交付什么。

## 产出物
- [ ] workspace/code/xxx.py
- [ ] workspace/figures/xxx.png

## 进度记录
- 2026-09-09 12:00 开始实现，数据格式确认。 (coder)
- 2026-09-09 14:00 完成，结果与假设一致。 (coder)

## 批注
（任意成员的意见，不改他人卡片状态；打回原因也记在这里）
```

## 单写者纪律

- owner 角色的 agent/人类管理卡片 status 与正文；其他人意见写"批注"区。
- 冲突处理靠 git 保底：并发编辑产生的冲突文件由人类裁决。

## 操作接口（agent 与人类的增删改查通道）

任务卡本体是 `tasks/*.md` 文件（git 同步），三种操作通道共享同一状态机护栏：

> 路径约定：下表 `{CORE}` 是各端包内 core 目录的实际路径——队友端 `<包根>/pkg/core`，开发机 `packages/core`。
> persona（role.md）内写 `{CORE}` 占位符，装机时由 write-config 替换为绝对路径；文档读者按本端实际布局理解。

| 操作 | Agent 通道 | 人类通道 |
|---|---|---|
| 增-正式卡 | `node {CORE}/taskcard/taskcard.mjs create tasks <标题> --owner <role> --priority <P0-P2> [--deps <T-001,T-002>] --desc <说明>`（**仅 modeler 侧**） | 面板"新建任务"（POST /api/tasks，**仅 modeler**） |
| 增-回程卡 | `taskcard.mjs create tasks <标题> --from <coder\|writer> --desc <说明>` | 面板收件箱通道（仅 coder/writer 端） |
| 查 | `taskcard.mjs list tasks`（按 priority 排序）或直接读 tasks/*.md | 面板看板 / 直接看文件 |
| 改-状态 | **仅** `taskcard.mjs update tasks <id> <todo\|doing\|done> [--reason <原因>]`（护栏强制：依赖门控 + 合法迁移 + 打回需 reason + wipLimit>0 时拦截；**禁止直接编辑 status 行**） | 面板状态按钮（PUT /api/tasks，同护栏） |
| 改-正文 | 直接编辑卡文件（标题/目标/进度/批注），或 `taskcard.mjs edit tasks <id> --title/--owner/--priority/--deps/--desc` | 面板详情"编辑"（PUT /api/tasks，字段齐全） |
| 删 | `taskcard.mjs delete tasks <id>`（仅误建卡；被依赖时拒绝，需 `--force`；保留历史优先） | 面板删除按钮（DELETE /api/tasks，被依赖时拒绝） |

纪律：**状态迁移必须走 update 命令或面板**——护栏在 CLI/API 层实现，直接改文件会绕过依赖门控与打回纪律。校验命令：`taskcard.mjs validate tasks`（CI/交接前跑一遍）。

**端点权限（v3.1）**：创建正式卡仅 Master（modeler）；改/删卡仅 owner 角色或 Master——API 403 拒绝，UI 同步隐藏按钮（前端隐藏只是第一层，端点拒绝才是权限）。删除被依赖的卡会被拒绝（显式 `--force` / `force:true` 可强制），防止 DAG 死锁。

**WIP 配置（v4）**：护栏读取 `MMCAS_WIP_LIMIT` 环境变量（数字；缺省 0=不限制）；面板侧读 profile 配置项 `wipLimit`（同缺省）。旧的"≤2"语义仅在显式配置正整数时生效。
