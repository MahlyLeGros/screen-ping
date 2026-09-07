#Requires -Version 5.1
$ErrorActionPreference = "Continue"
. "$PSScriptRoot\deploy.config.ps1"
Import-Module Posh-SSH
$secure = ConvertTo-SecureString $DeployVpsPassword -AsPlainText -Force
$credential = New-Object PSCredential($DeployVpsUser, $secure)
$s = New-SSHSession -ComputerName $DeployVpsHost -Credential $credential -AcceptKey
$cmds = @(
  "ls -la $DeployRemotePath/server/app/routes/media.py 2>&1",
  "grep -c avatar_upload $DeployRemotePath/server/app/routes/media.py 2>&1 || echo NO_MATCH",
  "grep -c SERVE_SPA $DeployRemotePath/docker-compose.yml 2>&1 || echo NO_COMPOSE",
  "cd $DeployRemotePath && docker compose ps 2>&1",
  "cd $DeployRemotePath && docker compose exec -T server head -20 /app/app/routes/media.py 2>&1",
  "curl -s http://127.0.0.1:8000/api/media/capabilities 2>&1",
  "curl -s http://127.0.0.1:8000/health 2>&1"
)
foreach ($c in $cmds) {
  Write-Host "`n=== $c ===" -ForegroundColor Cyan
  $r = Invoke-SSHCommand -SessionId $s.SessionId -Command $c -TimeOut 120
  if ($r.Output) { $r.Output }
  if ($r.Error) { $r.Error | ForEach-Object { Write-Host $_ -ForegroundColor Yellow } }
  Write-Host "exit: $($r.ExitStatus)"
}
Remove-SSHSession -SessionId $s.SessionId | Out-Null
