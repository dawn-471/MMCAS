# MMCAS 专家运行器（Guide / Reviewer）

共享运行器 `audit-run.mjs`，两种模式：

- **Reviewer（审核者）**：只审**数学模型 / 代码成品**，查假设、推导、数值正确性、可复现性与代码-结论一致性；不评写作/排版。
- **Guide（指导者）**：用更强/更贵的专家模型判断方向、关键路径，给出 2–3 条模型/算法攻坚路线与分工；不执行具体工作。

（通用化自 B-Audit 实战工具链；2026-09-13 两轮实跑标定：≈¥7 / 10 万字符。）

## 组成

- `audit-run.mjs` — 共享运行器：材料收集 → 脱敏 → payload → 专家端点（Responses SSE / chat）→ 报告 + meta
- `packages/reviewer/instructions/{model,code,paper}.md` — Reviewer 提示词（paper 仅 CLI 兼容）
- `packages/guide/instructions/{direction,model,code}.md` — Guide 提示词
- （面板）「审核室」/「指导室」→ 选维度 → 运行 → 报告落 `<ws>/audit/` 或 `<ws>/guidance/` + notices 通知

## 配置

- Reviewer：`<MMCAS_HOME>/reviewer.json`（模板 `packages/reviewer/config.example.json`）
- Guide：`<MMCAS_HOME>/guide.json`（模板 `packages/guide/config.example.json`）

```json
{
  "version": 1,
  "endpoint": "http://127.0.0.1:3220/v1/responses",
  "apiKeyEnv": "REVIEWER_API_KEY",
  "model": "gpt-6-astra",
  "protocol": "responses",
  "maxFeeCny": 30
}
```

- `endpoint` 任意 OpenAI 兼容完整 URL；`protocol` 为 `responses` 或 `chat`；key 存 dsh `.credentials.yaml` 的 `refs`。
- 优先级：CLI 参数 > 对应 JSON 配置 > 旧 `settings.yaml` 的 `reviewer:` 段（仅 Reviewer，只读兼容）> 内置默认（本地桥 / gpt-6-astra）。
- 面板「审核室」/「指导室」可直接读写配置（key 经密码框写入 credentials，不回显）。
- `node audit-run.mjs --mode guide --show-config --guide-config <path>` 查看解析结果（不打印 key）。

## CLI 用法

```bash
# Reviewer（模型/代码，A/B/C 分级 + 证据）
node audit-run.mjs --mode reviewer --dimension model --workspace <ws> [--dry-run] [--confirm]
node audit-run.mjs --mode reviewer --dimension code  --workspace <ws> --files mylist.txt

# Guide（方向/模型/实现路线）
node audit-run.mjs --mode guide --dimension direction --workspace <ws> --guide-config <MMCAS_HOME>/guide.json
node audit-run.mjs --mode guide --dimension model --workspace <ws>
node audit-run.mjs --mode guide --dimension code  --workspace <ws>
```

- Reviewer 缺省材料：model→`workspace/modeling+analysis`；code→`workspace/code`；paper→`workspace/paper`（仅 CLI）。
- Guide 缺省材料：direction→`tasks + workspace/modeling + analysis + code + paper`；model→模型/分析/代码/论文；code→代码+模型。
- `--dry-run` 只打印 + 估算；超过配置阈值需 `--confirm`。
- 报告头部记录：模式 / 维度 / 模型 / 材料规模 / 实测 tokens / 耗时 / 估算费用；meta 同目录 `.meta.json`。
- 无桥环境明确失败并给错误，不静默。

## 纪律

- 只在被请求时运行；一次请求一个工作项；本端串行，不自动巡检、不自动改任务卡。
- 只发**正文文本类材料**；脱敏内置（Windows 用户路径 / 邮箱 / 手机号），可用 `--scrub rules.txt` 追加 `正则||替换`。
- 材料边界：不发送原始二进制数据包；必要时先人工摘编。
- 大调用沿用 B-Audit 纪律：不干扰生产服务（桥本身即生产通道，专家调用为串行使用）。
- 报告是交付物：完成/失败/预算超限才通知；正常运行不产生噪音。
