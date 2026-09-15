@echo off
rem MMCAS SSH 一键修复 v3（右键"以管理员身份运行"；放在 MMCAS 包目录内，与 setup.bat 同级）
rem 注意：提权后 cwd=C:\Windows\System32，必须用 %~dp0 定位脚本目录（不能用 %CD%）
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 goto :needadmin
set "MP=%~dp0pkg\secrets\master.pub"
if not exist "%MP%" goto :nopkg
echo === 0. 身份信息（请截图） ===
whoami
echo USERNAME=%USERNAME%
echo USERPROFILE=%USERPROFILE%
echo === 0b. 本地用户列表 ===
net user
echo === 1. 目录准备 ===
if not exist "%ProgramData%\ssh" mkdir "%ProgramData%\ssh"
echo === 2. 注入 Master 公钥（管理员路径，幂等） ===
powershell -NoProfile -Command "$kp=(Get-Content -Raw '%MP%').Trim(); $af=Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'; if (-not (Test-Path $af) -or -not (Get-Content $af -Raw -EA SilentlyContinue).Contains($kp)) { Add-Content -Path $af -Value $kp; Write-Output 'ADMIN-INJECTED' } else { Write-Output 'ADMIN-EXISTS' }"
echo === 2b. 注入 Master 公钥（用户路径 ~/.ssh/authorized_keys，防 Match 段未生效） ===
powershell -NoProfile -Command "$kp=(Get-Content -Raw '%MP%').Trim(); $d=Join-Path $env:USERPROFILE '.ssh'; New-Item -ItemType Directory -Force $d | Out-Null; $uaf=Join-Path $d 'authorized_keys'; if (-not (Test-Path $uaf) -or -not (Get-Content $uaf -Raw -EA SilentlyContinue).Contains($kp)) { Add-Content -Path $uaf -Value $kp; Write-Output 'USER-INJECTED' } else { Write-Output 'USER-EXISTS' }"
echo === 3. 修正文件权限（sshd 严格检查：仅所有者和 SYSTEM 可写） ===
icacls "%ProgramData%\ssh\administrators_authorized_keys" /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" >nul 2>&1
if exist "%ProgramData%\ssh\sshd_config" icacls "%ProgramData%\ssh\sshd_config" /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" >nul 2>&1
icacls "%USERPROFILE%\.ssh\authorized_keys" /inheritance:r /grant "%USERNAME%:F" /grant "SYSTEM:F" >nul 2>&1
echo === 4. 重启 sshd 服务 ===
net stop sshd >nul 2>&1
net start sshd >nul 2>&1
sc query sshd | findstr /i "STATE"
echo === 5. 当前状态 ===
echo -- 管理员 authorized_keys 行数/内容:
powershell -NoProfile -Command "(Get-Content '%ProgramData%\ssh\administrators_authorized_keys' -EA SilentlyContinue).Count; Get-Content '%ProgramData%\ssh\administrators_authorized_keys' -EA SilentlyContinue"
echo -- 用户级 authorized_keys 行数/内容:
powershell -NoProfile -Command "(Get-Content '%USERPROFILE%\.ssh\authorized_keys' -EA SilentlyContinue).Count; Get-Content '%USERPROFILE%\.ssh\authorized_keys' -EA SilentlyContinue"
echo === 6. sshd 最近日志（认证失败原因） ===
powershell -NoProfile -Command "Get-WinEvent -LogName 'OpenSSH/Operational' -MaxEvents 6 -EA SilentlyContinue | ForEach-Object { $_.TimeCreated.ToString('HH:mm:ss') + ' ' + $_.Message }"
echo 修复完成，请把本窗口全部内容截图发给维护者
pause
exit /b

:needadmin
echo 请右键选择"以管理员身份运行"后重试
pause
exit /b

:nopkg
echo 找不到 %MP%
echo 请把本脚本放在 MMCAS 包目录内（与 setup.bat 同级）再运行
pause
exit /b
