#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$DeployDir = $PSScriptRoot
$Root = Resolve-Path (Join-Path $DeployDir "..")
. "$DeployDir\deploy.config.ps1"
Import-Module Posh-SSH

function Send-ScpFile {
    param([string]$VpsHost, [pscredential]$Credential, [string]$LocalFile, [string]$RemoteDir)
    $dir = ($RemoteDir.Replace("\", "/").TrimEnd("/") + "/")
    if (Get-Command Set-SCPFile -ErrorAction SilentlyContinue) {
        Set-SCPFile -ComputerName $VpsHost -Credential $Credential -LocalFile $LocalFile -RemotePath "$dir$(Split-Path $LocalFile -Leaf)" -AcceptKey
    } else {
        Set-SCPItem -ComputerName $VpsHost -Credential $Credential -Path $LocalFile -Destination $dir -AcceptKey
    }
}

Write-Host "Packaging server (tar)..." -ForegroundColor Cyan
$staging = Join-Path $env:TEMP "screenping-server-staging"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
$serverDest = Join-Path $staging "server"
New-Item -ItemType Directory -Path $serverDest -Force | Out-Null
Get-ChildItem -Path "$Root\server" -Force | Where-Object { $_.Name -notin @(".venv", "__pycache__", "uploads", ".env") } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $serverDest -Recurse -Force
}
Copy-Item "$Root\docker-compose.yml" "$staging/docker-compose.yml" -Force
$tarPath = Join-Path $env:TEMP "deploy-server.tar"
if (Test-Path $tarPath) { Remove-Item $tarPath -Force }
Push-Location $staging
& tar -cf $tarPath server docker-compose.yml
Pop-Location
Remove-Item $staging -Recurse -Force

$secure = ConvertTo-SecureString $DeployVpsPassword -AsPlainText -Force
$credential = New-Object PSCredential($DeployVpsUser, $secure)
$session = New-SSHSession -ComputerName $DeployVpsHost -Credential $credential -AcceptKey

Write-Host "Uploading to VPS..." -ForegroundColor Cyan
Send-ScpFile -VpsHost $DeployVpsHost -Credential $credential -LocalFile $tarPath -RemoteDir $DeployRemotePath

$cmds = @(
    "cd $DeployRemotePath && tar -xf deploy-server.tar && rm -f deploy-server.tar",
    "grep -q api_upload_avatar $DeployRemotePath/server/app/main.py && echo MAIN_OK",
    "cd $DeployRemotePath && docker compose up -d --force-recreate server",
    "sleep 6",
    "curl -s http://127.0.0.1:8000/api/media/capabilities"
)

foreach ($cmd in $cmds) {
    Write-Host "> $cmd" -ForegroundColor DarkGray
    $r = Invoke-SSHCommand -SessionId $session.SessionId -Command $cmd -TimeOut 600
    if ($r.Output) { Write-Host $r.Output }
    if ($r.Error) { $r.Error | ForEach-Object { Write-Host $_ -ForegroundColor Yellow } }
    if ($r.ExitStatus -ne 0) {
        Write-Host "Step failed (exit $($r.ExitStatus))" -ForegroundColor Red
        Remove-Item $tarPath -Force -ErrorAction SilentlyContinue
        Remove-SSHSession -SessionId $session.SessionId | Out-Null
        exit 1
    }
}

Remove-Item $tarPath -Force -ErrorAction SilentlyContinue
Remove-SSHSession -SessionId $session.SessionId | Out-Null

$last = $r.Output
if ($last -match "avatar_upload") {
    Write-Host "Avatar API is live - try your profile picture now (Ctrl+Shift+R)" -ForegroundColor Green
} else {
    Write-Host "Unexpected API response: $last" -ForegroundColor Yellow
}
