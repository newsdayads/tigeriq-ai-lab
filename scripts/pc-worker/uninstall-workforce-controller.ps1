$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$TaskName = 'TigerIQ Workforce Controller'
$FirewallName = 'TigerIQ Workforce Controller (Tailscale)'
$RunnerPath = 'F:\TigerIQ\Worker\run-workforce-controller.ps1'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error 'ADMIN_REQUIRED: Run rollback once from an elevated PowerShell session.'
  exit 1
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
if (Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue) {
  Remove-NetFirewallRule -DisplayName $FirewallName
}
if (Test-Path $RunnerPath) { Remove-Item -LiteralPath $RunnerPath -Force }

[ordered]@{
  status = 'ROLLED_BACK'
  scheduledTaskRemoved = $true
  firewallRuleRemoved = $true
  runnerRemoved = -not (Test-Path $RunnerPath)
  workforceStateRetained = $true
  localCredentialSecretRetained = $true
} | ConvertTo-Json -Compress
