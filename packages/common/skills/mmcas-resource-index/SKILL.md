---
name: mmcas-resource-index
description: MMCAS 数学建模资源检索：上游 GitHub 公开仓库映射、目录地图、按需直取方法（raw 单文件/稀疏 clone/archive）。当任何角色需要查资料（历年论文、算法代码、模板、书籍）或获取本端没有的资源文件时使用。
---

# MMCAS 资源检索（纯上游直取架构）

资源本体不随包分发、不入 git 仓、本地不保留副本——**真源是公开 GitHub 仓库**，需要时按索引直取。

## 分层

| 层 | 位置 | 内容 |
|---|---|---|
| 上游真源 | 公开 GitHub 仓库（下表） | 资源文件本体，随上游更新 |
| 索引（本文件所指） | `docs/resources/resources-index.md`（工作区仓，git 同步三端） | 目录地图（由 GitHub API 生成，无本地依赖） |

## 上游映射

| 仓库 | 内容 |
|---|---|
| `github.com/personqianduixue/Math_Model`（master 分支） | 全量资料库：历年国赛/美赛/研赛论文、算法、书籍、评阅要点 |
| `github.com/Jaxon1216/MathModelHub`（main 分支） | 方法论文档：图表选择/证据复现/论文质量清单/工作流选择 |

## 检索流程

1. **查索引**：`docs/resources/resources-index.md` 定位目标文件的分类与路径（路径即上游仓库内路径，注意 Math_Model 默认分支是 master）。
2. **直取**（任何一端自行执行，无需任何凭证——公开仓库）：
   - 单文件：`curl -L -o <file> https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<路径>`（中文路径需 URL 编码）；
   - 多个文件/整个目录：`git clone --depth 1 --filter=blob:none --sparse <repo-url> <tmp>` 后 `git sparse-checkout set <dir>`；
   - 全量离线包：下载 `codeload.github.com/<owner>/<repo>/zip/refs/heads/<branch>`。
   - 取到的文件放本端工作目录使用，用完即弃，不提交进工作区仓。
3. **离线时**：比赛期间网络不稳则暂时记录待取清单（任务卡注释），网络恢复后按索引直取。

## 纪律

- **大文件不入 git**：任何 >1MB 的资源文件不得提交进工作区仓（git 同步速度即协作速度）。
- **网盘不参与资源分发**（避免共享个人账号；资源真源本就公开在 GitHub）。
- 从资源引用的方法/模板，在使用处注明来源（论文参考文献、代码注释）。
- 上游仓库可能更新或失效，索引里的映射以实际访问为准；失效时在任务卡报告 Master 重新生成索引（`scripts/gen-resource-index.mjs`，纯 GitHub API 数据源）。

## 速查

- 历年优秀论文：Math_Model 的 `1-1按模型整理的美赛论文/`、`2-0研赛题目+论文/`、`2-1国赛题目+论文/`、`2-1美赛题目+论文/`（大目录，优先 sparse clone 指定子目录）。
- LaTeX 模板：直接用 `mm-latex-cumcm` skill 自带模板（已随包），无需上游。
- 算法实现：先查 `mm-model-selection` cookbook 与 `mm-code-implementation` playbooks（已随包）；不够再直取 Math_Model 的 `3-1算法-Algorithms_MathModels/`、`3-2算法-现代的算法/`。
- 国赛评阅要点：Math_Model 的 `5-1国赛官方的评阅要点/`。
