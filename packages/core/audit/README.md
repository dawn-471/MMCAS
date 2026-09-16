# MMCAS 独立审计（packages/core/audit/）

三端随时可发起的第三方独立审计：对**数学模型 / 代码成品 / 最终论文**三类产物，
经本地 codex-bridge（真实 Codex 客户端 → 较强专家模型）出具审计报告。
（通用化自 B-Audit 实战工具链；2026-09-13 两轮实跑标定：≈¥7 / 10 万字符。）

## 组成

- `audit-run.mjs` — 运行器：材料收集 → 脱敏 → payload 组装 → bridge（Responses SSE）→ 报告 + meta
- `instructions/{model,code,paper}.md` — 三个维度的审计员提示词模板
- （面板）三端「审计室」按钮 → 选维度 → 运行 → 报告落 `<ws>/audit/` + notices 通知

## 配置（Reviewer 自由度）

在 dsh 设置（`<DSH_HOME>/settings.yaml`）中维护 `reviewer:` 段——换专家模型只改这里：

```yaml
reviewer:
  endpoint: http://127.0.0.1:3220/v1/responses   # 任意 OpenAI 兼容完整 URL
  apiKeyEnv: REVIEWER_API_KEY                     # key 存入 .credentials.yaml 的 refs
  model: gpt-6-astra
  protocol: responses                             # responses | chat（chat/completions）
  maxFeeCny: 30                                   # 预算守门阈值
```

- 优先级：CLI 参数 > `settings.reviewer` > 内置默认（本地桥 / gpt-6-astra）
- 面板「审阅室」可直接读写该配置（key 经密码框写入 credentials，不回显）
- `node audit-run.mjs --show-config` 查看当前解析结果（不含 key 值）

## CLI 用法

```bash
node audit-run.mjs --dimension model --workspace <ws> [--dry-run] [--confirm]
node audit-run.mjs --dimension code  --workspace <ws> --files mylist.txt
```

- 缺省材料按维度白名单收集：model→`workspace/modeling+analysis`；code→`workspace/code`；paper→`workspace/paper`
  （仅文本扩展名、单文件 ≤512KB、跳过 .git/sim/archives 等）。
- `--dry-run` 只打包 + 估算；估算费用 > ¥30 需 `--confirm`。
- 报告头部记录：模型 / 材料规模 / 实测 tokens / 耗时 / 估算费用；meta 同目录 `.meta.json`。
- 无桥环境（bridge 不可达）明确失败并给错误，不静默。

## 纪律

- 只发**正文文本类材料**；脱敏内置（Windows 用户路径 / 邮箱 / 手机号），可用 `--scrub rules.txt` 追加 `正则||替换`。
- 材料边界：不发送原始二进制数据包；必要时先人工摘编。
- 大调用沿用 B-Audit 纪律：不干扰生产服务（桥本身即生产通道，审计为串行使用）。
