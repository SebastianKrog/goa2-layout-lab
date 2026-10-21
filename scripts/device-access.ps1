#Requires -RunAsAdministrator
param([ValidateRange(1024,65535)][int]$Port = 3300, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$ruleName = "GoA2-Lab-Device-$Port"
Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if (-not $Remove) {
    New-NetFirewallRule -Name $ruleName -DisplayName "GoA2 layout lab device views ($Port)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet -Profile Private | Out-Null
    Write-Output "Layout lab device views allowed on private LAN port $Port."
}
