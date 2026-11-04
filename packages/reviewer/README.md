# Reviewer（审核者）

MMCAS 的独立审核角色：只审**数学模型**与**代码成品**，不评写作与排版。报告按 A（必须修正）/ B（建议优化）/ C（结构性替代）分级，并要求每条结论给出材料依据。

## 使用方式

```bash
node pkg/core/audit/audit-run.mjs --mode reviewer --dimension model \
  --workspace <ws> --reviewer-config <MMCAS_HOME>/reviewer.json --confirm

node pkg/core/audit/audit-run.mjs --mode reviewer --dimension code \
  --workspace <ws> --reviewer-config <MMCAS_HOME>/reviewer.json --confirm
```

- 报告落到工作区 `audit/AUDIT-<维度>-<时间>.md`。
- 面板「审核室」可直接发起、查看状态与编辑 `reviewer.json`。
- 旧版 `paper` 维度仅保留 CLI 兼容，面板不再展示。

## 配置

复制 `config.example.json` 为 `<MMCAS_HOME>/reviewer.json`，或直接在面板配置：

- `endpoint` / `model` / `protocol` / `maxFeeCny` / `apiKeyEnv` 与 Guide 相同。
- 默认走本地 `codex-bridge`（3220）的强专家模型；也可换任意 OpenAI 兼容端点。
- key 存 dsh `.credentials.yaml` 的 `refs`，面板不回显。

## 与 Guide 的分工

- **Guide**：往前看，指方向、定优先级、给路线。
- **Reviewer**：往回看，查模型/代码漏洞，给必须修正项。
- 两者都不接任务卡、不进调度、不直接改产物；报告通过面板/通知交给人类与三名执行手。
