@echo off
:: 启动 Agent 交互界面（dsh web）——独立 DSH_HOME，与队友日常/历史 dsh 物理隔离
cd /d "%~dp0..\.."
for /d %%d in ("pkg\node\node-*") do set "NODEDIR=%%d"
set "PATH=%CD%\pkg\uv;%CD%\%NODEDIR%;%CD%\pkg\git\cmd;%PATH%"
set "DSH_HOME=%LOCALAPPDATA%\mmcas\dsh-home"
:: 先确保 PackyAPI Codex 桥接服务在跑（失败不阻塞 dsh 启动）
call "%~dp0start-bridge.bat" >nul 2>&1
:: dsh 启动时会自动打开带 token 的正确页面（裸开 3080 会 401；打不开时控制台会打印 URL 可手动复制）
call dsh web
