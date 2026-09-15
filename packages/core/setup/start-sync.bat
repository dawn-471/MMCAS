@echo off
:: 同步守护自启入口（复制到 shell:startup）
cd /d "%~dp0..\.."
for /d %%d in ("pkg\node\node-*") do set "NODEDIR=%%d"
set "PATH=%CD%\pkg\uv;%CD%\%NODEDIR%;%CD%\pkg\git\cmd;%PATH%"
start /min "" "%NODEDIR%\node.exe" "pkg\core\sync\sync-daemon.mjs" --config "%CD%\config\sync.config.json"
