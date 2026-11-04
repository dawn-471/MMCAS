---
name: mm-experiment-ledger
description: 实验台账：每次正式运行记录 git 提交、数据哈希、参数/种子、环境、输出路径与状态，保证论文数字可回溯。当编程手开始调参、跑长实验、或论文手/Reviewer 需要追溯结果来源时使用。
---

# 实验台账（编程手）

论文里的每个数字都要能回答："哪次运行、哪份代码、哪份数据、什么参数产生的？"

## 最小记录字段（每次正式运行）

| 字段 | 内容 |
|---|---|
| run_id | `YYYYMMDD-HHMMSS-短哈希` |
| git | 提交哈希 + 是否 dirty |
| data | 输入文件路径 + SHA-256 前 12 位 |
| params | 关键参数与随机种子（JSON） |
| env | Python/关键包版本（或环境日志路径） |
| output | 结果文件/图表路径 |
| status | ok / failed / stopped + 原因 |
| card | 关联任务卡号 |

## 落盘位置

- 机器可读：`workspace/code/runs/<run_id>.json`（或 `results/runs.csv`）。
- 人类可读摘要：任务卡「运行记录」区一行：`run_id / 参数摘要 / 结果摘要 / 状态`。
- 调参中间尝试可只记一行；**被采纳的结果必须完整记录**。

## 使用纪律

1. 先写 run_id，再启动实验；结束后补 status 与输出。
2. 结果被写入任务卡/论文时，记录 run_id；没有 run_id 的数字不得交付。
3. 数据或代码变更导致 hash/提交变化时，旧 run_id 标记 superseded，不覆盖。
4. 长实验失败/中断也要记录，避免队友重复踩坑。
5. 论文手/Reviewer 追问时，先给 run_id 与台账行，再解释。

## 交付前自检

- [ ] 关键数字都有 run_id
- [ ] run_id 能找到 git 提交、数据哈希、参数/种子
- [ ] 失败/中断实验有记录
- [ ] 最新结论对应的不是 superseded 运行
