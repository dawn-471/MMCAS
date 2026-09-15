# 任务卡格式规范 v2

任务卡是 MMCAS 协同的指挥面。一卡一文件，放在比赛工作区仓 `tasks/` 目录，git 同步。

## 文件与命名

- 路径：`tasks/T-XXX.md`（XXX 为三位递增编号，如 T-001）
- 由建模手（Master）创建，创建时分配 owner（执行者角色）

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
---
```

## 状态机（v2 简化）

```
todo ──开始──> doing ──完成──> done
  ^              │
  └──── 退回 ────┘
```

合法迁移（其余一律拒绝）：

| 从 | 到 | 说明 |
|---|---|---|
| todo | doing | 执行者认领开始 |
| doing | done | 产出物提交并自检通过 |
| doing | todo | 退回待办（重新排队） |
| done | doing | 完成被打回（发现新问题） |

- 删除状态：blocked、review。阻塞/审批需求由人类直接在卡片正文批注，不走状态。
- **进行中谁在执行** = owner 字段（面板以 W/C/M 头像显示）。

## 调度规则 v3（DAG 偏序调度）

### 依赖门控（防提前接取/重复劳动/编造数据）

1. 卡从 todo → doing 前，**所有 deps 必须 status=done**；护栏拒绝未满足的迁移并提示等待项。
2. deps 表达"产出物依赖"：论文卡依赖编程卡（论文引用编程的数字）；编程卡可依赖建模卡的符号/数据约定。
3. 依赖未满足的卡留在 todo 列，面板显示「⏳ 等待 T-XXX」，不渲染"开始"按钮。

### 接取规则（防错接/抢接）

1. **owner 匹配**：agent 只接 owner 为自己角色的卡（coder 只接 owner=coder）。
2. **顺序**：同角色多卡就绪时，先 priority 高的；同优先级先接"被他人 deps 引用"的卡（关键路径优先）。轮询器自动注入按同规则排序（priority 升序 + 被引用数降序），手动接取时 agent 按本纪律执行。
3. **WIP 限制**：每个角色同时 doing ≤ 2。超限不得再认领新卡。
4. **原子认领**：todo→doing 的迁移即认领（git 单写者 + 状态机护栏保证不双接）。

### 发布纪律（建模手）

1. 发布粒度 = 独立可交付单元（一个子问题一张卡；一题多方法时按方法拆卡，便于审计与并行）。
2. 发布时必填 owner、priority、deps；在卡正文写明**验收标准**（什么算完成）。
3. 发布后确认：卡出现在 todo 列、deps 指向正确、下游已开始或等待中。
4. 任务变更：改卡正文 + 批注区说明；涉及依赖/优先级调整时同步相关卡。

### 异常处理

- 打回：done→doing（护栏允许），打回方在批注写明原因。
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
（任意成员的意见，不改他人卡片状态）
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
| 增 | `node {CORE}/taskcard/taskcard.mjs create tasks <标题> --owner <role> --priority <P0-P2> [--deps <T-001,T-002>] --desc <说明>` | 面板"新建任务"（POST /api/tasks，**仅 modeler**） |
| 查 | `taskcard.mjs list tasks`（按 priority 排序）或直接读 tasks/*.md | 面板看板 / 直接看文件 |
| 改-状态 | **仅** `taskcard.mjs update tasks <id> <todo\|doing\|done>`（护栏强制：依赖门控+WIP≤2+合法迁移；**禁止直接编辑 status 行**） | 面板状态按钮（PUT /api/tasks，同护栏） |
| 改-正文 | 直接编辑卡文件（标题/目标/进度/批注），或 `taskcard.mjs edit tasks <id> --title/--owner/--priority/--deps/--desc` | 面板详情"编辑"（PUT /api/tasks，字段齐全） |
| 删 | `taskcard.mjs delete tasks <id>`（仅误建卡；被依赖时拒绝，需 `--force`；保留历史优先） | 面板删除按钮（DELETE /api/tasks，被依赖时拒绝） |

纪律：**状态迁移必须走 update 命令或面板**——护栏在 CLI/API 层实现，直接改文件会绕过依赖门控与 WIP 限制。校验命令：`taskcard.mjs validate tasks`（CI/交接前跑一遍）。

**端点权限（v3.1，2026-09-09 加）**：创建卡仅 Master（modeler）；改/删卡仅 owner 角色或 Master——API 403 拒绝，UI 同步隐藏按钮（前端隐藏只是第一层，端点拒绝才是权限）。删除被依赖的卡会被拒绝（显式 `--force` / `force:true` 可强制），防止 DAG 死锁。
