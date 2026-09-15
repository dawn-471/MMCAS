# pkg-coder（编程手）

编程手的角色包。设备：高性能台式机（队伍最强算力，承担全部长计算；轻量设备不运行 agent）。

## 职责

- 按任务卡实现代码、跑实验、产出数据与图表
- 环境管理（uv / Python），产出物提交工作区
- 结果可复现：环境版本、随机种子、数据版本记录在任务卡

## 内容

- `role.md`：编程手人格与协作纪律（装机时注入 dsh profile persona；`{CORE}`/`{WORKSPACE}` 占位符由 write-config 替换）
- `skills/`：实现纪律、数值坑清单、复现工程、12 个建模场景 playbook
