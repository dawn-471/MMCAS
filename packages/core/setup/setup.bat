@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "FAILED="
set "WARNED="

:: ---------- 0. 管理员自提权（一次性；否则 msiexec/SSH 静默安装全部失败） ----------
net session >nul 2>&1
if errorlevel 1 (
  echo   需要管理员权限，正在弹窗... 请在弹窗中点"是"
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs -WorkingDirectory '%~dp0'"
  exit /b
)
echo   管理员权限 OK

echo ============================================
echo   MMCAS 安装程序（%ROLE%）
echo   请保持联网，全程约 3-5 分钟
echo ============================================

:: ---------- 1. Tailscale ----------
echo [1/9] 安装 Tailscale 并上线...
set "TSBIN=C:\Program Files\Tailscale\tailscale.exe"
if exist "%TSBIN%" (
  echo   Tailscale 已安装，跳过 MSI 安装
) else (
  if exist "pkg\tailscale.msi" (
    echo   安装中（静默，最长等待 60s）...
    start /wait msiexec /i "pkg\tailscale.msi" /qn
    set "MSIEXIT=!errorlevel!"
    :: 轮询等待 exe 就绪（最长 60s）
    for /l %%i in (1,1,12) do (
      if not exist "%TSBIN%" timeout /t 5 /nobreak >nul
    )
    if not exist "%TSBIN%" echo   msiexec 退出码 !MSIEXIT!（0=成功;1602=取消;1603/1618=被杀软拦截或安装失败）
  ) else (
    set "FAILED=!FAILED! [1]缺少tailscale.msi"
  )
)
if exist "%TSBIN%" (
  rem 已登录（有 Tailscale IP）则跳过上线——重装时 authkey 已消耗，硬跑 up 会报假失败
  "%TSBIN%" ip -4 >nul 2>&1
  if not errorlevel 1 (
    echo   Tailscale 已登录，跳过上线
  ) else (
    if exist "pkg\secrets\authkey.txt" (
      set /p AUTHKEY=<"pkg\secrets\authkey.txt"
      "%TSBIN%" up --authkey=!AUTHKEY! --hostname=mmcas-%ROLE%
      if errorlevel 1 (set "FAILED=!FAILED! [1]Tailscale上线") else (echo   OK)
    ) else (
      set "FAILED=!FAILED! [1]缺少authkey.txt"
    )
  )
) else (
  set "FAILED=!FAILED! [1]Tailscale安装失败(未找到exe，可能被杀软拦截或MSI安装失败)"
)

:: ---------- 2. SSH Server（第 0 步已提权，直接执行；失败仅 WARNED——SSH 为软依赖，装不上不影响协作核心） ----------
echo [2/9] 配置 SSH 服务（离线安装，秒级）...
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\pkg\core\enable-ssh.ps1"
if errorlevel 1 (set "WARNED=!WARNED! [2]SSH服务配置失败") else (echo   OK)

:: ---------- 3. PortableGit ----------
echo [3/9] 解压 Git...
"pkg\portablegit.exe" -y -o"pkg\git" >nul 2>&1
if not exist "pkg\git\cmd\git.exe" (set "FAILED=!FAILED! [3]Git解压") else (echo   OK)

:: ---------- 4. Node ----------
echo [4/9] 解压 Node...
powershell -NoProfile -Command "Expand-Archive -Force 'pkg\node.zip' 'pkg\node'" >nul 2>&1
for /d %%d in ("pkg\node\node-*") do set "NODEDIR=%%d"
if not defined NODEDIR (
  set "FAILED=!FAILED! [4]Node解压"
) else (
  set "PATH=%CD%\!NODEDIR!;%CD%\pkg\git\cmd;%PATH%"
  echo   OK
)

