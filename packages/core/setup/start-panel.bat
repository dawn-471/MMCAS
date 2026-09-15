@echo off
:: 总控面板：生成并打开（本地渲染器，无服务器）
cd /d "%~dp0..\.."
for /d %%d in ("pkg\node\node-*") do set "NODEDIR=%%d"
"%NODEDIR%\node.exe" pkg\core\panel\panel.mjs --workspace "%CD%\workspace" --out "%CD%\panel.html"
start "" "%CD%\panel.html"
