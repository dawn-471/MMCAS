---
name: mm-latex-cumcm
description: 数学建模竞赛 LaTeX 项目：国赛(CUMCM)与美赛(MCM/ICM)模板、XeLaTeX/latexmk 编译、参考文献管理、匿名与格式预检脚本。当论文手需要创建论文工程、编译、处理参考文献、或做提交前格式预检时使用。
---

# 竞赛 LaTeX 工程（MMCAS 论文手）

## 模板选择

- 国赛：`templates/cumcm/`，主入口 `main-cumcmthesis.tex`（`\documentclass[withoutpreface,bwprint]{cumcmthesis}`）。缺 cumcmthesis.cls 时用随附的兼容类；再不行降级 `main-ctexart-fallback.tex`。
- 美赛：`templates/mcm-icm/main.tex`（`\documentclass{mcmthesis}`）。
- 编译：中文模板一律 XeLaTeX；用 `latexmk -xelatex`（各模板目录带 latexmkrc）。
- 环境检查：先跑 `python scripts/check_latex_env.py` 确认本机 LaTeX 工具链。

## 参考文献

- 用 `ref.bib` 管理，正文 `\cite{key}`。国赛用 `gbt7714` + `gbt7714-numerical` + `\citestyle{numbers}`。
- 文献引用与交叉引用分离：`\cite` 只给文献，`\label/\ref/\eqref` 只给图表公式。
- 占位文献条目交稿前必须替换为真实文献。
- 提交前跑 `python scripts/check_latex_refs.py main.tex --bib ref.bib`，缺引用/缺条目全清零。

## 国赛规范要点

- 结构：摘要、问题重述、问题分析、模型假设、符号说明、数据预处理、模型建立与求解、模型检验、模型评价与推广、参考文献、附录。
- 一级标题中文数字（一、问题重述），二级 1.1 式。
- 不设"总体思路"独立小节；思路写入问题分析或模型流程图。
- 假设编号式：`假设 n：...。解释：...`。
- 关键词用建模术语（见 mm-paper-style），跑 `python scripts/check_latex_keywords.py main.tex` 检查。
- 数据章节标题统一"数据预处理"。
- **匿名红线**：论文正文/PDF 中不出现学校、姓名、学号、指导教师、地区等身份信息。提交前跑 `python scripts/check_pdf.py` 做 PDF 页数/尺寸/身份信息预检。

## 美赛规范要点

- Summary Sheet 一页；控制号占位符；目录可选（按当年规则）。
- 身份字段用占位符（0000000/A/Paper Title Placeholder），终稿替换为真实控制号。
- 遵循当年 COMAP 规则与 AI 使用声明要求（按当年官方规则为准）。

## 与任务卡的关系

- 论文工程放 `workspace/paper/latex/`；编译产物与源码同仓。
- 编译失败/预检不过 → 修复后重跑预检，全部通过才在任务卡标注"格式预检通过"。

---
蒸馏自 wangling-miao/mathmodel-latex-skill（MIT）模板与预检脚本，改写为 MMCAS 语境。