:: ---------- 5. uv（环境同步用） ----------
echo [5/9] 解压 uv...
if exist "pkg\uv.zip" (
  powershell -NoProfile -Command "Expand-Archive -Force 'pkg\uv.zip' 'pkg\uv'" >nul 2>&1
  if exist "pkg\uv\uv.exe" (
    set "PATH=%CD%\pkg\uv;%PATH%"
    echo   OK
  ) else (
    set "FAILED=!FAILED! [5]uv解压"
  )
) else (
  set "WARNED=!WARNED! [5]包内无uv.zip（环境同步不可用）"
  echo   -- 跳过
)

:: ---------- 6. SSH 配置（github 走 443 + deploy key）+ 克隆工作区 ----------
echo [6/9] 配置工作区访问...
mkdir "%USERPROFILE%\.ssh" 2>nul
set "SSHKEY=%CD%\pkg\secrets\id_ed25519"
set "SSHKEY=!SSHKEY:\=/!"
findstr /c:"Host github.com" "%USERPROFILE%\.ssh\config" >nul 2>&1
if errorlevel 1 (
  >> "%USERPROFILE%\.ssh\config" (
    echo Host github.com
    echo   HostName ssh.github.com
    echo   Port 443
    echo   IdentityFile !SSHKEY!
    echo   StrictHostKeyChecking accept-new
  )
)
set "REPO="
if exist "config\workspace-repo.txt" set /p REPO=<"config\workspace-repo.txt"
if not defined REPO (
  set "FAILED=!FAILED! [6]缺少仓库地址(config\workspace-repo.txt)"
) else (
  set "GIT_SSH_COMMAND=ssh -i !SSHKEY! -p 443 -o StrictHostKeyChecking=accept-new -o HostKeyAlias=github.com"
  if exist "workspace\.git" (
    echo   工作区已存在，跳过克隆
  ) else (
    if exist "workspace" rmdir /s /q workspace
    :: clone 显式指定 SSH 通道（GIT_SSH_COMMAND env），不依赖用户级 .ssh/config——
    :: 队友机器可能有旧 GitHub 配置干扰（findstr 去重只查 Host github.com 存在性，会漏）
    git clone -q !REPO! workspace 2>nul
    if not exist "workspace\.git" (
      if exist "workspace" rmdir /s /q workspace
      set "FAILED=!FAILED! [6]工作区克隆"
    ) else (
      :: repo 级持久化：echo 追加 [core] sshCommand（实测 cmd 下 git config 带空格值会 128，不可靠）
      :: sync-daemon 后续 fetch/push 走 repo config，同样不依赖用户级 config
      findstr /c:"sshCommand" "workspace\.git\config" >nul 2>&1
      if errorlevel 1 (
        >> "workspace\.git\config" (
          echo [core]
          echo     sshCommand = ssh -i !SSHKEY! -p 443 -o StrictHostKeyChecking=accept-new -o HostKeyAlias=github.com
        )
      )
      echo   OK
    )
  )
  set "GIT_SSH_COMMAND="
)

:: ---------- 7. dsh（版本锁定，避免上游漂移）+ codex CLI（PackyAPI 通道） ----------
echo [7/9] 安装 Agent 运行环境（dsh + codex）...
call npm config set registry https://registry.npmmirror.com >nul 2>&1
call npm install -g @deepseek-ai/dsh@0.1.2-rc.1 >nul 2>&1
call dsh --version >nul 2>&1
if errorlevel 1 (set "FAILED=!FAILED! [7]dsh安装") else (echo   dsh OK)
:: codex CLI：PackyAPI Codex 通道必需（体积约 380MB，首次安装需数分钟）
call npm install -g @openai/codex >nul 2>&1
call codex --version >nul 2>&1
if errorlevel 1 (set "WARNED=!WARNED! [7]codex安装失败（PackyAPI通道不可用，DeepSeek通道不受影响）") else (echo   codex OK)

