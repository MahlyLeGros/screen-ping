#Requires -Version 5.1
$ErrorActionPreference = "Continue"
. "$PSScriptRoot\deploy.config.ps1"
Import-Module Posh-SSH

$secure = ConvertTo-SecureString $DeployVpsPassword -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($DeployVpsUser, $secure)
$session = New-SSHSession -ComputerName $DeployVpsHost -Credential $credential -AcceptKey

$commands = @(
    "test -f $DeployRemotePath/web/dist/index.html && echo WEB_OK || echo WEB_MISSING",
    "head -3 $DeployRemotePath/web/dist/index.html 2>/dev/null",
    "cd $DeployRemotePath && docker compose ps",
    "cd $DeployRemotePath && docker compose logs server --tail 60",
    "curl -s -w '\nLOCAL_HTTP:%{http_code}\n' http://127.0.0.1:8000/api/media/capabilities",
    "curl -s -w '\nLOCAL_ROOT:%{http_code}\n' http://127.0.0.1:8000/",
    "sudo cat /etc/nginx/sites-enabled/screenping 2>/dev/null || sudo cat /etc/nginx/sites-enabled/default 2>/dev/null | head -40",
    "sudo nginx -t 2>&1"
)

foreach ($cmd in $commands) {
    Write-Host ""
    Write-Host "=== $cmd ===" -ForegroundColor Cyan
    $r = Invoke-SSHCommand -SessionId $session.SessionId -Command $cmd -TimeOut 120
    if ($r.Output) { $r.Output }
    if ($r.Error) { $r.Error | ForEach-Object { Write-Host $_ -ForegroundColor Yellow } }
}

Remove-SSHSession -SessionId $session.SessionId | Out-Null
