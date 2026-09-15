# MMCAS enable-ssh.ps1（由 setup.bat 以管理员权限调用；全部幂等）
# OpenSSH 安装：优先系统内置组件（秒级检测），否则用包内离线版（Win32-OpenSSH zip，不依赖 Windows Update）
$ErrorActionPreference = 'Continue'
# 0. sshd 服务存在性
$svc = Get-Service sshd -ErrorAction SilentlyContinue
if (-not $svc) {
  $cap = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' -ErrorAction SilentlyContinue
  if ($cap -and ($cap | Select-Object -First 1).State -eq 'Installed' -and (Test-Path "$env:Windir\System32\OpenSSH\sshd.exe")) {
    Write-Output '  使用 Windows 内置 OpenSSH（已安装）'
  } else {
    Write-Output '  从包内离线安装 OpenSSH（解压 + 注册服务）...'
    $dst = "$env:ProgramFiles\OpenSSH-Win64"
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
    $tmp = "$env:ProgramFiles\ssh-inst-tmp"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive -Path "$PSScriptRoot\..\..\pkg\openssh.zip" -DestinationPath $tmp -Force
    Move-Item "$tmp\OpenSSH-Win64" $dst -Force
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    & "$dst\install-sshd.ps1" | Out-Null
  }
}
# 1. 固定 sshd_config（含 Match Group administrators -> administrators_authorized_keys）
New-Item -ItemType Directory -Force "$env:ProgramData\ssh" | Out-Null
Copy-Item -Force "$PSScriptRoot\sshd_config.template" "$env:ProgramData\ssh\sshd_config"
# 2. Master 公钥幂等注入
$kp = (Get-Content -Raw -ErrorAction SilentlyContinue "$PSScriptRoot\..\secrets\master.pub").Trim()
if ($kp) {
  $authFile = "$env:ProgramData\ssh\administrators_authorized_keys"
  if (-not (Test-Path $authFile) -or -not (Get-Content $authFile -Raw -ErrorAction SilentlyContinue).Contains($kp)) {
    Add-Content -Path $authFile -Value $kp
    Write-Output '  Master 公钥已注入'
  } else {
    Write-Output '  Master 公钥已存在'
  }
} else {
  Write-Output '  WARN: 包内缺 master.pub，Master 无法 SSH 控制'
}
# 2b. 密钥文件权限修正（Win32-OpenSSH 严格检查：仅 Administrators/SYSTEM 可写，否则拒绝读取密钥）
& icacls "$env:ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" 2>$null | Out-Null
& icacls "$env:ProgramData\ssh\sshd_config" /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" 2>$null | Out-Null
# 3. 防火墙规则幂等（仅限 Tailscale 网段 22 端口）
if (-not (Get-NetFirewallRule -Name 'SSH-over-Tailscale' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -Name 'SSH-over-Tailscale' -DisplayName 'SSH over Tailscale' -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow -RemoteAddress 100.64.0.0/10 | Out-Null
  Write-Output '  防火墙规则已创建'
} else {
  Write-Output '  防火墙规则已存在'
}
# 4. 服务自启 + 启动
Set-Service sshd -StartupType Automatic -ErrorAction SilentlyContinue
Start-Service sshd -ErrorAction SilentlyContinue
Write-Output '  SSH 服务就绪'
