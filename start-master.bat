@echo off
:: MMCAS Master 一键启动：建模手 dsh（独立会话）+ 指挥中心面板 + 同步守护
cd /d "%~dp0"
if not exist logs mkdir logs
:: 拉起同步守护（与本次终端同生命周期：关闭本窗口即终止；单实例锁防重复启动）
start /b cmd /c "node packages\core\sync\sync-daemon.mjs --config %LOCALAPPDATA%\mmcas\sync.config.json >> logs\sync-master.log 2>&1"
:: 拉起 codex-bridge（PackyAPI Codex 通道桥接；已在运行则跳过）
curl -s -o nul -m 2 http://127.0.0.1:3220/health
if errorlevel 1 start /b cmd /c "node packages\core\codex-bridge\codex-bridge.mjs --config=%LOCALAPPDATA%\mmcas\codex-bridge.json >> logs\codex-bridge-master.log 2>&1"
:: 若 3199 未在运行则启动 dsh（401=已运行鉴权中，也算在跑；输出进日志）
curl -s -o nul -w "%%{http_code}" -m 2 http://127.0.0.1:3199 | findstr /r "^2 ^401" >nul
if errorlevel 1 (
  echo 启动建模手 dsh...
  start /b cmd /c "set DSH_HOME=%LOCALAPPDATA%\mmcas\dsh-home&& dsh --profile mmcas-modeler --no-open > logs\dsh-master.log 2>&1"
)
node scripts\start-master.mjs
pause
