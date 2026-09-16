@echo off
:: 启动 Agent 交互界面（dsh web）——独立 DSH_HOME，与日常/历史 dsh 物理隔离
cd /d "%~dp0..\.."
for /d %%d in ("pkg\node\node-*") do set "NODEDIR=%%d"
set "PATH=%CD%\pkg\uv;%CD%\%NODEDIR%;%CD%\pkg\git\cmd;%PATH%"
set "DSH_HOME=%LOCALAPPDATA%\mmcas\dsh-home"
:: v1.2 T5.3：确保同步守护在跑（心跳新鲜 ≤180s 视为存活，不重复拉起）
set "SYNCSTATE=%LOCALAPPDATA%\mmcas\logs\sync.state.json"
powershell -NoProfile -Command "if ((Get-Item '%SYNCSTATE%' -ErrorAction SilentlyContinue) -and ((Get-Date) - (Get-Item '%SYNCSTATE%').LastWriteTime).TotalSeconds -lt 180) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo [mmcas] 启动同步守护...
  start /b cmd /c "node %CD%\pkg\core\sync\sync-daemon.mjs --config %LOCALAPPDATA%\mmcas\sync.config.json >> %LOCALAPPDATA%\mmcas\logs\sync-agent.log 2>&1"
)
:: 先确保 PackyAPI Codex 桥接服务在跑（失败不阻塞 dsh 启动）
call "%~dp0start-bridge.bat" >nul 2>&1
:: v1.2 T5.5：3080 端口健康检查——已有实例时清晰提示（杜绝闪退无解释）
curl -s -o nul -w "%%{http_code}" -m 2 http://127.0.0.1:3080 | findstr /r "^2 ^401" >nul
if not errorlevel 1 (
  echo [mmcas] 3080 端口已有 dsh 实例在运行——无需重复启动。
  echo [mmcas] 直接使用已有窗口；如确认是残留进程：netstat -ano ^| findstr :3080 查 PID 后结束，再重试本脚本。
  pause
  exit /b 0
)
:: dsh 启动时会自动打开带 token 的正确页面（裸开 3080 会 401；打不开时控制台会打印 URL 可手动复制）
call dsh web
