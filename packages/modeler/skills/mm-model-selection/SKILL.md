---
name: mm-model-selection
description: 数学建模模型决策矩阵与算法知识库：12种问题本质、95+场景模型选择、8类算法cookbook（优化/统计/机器学习/聚类/评价/博弈/机理/网络）。当需要选择模型、对比候选模型、查算法适用条件、或者建模手/编程手需要具体算法实施要点时使用。
---

# 模型决策矩阵与算法知识库

模型知识参考（非决策指令）。选择永远是"题目特征 + 数据规模 + 团队能力"的权衡，矩阵提供结构化起点。

## 使用方法

1. **判本质**：读 `references/problem-decomposition.md` 确定子问题数学本质。
2. **查矩阵**：读 `references/model-selection-matrix.md` 对应类型表格找候选。
3. **冲突裁决**：题目特征优先 > 问题规模优先 > 团队实现能力。列出所有候选与取舍条件，最终选择写明理由（写入任务卡 modeling 段）。
4. **算法细节**：确定模型族后读对应 cookbook：
   - `cookbook-optimization.md` 线性/整数/非线性规划、GA、NSGA-II、动态规划
   - `cookbook-statistical.md` 假设检验、方差分析、回归诊断
   - `cookbook-ml.md` 特征工程、模型选择、过拟合控制
   - `cookbook-clustering.md` K-Means、层次聚类、GMM
   - `cookbook-evaluation.md` AHP、熵权、TOPSIS、模糊评价
   - `cookbook-game-theory.md` 博弈模型、纳什均衡
   - `cookbook-mechanistic.md` 微分方程建模、机理模型
   - `cookbook-network.md` 图论、网络流、复杂网络

## 建模手纪律

- 候选模型至少 2 个并排对比后才定案；只有 1 个候选时必须说明"为什么没有替代方案"。
- 复杂度克制：先用简单模型跑通基线，复杂度必须换来可验证的收益（更低的误差/更强的可解释性），否则退回简单方案。
- 数据规模与模型复杂度匹配：样本 <100 不用深度模型；变量数 > 样本数优先降维或正则化。
- 每个模型要能回答"它失败的模式是什么"——答不出就还没理解它。

## 编程手使用说明

编程手读本 skill 时：cookbook 里的算法要点用于实现参考（参数选择、收敛判断、常见坑）；实现必须忠实于建模手任务卡里的符号体系与模型定义，不得自行换模型。

---
知识文件蒸馏自 Lupynow/math-modeling-skills（MIT），SKILL.md 为 MMCAS 语境改写。
