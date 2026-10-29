@echo off
:: 启动 dsh 桌面端（Electron）——使用 MMCAS 独立 DSH_HOME 与已装配的 desktop profile。
:: 注意：官方开始菜单快捷方式默认读取 %USERPROFILE%\.dsh；要走 MMCAS 面板/人格，
::      请使用本启动器（或把 DSH_HOME 设为 %LOCALAPPDATA%\mmcas\dsh-home 后再启动）。
cd /d "%~dp0..\.."
for /d %%d in ("pkg\node\node-*") do set "NODEDIR=%%d"
set "PATH=%CD%\pkg\uv;%CD%\%NODEDIR%;%CD%\pkg\git\cmd;%PATH%"
set "DSH_HOME=%LOCALAPPDATA%\mmcas\dsh-home"

:: 确保同步守护在跑（心跳新鲜 <=180s 视为存活，不重复拉起）
set "SYNCSTATE=%LOCALAPPDATA%\mmcas\logs\sync.state.json"
powershell -NoProfile -Command "if ((Get-Item '%SYNCSTATE%' -ErrorAction SilentlyContinue) -and ((Get-Date) - (Get-Item '%SYNCSTATE%').LastWriteTime).TotalSeconds -lt 180) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo [mmcas] 启动同步守护...
  start /b cmd /c "node %CD%\pkg\core\sync\sync-daemon.mjs --config %LOCALAPPDATA%\mmcas\sync.config.json >> %LOCALAPPDATA%\mmcas\logs\sync-agent.log 2>&1"
)

:: 先确保 PackyAPI Codex 桥接服务在跑（失败不阻塞桌面启动）
call "%~dp0start-bridge.bat" >nul 2>&1

set "DSHEXE="
if exist "%LOCALAPPDATA%\Programs\DeepSeek Harness\DeepSeek Harness.exe" set "DSHEXE=%LOCALAPPDATA%\Programs\DeepSeek Harness\DeepSeek Harness.exe"
if not defined DSHEXE if exist "%ProgramFiles%\DeepSeek Harness\DeepSeek Harness.exe" set "DSHEXE=%ProgramFiles%\DeepSeek Harness\DeepSeek Harness.exe"
if not defined DSHEXE if exist "%ProgramFiles(x86)%\DeepSeek Harness\DeepSeek Harness.exe" set "DSHEXE=%ProgramFiles(x86)%\DeepSeek Harness\DeepSeek Harness.exe"
if not defined DSHEXE (
  echo [mmcas] 未找到 DeepSeek Harness 桌面端。请先安装桌面端，或使用 MMCAS-Agent 打开 web 端。
  pause
  exit /b 1
)

tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" 2>nul | find /I "DeepSeek Harness.exe" >nul
if not errorlevel 1 (
  echo [mmcas] 桌面端已在运行。请先完全退出（托盘退出），再用本启动器启动，以确保使用 MMCAS DSH_HOME。
  pause
  exit /b 0
)

echo [mmcas] 启动桌面端（DSH_HOME=%DSH_HOME%）...
start "" "%DSHEXE%"
exit /b 0
