@echo off
:: 启动 codex-bridge（PackyAPI Codex 通道桥接服务）
:: 幂等：已在运行则直接退出。日志见 %LOCALAPPDATA%\mmcas\logs\codex-bridge.log
cd /d "%~dp0..\.."
for /d %%d in ("pkg\node\node-*") do set "NODEDIR=%%d"
set "PATH=%CD%\%NODEDIR%;%PATH%"
set "MMCAS_HOME=%LOCALAPPDATA%\mmcas"

if not exist "%MMCAS_HOME%\codex-bridge.json" (
  echo [codex-bridge] 未找到配置 %MMCAS_HOME%\codex-bridge.json
  echo [codex-bridge] 请先运行 install-bridge（setup.bat 会自动完成）
  exit /b 1
)

:: 读端口
set "PORT=3220"
for /f "tokens=2 delims=:, " %%p in ('findstr /C:"\"port\"" "%MMCAS_HOME%\codex-bridge.json"') do set "PORT=%%p"

:: 已在运行则跳过
curl -s -m 2 "http://127.0.0.1:%PORT%/health" >nul 2>&1
if not errorlevel 1 (
  echo [codex-bridge] 已在运行（端口 %PORT%）
  exit /b 0
)

start "MMCAS codex-bridge" /min node "%CD%\pkg\core\codex-bridge\codex-bridge.mjs" --config="%MMCAS_HOME%\codex-bridge.json"
echo [codex-bridge] 已启动（端口 %PORT%，日志 %MMCAS_HOME%\logs\codex-bridge.log）
exit /b 0
