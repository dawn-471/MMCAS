# MMCAS 能力分工强化设计（阶段四：能力层）

日期：2026-09-09。目标：把三角色从"手动分工"升级为"能力分工"——role.md 强化 + 角色专属 skills + 资源库纳入。

## 1. 机制基础（已实测确认）

- dsh 0.1.2-rc.1 原生 skills 机制：`dsh-skill`（registry，已启用）+ `dsh-skill-filesystem`（本地扫描，**dsh-web-app 默认禁用，需 patch 启用**）+ `dsh-tool-skill`（模型访问，**同样默认禁用**）。
- Skill 格式：目录 `<name>/SKILL.md`（kebab-case name + description 必填，可选 whenToUse/metadata/disable-model-invocation/user-invocable）。references/scripts/assets 子目录不被自动发现，由 SKILL.md 指示 agent 读取。热加载（watch），无需重启。
- 扫描根（rank 序）：`<projectRoot>/.dsh/skills`（100，工作区仓=git 三端同步）→ `customSkillDirs`（300）→ `<dshHome>/skills`（400，每端独立，随包分发）。
- 安全纪律沿用：MMCAS 独立 DSH_HOME；profile patch 追加式编辑；改完 dump-config + headless 冒烟。

## 2. 布局决策

| 层 | 位置 | 内容 | 同步方式 |
|---|---|---|---|
| 角色专属 skills | `<dshHome>/skills/`（rank 400） | 建模手 3 / 编程手 3 / 论文手 4 | pack 打包 → setup 拷贝 |
| 共享 skills | 工作区仓 `.dsh/skills/`（rank 100） | mmcas-resource-index | git 三端同步 |
| 资源库本体 | 不落地：真源 = 公开 GitHub 仓库 | Math_Model + MathModelHub | 索引（GitHub API 生成）git 同步三端；三端按索引上游直取 |

同名冲突时低 rank 赢，角色 skill 不会与共享 skill 撞名（前缀 mm- vs mmcas-）。

## 3. role.md 强化原则

不膨胀（每份 +6~9 行），只加"认知纪律"段——把三个开源 skill 生态验证有效的认知机制蒸馏进去：

- 建模手：多方案对比义务（≥2 候选路线+取舍理由）、定案前对抗自检、5-Why 根因、假设证据义务、每个关键结论配灵敏度/稳健性检验义务、复杂度克制。
- 编程手：验证先行（最小可运行单元）、sanity check（量纲/数量级/边界）、数值稳定性、复现三要素（种子/环境版本/数据哈希）、结果写卡前审计。
- 论文手：交稿四轮自审（论证逻辑→结构→表述→格式）、数字出处纪律（每个数字可回溯到任务卡）、去 AI 味、摘要六要素、图表服务论证。

认知纪律是行为约束（每轮注入、常驻生效），细节知识走 skills（按需加载）——符合 progressive disclosure，避免 role 膨胀稀释注意力。

## 4. 三端 skill 集（蒸馏整合，非照搬）

上游全部 MIT。策略：以 Lupynow/math-modeling-skills（solver+paper，最高质量）为骨架，融合 math-modeling-judge 审计框架、mathmodel-latex-skill 模板细节、mathmodel-skill 经验库、kilo-kit 认知引擎思路。每个 skill 重写为 MMCAS 语境：知识参考而非决策指令；问答确认→任务卡/审批门/记忆文件；保留上游署名。

| Skill | 蒸馏来源 | 用途 |
|---|---|---|
| **建模手** | | |
| mm-modeling-workflow | solver 阶段1-2 + problem-decomposition | 拆题→文献→假设→模型矩阵→路线 |
| mm-model-selection | solver model-selection-matrix + 8 cookbook | 模型决策矩阵与算法知识 |
| mm-adversarial-check | judge 审计 + kilo-kit 对抗质询 + 5-Why | 定案前证伪自检 |
| **编程手** | | |
| mm-code-implementation | solver code-templates + paper figure-and-code-guide | 实现纪律与数值稳定性 |
| mm-numerical-pitfalls | solver cookbooks 编程侧 + judge 数值审计 | 数值计算常见坑与审计清单 |
| mm-reproducibility | judge 复现审计 + MathModelHub 证据原则 | 种子/版本/哈希/日志工程 |
| **论文手** | | |
| mm-paper-structure | paper SKILL.md 结构模板 | 国赛/美赛结构、篇幅、各节要点 |
| mm-paper-style | abstract-writing + common-phrases + de-ai-writing | 写作规范、句式库、去 AI 味 |
| mm-paper-review | self-review-framework + judge rubric | 交稿四轮自审 |
| mm-latex-cumcm | mathmodel-latex-skill（含模板与预检脚本） | LaTeX 模板、编译、预检 |
| **共享** | | |
| mmcas-resource-index | Math_Model/MathModelHub 实际结构 | 资源库索引与检索方法 |

modeler 既有 skills/knowledge/（AutoMM 17 篇）处理：精选与上述 skill 重叠的内容（optimization/statistics/time-series 等）降级为 mm-model-selection 的 references；其余保留为知识文件，不再作为独立 skill 暴露。

## 5. 资源库纳入（2026-09-09 三版：纯上游直取）

经三轮修订定稿：①网盘不参与资源分发（避免共享个人账号）；②本地持有+切片分发不可取（资源真源本就公开在 GitHub）；③**索引无需扫描本地**——索引数据源改为 GitHub API。定稿架构：

- **真源 = 公开 GitHub 仓库**（personqianduixue/Math_Model 11GB + Jaxon1216/MathModelHub），文件本体不落地、不备份、不入 git。
- **索引**：`docs/resources/resources-index.md` 由 `scripts/gen-resource-index.mjs` 生成——**纯上游版：gh api 拉 trees 递归目录树渲染（2482 行），零本地依赖**；进工作区仓 git 同步三端，人类直接读，agent 经 mmcas-resource-index skill 定位。
- **直取**：任何一端按索引从上游取——单文件 raw.githubusercontent.com、目录 sparse clone、全量 archive zip，无需任何凭证。
- **本地缓存（可选）**：如部署者另有本地副本，自用自管；系统不依赖。
- **切片 zip 已废弃**：资源不再随包分发。
- 大文件纪律不变：>1MB 不入工作区仓 git。

## 6. 工程改造

1. `write-config.mjs`：生成的 profile patch 追加启用 `skill-filesystem` + `tool-skill`；setup 时把角色 skills 拷入目标 `<DSH_HOME>/skills/`。
2. `pack.mjs`：打包 `packages/<role>/skills/`。
3. 本机 mmcas-modeler profile 立即追加同样两条 patch（追加式）。
4. 共享 skill：由 Master 端初始化工作区时写入 `.dsh/skills/` 并 push（Slave 端 git pull 获得）。

## 7. 验证矩阵

- dump-config：skill-filesystem / tool-skill `disabled: false`。
- headless 冒烟：问"列出你可见的 skills"应返回角色 skill 目录列表。
- 每个 skill 的 SKILL.md frontmatter 解析通过（name kebab-case + description）。
- pack 产物含 skills 目录；write-config 后目标 home 下 skills 存在。
- role.md 强化后 headless 自述仍为正确角色（persona 未被顶掉）。
