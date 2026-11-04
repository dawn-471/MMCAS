# Guide（指导者）

MMCAS 的第五个角色：独立专家顾问。用更强/更贵的专家模型判断方向、识别瓶颈、给出攻坚路线；具体执行仍由建模手、编程手、论文手完成。

## 何时使用

- 赛程过半但不确定优先级，需要判断“继续做 / 换路线 / 放弃”。
- 关键问题卡住，需要 2–3 条更强的数学或算法路线。
- 需要把“方向建议”拆成三名执行手可执行的下一步。

## 使用方式

```bash
node pkg/core/audit/audit-run.mjs --mode guide --dimension direction \
  --workspace <ws> --guide-config <MMCAS_HOME>/guide.json --confirm
```

- `direction`：整体方向与关键路径；`model`：更强数学模型（公式级）；`code`：算法/实现路线。
- 报告落到工作区 `guidance/GUIDE-<维度>-<时间>.md`，并生成 meta。
- 面板「指导室」可直接发起、查看状态与编辑 `guide.json`。

## 配置

复制 `config.example.json` 为 `<MMCAS_HOME>/guide.json`，或直接在面板「指导室」配置：

- `endpoint`：任意 OpenAI 兼容端点；默认本地 `codex-bridge`（3220）。
- `model`：更强的专家模型；默认 `gpt-6-astra`。
- `protocol`：`responses` 或 `chat`。
- `maxFeeCny`：单次预算阈值，超过需显式确认。
- `apiKeyEnv`：key 的环境变量名；key 仍写入 dsh `.credentials.yaml` 的 `refs`，不回显。

## 边界

- Guide 不接任务卡、不进调度、不直接改代码/论文。
- 只读材料、出建议；发现明确错误交给 Reviewer 正式审核。
- 默认只在人类/Master 显式发起时运行，不自动巡检。
