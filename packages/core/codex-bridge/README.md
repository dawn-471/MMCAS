# codex-bridge — PackyAPI Codex 通道桥接

## 为什么需要它

PackyAPI 的 **codex 分组** key 有「反二次分发」检测：只接受标准 Codex 客户端，
直连（curl / OpenAI SDK / dsh 适配器）会被拦截：

```
我们检测到您的客户端存在异常，请使用标准 Codex 客户端请求……
```

实测记录：chat completions 报 `protocol_not_supported`；responses 协议直连被拦；
伪造 Codex 请求头 3 次中仅 2 次通过（不可靠）。**唯一稳定通道是真实 Codex CLI**。

本服务因此以真实 `codex exec` 为上游，对 dsh 暴露本地 OpenAI Responses 端点：

```
dsh (pi-ai 适配器) → http://127.0.0.1:3220/v1 → codex-bridge → codex exec --json → cf.api.fan
```

## 文件

| 文件 | 作用 |
|---|---|
| `codex-bridge.mjs` | 桥接服务本体（零依赖 Node，SSE 流式） |
| `install-bridge.mjs` | 一键写入全部配置（幂等） |
| `codex-bridge.example.json` | 服务配置模板 |

## 安装

`setup.bat` 自动完成（安装 codex CLI → 写 codex-home 凭据 → 写 dsh `llm-pi-ai` 段）。
手动安装：

```bat
node pkg\core\codex-bridge\install-bridge.mjs ^
  --key-file "pkg\secrets\packy-key.txt" ^
  --dsh-home "%USERPROFILE%\.dsh" ^
  --proxy http://127.0.0.1:7897
```

## 启动

```bat
pkg\core\start-bridge.bat
```

`start-agent.bat`（队友包）与 `start-master.bat`（Master 开发仓，2026-09-11 起）都会自动拉起它。健康检查：`curl http://127.0.0.1:3220/health`。

## 已知约束

- **需要代理**：PackyAPI 对部分地区返回 403「当前地区暂不支持访问模型」。
  **codex CLI 会自动读取 Windows 系统代理**——实测：系统代理开启时，无任何环境变量/配置也能正常调用（curl 直连同环境被拦，走代理成功，对比确认）。
  所以队友**只要开着代理客户端（系统代理开关或 TUN 模式）就无需任何额外配置**。
  仅当代理不走系统代理（如只装浏览器插件、或需要指定非默认端口）时，才把地址写进
  `%LOCALAPPDATA%\mmcas\codex-bridge.json` 的 `proxy` 字段（留空 = 跟随系统代理）。
- **每次调用固定 ~13K 输入 token**：Codex CLI 的系统提示开销（其中约 11K 命中缓存）。
- **模型白名单**：由 `%LOCALAPPDATA%\mmcas\codex-bridge.json` 的 `models` 字段决定（当前 `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` / `gpt-6-astra`；2026-09-11 实测四者均可经 codex 通道调用，名单外请求返回 400）。新增模型 = 改名单 + 重启 bridge。
- **工具桥接（v2.x，2026-09-11 起，端到端实测）**：桥接支持 function tools——工具 schema 渲染进 prompt，模型用 ```tool_call {"name":..., "arguments":{...}}``` 文本块表达调用，桥接转成 Responses `function_call`；dsh 执行后回传 `function_call_output`，再渲染回 prompt 继续。可靠性：三段式协议提醒（系统提示后详版 + 用户消息后紧贴版 + prompt 末尾版）+ few-shot 示例 + 反编造规则；未产出调用且输出疑似"被拦截"编造时**自动纠正重试一次**。**成本**：每轮工具调用 = 一次 `codex exec`（单轮约 5–15 秒 + 约 15–45K 输入 token，多数命中缓存）——多步任务的总耗时/成本随轮数线性增长；对速度敏感的复杂任务可仍用 deepseek 系。协议为文本级，极小概率模型不遵约时会退化为纯文本回复（日志可查 `自动纠正重试` 记录）。
- **只支持 responses 协议**：dsh 侧路由必须声明 `api: openai-responses`。
- **不做流式增量**：codex exec 一次性返回结果，桥接按其长度分块伪增量推送，
  以匹配 Responses SSE 形态（dsh 侧体验为「一次性出结果」）。
- **凭据不落库**：key 只存在于 `%LOCALAPPDATA%\mmcas\codex-home\auth.json`（仓外）。

## 端口

默认 3220。与 MMCAS 其他端口不冲突（3199/3200 dsh web、3210/3211 面板服务）。
