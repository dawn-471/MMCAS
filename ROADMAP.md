# Roadmap

> 本文件与 GitHub 的 [Milestones](https://github.com/dawn-471/MMCAS/milestones) / Issues 同步维护。
> 当前版本：**v1.3（dsh 0.2.1 适配版，2026-10-29）**　下一目标：**v1.4（候选方向见下）**

## v1.3 · dsh 0.2.1 适配（已完成，2026-10-29）

- [x] **CLI + 桌面端统一适配 dsh 0.2.1-rc.3**：profile / preset / 会话注入链路回归
- [x] **profile 合并式配置**：`write-config` / `switch-provider` / `install-bridge` 按条合并 `cordis.patch.yml`，保留 dsh 设置、已装插件与自定义 panel 端口
- [x] **桌面端接入**：`MMCAS-Desktop` 启动器、独立 `DSH_HOME`、`profiles/desktop` 自动生成、面板固定 19398
- [x] **standard preset 0.2.1 同步**：加入 `time-context` / `tool-schedule`，移除 `backgroundMode` / `tool-ralph` / 旧 subagent 行
- [x] **Reviewer 配置迁移**：审阅室改用 MMCAS 自有 `reviewer.json`；旧 `settings.yaml` / `.imported` 只读兼容
- [x] **稳定性修复**：冷会话 `prompt` signal、目标会话活跃度、审计报告唯一文件名、credentials `refs` 安全写入、New Session 本地化匹配
- [x] **回归**：poller 47、audit 16、profile-patch 16、switch-provider 全部通过；notices / taskcard / sync 回归通过

## v1.2 · 实战修订（已完成，2026-09-16 发布）

- [x] **调度核心**：面板合并（自动接取轮询器 + 看板 30s git 同步）、修复重复/过期派发、去掉 WIP 硬限制（依赖门控为准）、补齐轮询器回归测试
- [x] **会话与上下文**：启用 dsh 内置压缩（compaction）三件套；新任务自动开新会话接取、打回回原会话续做；上下文水位告警
- [x] **跨端通道与治理**：消息层（裁决请求 / 错误上报 / 停止指令）、回程卡（成员 → Master 的问题卡）、打回机制强化（原因必填 + 通知 + 追溯）
- [x] **Reviewer（审阅人）**：一键对数学模型 / 代码 / 论文成品做第四方独立审阅；通道可配置（本地桥或任意 OpenAI 兼容端点，responses/chat 双协议）
- [x] **同步基建**：sync-daemon v0.2.1 收口与下发、迁移自检（repo 配置刷新）、守护看门狗、凭据额度可见
- [x] **打包发布**：出厂默认项统一（模型目录 / 视觉能力）、三端重打包与升级流程验证

## 更远（v1.4 候选方向）

- 向量化记忆检索（sqlite-vec）
- Agent 间直连通道（A2A）
- 面板内完整 Web 终端
- 更多角色化技能与审计维度

---

## English

- Current: **v1.3** (dsh 0.2.1 compatibility, 2026-10-29). Next: **v1.4** (candidates below).
- **v1.3 (shipped)**: full dsh 0.2.1 support for CLI and Desktop; merge-based profile configuration; one-click Desktop onboarding (`MMCAS-Desktop`, isolated `DSH_HOME`, panel 19398); standard preset sync (`time-context` / `tool-schedule`); reviewer config migration to `reviewer.json` with legacy `settings.yaml` / `.imported` compatibility; cold-session injection, target-session activity, audit report naming, credentials refs, and localized New Session fixes; full regression.
- **v1.2 (shipped)**: scheduler core hardening (auto-claim poller into the mainline, fix duplicate/stale dispatch, remove the hard WIP cap, regression tests); sessions & context (enable built-in compaction, per-task session lifecycle, context waterline warnings); cross-end messaging & governance (notices, stop commands, return cards, rework flow); independent audit instance (one-click third-party audits via a local bridge); sync infra (v0.2.1 rollout, migration self-check, watchdog); packaging & defaults.
- **Later (v1.4 candidates)**: vector memory search, direct agent-to-agent channel, full in-panel web terminal, more role skills & audit dimensions.
