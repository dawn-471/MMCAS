@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "OUT=诊断结果.txt"
(
echo === MMCAS 诊断报告 %DATE% %TIME% ===
echo [1] 包目录: %CD%
echo [2] 包内文件检查:
for %%f in (pkg\tailscale.msi pkg\portablegit.exe pkg\node.zip pkg\uv.zip pkg\openssh.zip pkg\secrets\authkey.txt pkg\secrets\id_ed25519 pkg\secrets\master.pub pkg\secrets\apikey.txt pkg\secrets\packy-key.txt) do (
  if exist "%%f" (
    echo   OK  %%~nxf  %%~zf 字节
  ) else (
    echo   缺失  %%f
  )
)
echo [3] Tailscale 安装状态:
if exist "C:\Program Files\Tailscale\tailscale.exe" (
  echo   exe 已安装
  "C:\Program Files\Tailscale\tailscale.exe" status >nul 2>&1
  if errorlevel 1 (
    echo   状态: 未上线或异常
  ) else (
    echo   状态: 正常
  )
) else (
  echo   exe 不存在
)
echo [4] PortableGit 解压:
if exist "pkg\git\cmd\git.exe" (echo   OK) else (echo   缺失)
echo [5] ssh 配置:
findstr /c:"Host github.com" "%USERPROFILE%\.ssh\config" >nul 2>&1
if errorlevel 1 (echo   未配置) else (echo   已配置)
echo [6] 网络测试 - ssh github 443 8 秒超时:
if exist "pkg\git\cmd\ssh.exe" (
  "pkg\git\cmd\ssh.exe" -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -p 443 -T git@ssh.github.com 2>&1
) else (
  echo   ssh.exe 缺失
)
echo [7] 工作区目录:
if exist "workspace\.git" (echo   完整克隆)
if not exist "workspace\.git" if exist "workspace" (echo   存在但不完整)
if not exist "workspace" (echo   无)
echo [8] DeepSeek key:
if defined DEEPSEEK_API_KEY (echo   已设置) else (echo   未设置)
echo [9] 桌面快捷方式:
if exist "%USERPROFILE%\Desktop\MMCAS-Agent.lnk" (echo   存在) else (echo   无)
echo [10] OpenSSH 服务:
powershell -NoProfile -Command "try{$s=Get-Service sshd -ErrorAction Stop; '服务 '+$s.Status.ToString()}catch{'未安装'}" 2>&1
echo [11] 系统信息:
ver
echo ================== 结束 ==================
) > "%CD%\诊断结果.txt" 2>&1
type "%CD%\诊断结果.txt"
echo.
echo 诊断结果已保存: %CD%\诊断结果.txt
pause
