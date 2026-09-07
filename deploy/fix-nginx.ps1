#Requires -Version 5.1
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\deploy.config.ps1"
Import-Module Posh-SSH

$secure = ConvertTo-SecureString $DeployVpsPassword -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($DeployVpsUser, $secure)
$session = New-SSHSession -ComputerName $DeployVpsHost -Credential $credential -AcceptKey

$wwwRoot = "/var/www/screenping"
$cmd = "sudo mkdir -p $wwwRoot/desktop/updates && sudo rsync -a --delete --exclude 'desktop/' $DeployRemotePath/web/dist/ $wwwRoot/ && sudo chown -R www-data:www-data $wwwRoot && sudo chmod -R a+rX $wwwRoot && sudo cp $DeployRemotePath/nginx-screenping.conf /etc/nginx/sites-available/screenping && sudo ln -sf /etc/nginx/sites-available/screenping /etc/nginx/sites-enabled/screenping && sudo rm -f /etc/nginx/sites-enabled/default && sudo nginx -t && sudo systemctl reload nginx && echo NGINX_OK"

Write-Host "Fixing Nginx + publishing site to $wwwRoot ..." -ForegroundColor Cyan
$r = Invoke-SSHCommand -SessionId $session.SessionId -Command $cmd -TimeOut 120
if ($r.Output) { $r.Output }
if ($r.Error) { $r.Error | ForEach-Object { Write-Host $_ -ForegroundColor Yellow } }
if ($r.ExitStatus -ne 0) { throw "Nginx fix failed (exit $($r.ExitStatus))" }

Remove-SSHSession -SessionId $session.SessionId | Out-Null
Write-Host "Done. Hard-refresh https://screenping.xyz" -ForegroundColor Green
