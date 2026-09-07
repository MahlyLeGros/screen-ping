#Requires -Version 5.1
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\deploy.config.ps1"
Import-Module Posh-SSH

$secure = ConvertTo-SecureString $DeployVpsPassword -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($DeployVpsUser, $secure)
$session = New-SSHSession -ComputerName $DeployVpsHost -Credential $credential -AcceptKey

$commands = @(
    "cd $DeployRemotePath && docker compose up -d",
    "cd $DeployRemotePath && docker compose ps",
    "cd $DeployRemotePath && docker compose logs server --tail 40",
    "curl -s -w '\nLOCAL_HTTP:%{http_code}\n' http://127.0.0.1:8000/api/media/capabilities"
)

foreach ($cmd in $commands) {
    Write-Host ""
    Write-Host "=== $cmd ===" -ForegroundColor Cyan
    $r = Invoke-SSHCommand -SessionId $session.SessionId -Command $cmd -TimeOut 180
    if ($r.Output) { $r.Output }
    if ($r.Error) { $r.Error | ForEach-Object { Write-Host $_ -ForegroundColor Yellow } }
}

Remove-SSHSession -SessionId $session.SessionId | Out-Null