:: ---------- 8. 配置生成 ----------
echo [8/9] 生成配置...
:: 独立 DSH_HOME（与队友日常/历史 dsh 物理隔离：会话/工作区/skills/settings 全独立）
set "MMDSH=%LOCALAPPDATA%\mmcas\dsh-home"
if exist "pkg\secrets\apikey.txt" (
  set /p APIKEY=<"pkg\secrets\apikey.txt"
  setx DEEPSEEK_API_KEY "!APIKEY!" >nul
)
node pkg\core\write-config.mjs --role %ROLE% --base "%CD%" --dsh-home "!MMDSH!"
if errorlevel 1 set "FAILED=!FAILED! [8]write-config"
:: PackyAPI Codex 通道（可选；缺 key 则跳过，不影响 DeepSeek 通道）
if exist "pkg\secrets\packy-key.txt" (
  set "PROXYARG="
  if exist "config\proxy.txt" for /f "usebackq delims=" %%p in ("config\proxy.txt") do set "PROXYARG=--proxy %%p"
  node pkg\core\codex-bridge\install-bridge.mjs --key-file "pkg\secrets\packy-key.txt" --dsh-home "!MMDSH!" !PROXYARG!
  if errorlevel 1 (set "WARNED=!WARNED! [8]PackyAPI通道配置失败") else (echo   PackyAPI 通道 OK)
) else (
  set "WARNED=!WARNED! [8]未预配 PackyAPI key（可选通道）"
)
if exist "pkg\secrets\apikey.txt" (
  node pkg\core\switch-provider.mjs switch deepseek --config "%CD%\config\providers.yaml" --settings "!MMDSH!\settings.yaml" --credentials "!MMDSH!\.credentials.yaml"
  if errorlevel 1 set "FAILED=!FAILED! [8]provider切换"
) else (
  set "WARNED=!WARNED! [8]未预配API key（请在页面填写）"
)
call npm install -g pnpm >nul 2>&1
call pnpm --version >nul 2>&1
if errorlevel 1 (set "WARNED=!WARNED! [8]pnpm安装失败") else (
  call pnpm config set registry https://registry.npmmirror.com >nul 2>&1
  echo   pnpm OK
)
if not exist "!MMDSH!\profiles\web" (
  set "FAILED=!FAILED! [8]web profile 缺失"
) else (
  pushd "!MMDSH!\profiles\web"
  call pnpm install >nul 2>&1
  if errorlevel 1 set "FAILED=!FAILED! [8]web profile 依赖安装（面板插件不可用，可手动 cd profiles\web 后 pnpm install）"
  popd
)
:: 设备信息上报（Master 运维需要用户名，随 git 同步）
if exist "workspace\docs" (
  (
    echo # 设备信息（setup 自动生成，供维护者运维使用）
    echo.
    echo - 角色: %ROLE%
    echo - Windows 用户名: %USERNAME%
    echo - 主机名: %COMPUTERNAME%
    echo - 装机时间: %DATE% %TIME%
  ) > "workspace\docs\device-info-%ROLE%.md"
)
echo   OK

:: ---------- 9. 自启 + 快捷方式 ----------
echo [9/9] 配置开机自启与快捷方式...
:: 自启用快捷方式（直接拷 bat 到 Startup 后 %~dp0 会变成 Startup 目录，找不到包路径）
del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\start-sync.bat" >nul 2>&1
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s1 = $ws.CreateShortcut([Environment]::GetFolderPath('Startup') + '\MMCAS-Sync.lnk'); $s1.TargetPath = '%CD%\pkg\core\start-sync.bat'; $s1.WorkingDirectory = '%CD%'; $s1.WindowStyle = 7; $s1.Save(); $s2 = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\MMCAS-Agent.lnk'); $s2.TargetPath = '%CD%\pkg\core\start-agent.bat'; $s2.WorkingDirectory = '%CD%'; $s2.Save()"
if errorlevel 1 (set "FAILED=!FAILED! [9]快捷方式") else (echo   OK)

echo ============================================
if defined FAILED echo   安装完成，但以下步骤失败：!FAILED!
if defined FAILED echo   请截图发给维护者
if not defined FAILED echo   安装完成！桌面双击 MMCAS-Agent 打开助手页面
if defined WARNED echo   提示：!WARNED!
echo ============================================
pause
