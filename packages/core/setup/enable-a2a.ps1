param([int]$Port = 19400)
$ErrorActionPreference = 'Stop'
$name = 'MMCAS-A2A-over-Tailscale'
Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
New-NetFirewallRule -Name $name -DisplayName 'MMCAS A2A over Tailscale' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -RemoteAddress 100.64.0.0/10 | Out-Null
Write-Output "A2A firewall OK (TCP $Port, Tailscale only)"
