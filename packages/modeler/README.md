# pkg-modeler（建模手，Master）

建模手的角色包。设备：自备台式机（含独立显卡）。

## 职责

- 问题分析、模型选择与假设管理
- 任务卡创建与分派（**仅 Master 可创建任务卡**）
- 全局决策（模型方向、结论口径），关键结论终审
- 文献与知识库管理

## v1.2 增量（总控与治理）

- **总控看板新增**：同步守护心跳（停滞告警）、上下文水位（近 3 会话）、消息区（notices 收发与 ack）、审计室入口。
- **打回机制**：done→todo 打回必须填原因（自动批注 + `rework` 计数 + 清通知）；面板「打回（需填原因）」按钮。
- **停止指令**：卡详情「停止该方向」一键发送 `kind=stop`（对卡/方向 steer 打断目标端）。
- **收件箱**：接收 coder/writer 回程卡（`origin && todo`），一键转正式卡。
- **独立审计**：三端任一可发起；报告落 `workspace/audit/` 并默认通知你；审计室显示本地桥健康（额度/鉴权一眼可见）。

## 内容

- `role.md`：建模手人格与协作纪律（装机时注入 dsh profile persona；`{CORE}`/`{WORKSPACE}` 占位符由 write-config 替换）
- `skills/`：建模全流程、模型决策矩阵、对抗自检（含 cookbook/playbook/legacy knowledge）
