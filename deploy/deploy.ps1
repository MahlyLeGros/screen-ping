#Requires -Version 5.1
<#
  Full deploy: build web, upload server + dist to VPS, rebuild Docker.
  Double-click deploy.bat or run: powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1
#>
$ErrorActionPreference = "Stop"

$DeployDir = $PSScriptRoot
$Root = Resolve-Path (Join-Path $DeployDir "..")
$ConfigFile = Join-Path $DeployDir "deploy.config.ps1"
$ExampleConfig = Join-Path $DeployDir "deploy.config.example.ps1"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Ensure-PoshSSH {
    if (Get-Module -ListAvailable -Name Posh-SSH) { return }
    Write-Step "Installing Posh-SSH (one-time, needs internet)..."
    Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue
    Install-Module -Name Posh-SSH -Scope CurrentUser -Force -AllowClobber
}

function Get-DeployConfig {
    if (-not (Test-Path $ConfigFile)) {
        if (Test-Path $ExampleConfig) {
            Copy-Item $ExampleConfig $ConfigFile
        }
        Write-Host "Created deploy.config.ps1 - edit your VPS password, then run again." -ForegroundColor Yellow
        exit 1
    }
    # Dot-source inside function: variables stay local unless we return them
    $vpsHost = $null
    $user = $null
    $password = $null
    $remotePath = $null
    . $ConfigFile
    if ($DeployVpsHost) { $vpsHost = $DeployVpsHost }
    if ($DeployVpsUser) { $user = $DeployVpsUser }
    if ($DeployVpsPassword) { $password = $DeployVpsPassword }
    if ($DeployRemotePath) { $remotePath = $DeployRemotePath }
    if ([string]::IsNullOrWhiteSpace($password) -or $password -eq "YOUR_PASSWORD_HERE") {
        Write-Host "Set your VPS password in deploy\deploy.config.ps1" -ForegroundColor Yellow
        exit 1
    }
    return @{
        Host       = $vpsHost
        User       = $user
        Password   = $password
        RemotePath = $remotePath
    }
}

function Build-Web {
    Write-Step "Building web (npm run build)..."
    Push-Location (Join-Path $Root "web")
    try {
        if (-not (Test-Path "node_modules")) {
            Write-Host "Running npm install..."
            npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
        }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
    }
    finally {
        Pop-Location
    }
    $index = Get-ChildItem (Join-Path $Root "web\dist\assets\index-*.js") -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $index) { throw "web\dist not found after build" }
    Write-Host "OK: $($index.Name)" -ForegroundColor Green
}

function New-DeployPackage {
    param(
        [string]$ServerDir,
        [string]$WebDist,
        [string]$Compose,
        [string]$NginxConf
    )
    $staging = Join-Path $env:TEMP "screenping-deploy-staging"
    if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }

    $serverDest = Join-Path $staging "server"
    New-Item -ItemType Directory -Path $serverDest -Force | Out-Null
    Get-ChildItem -Path $ServerDir -Force | Where-Object {
        $_.Name -notin @(".venv", "__pycache__", "uploads", ".env")
    } | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination $serverDest -Recurse -Force
    }

    New-Item -ItemType Directory -Path "$staging/web/dist" -Force | Out-Null
    Copy-Item -Path "$WebDist\*" -Destination "$staging/web/dist" -Recurse -Force
    if (Test-Path $Compose) {
        Copy-Item $Compose "$staging/docker-compose.yml" -Force
    }
    if (Test-Path $NginxConf) {
        Copy-Item $NginxConf "$staging/nginx-screenping.conf" -Force
    }

    $tarPath = Join-Path $env:TEMP "deploy.tar"
    if (Test-Path $tarPath) { Remove-Item $tarPath -Force }
    Push-Location $staging
    & tar -cf $tarPath server web docker-compose.yml nginx-screenping.conf 2>$null
    if (-not (Test-Path $tarPath)) {
        & tar -cf $tarPath server docker-compose.yml nginx-screenping.conf
    }
    Pop-Location
    Remove-Item $staging -Recurse -Force
    return $tarPath
}

function Send-ScpFile {
    param(
        [string]$VpsHost,
        [pscredential]$Credential,
        [string]$LocalFile,
        [string]$RemoteDir
    )
    $dir = ($RemoteDir.Replace("\", "/").TrimEnd("/") + "/")
    $remoteName = Split-Path $LocalFile -Leaf
    $remoteFull = "$dir$remoteName"
    Write-Host "  Upload: $LocalFile -> $remoteFull"
    if (Get-Command Set-SCPFile -ErrorAction SilentlyContinue) {
        Set-SCPFile -ComputerName $VpsHost -Credential $Credential -LocalFile $LocalFile -RemotePath $remoteFull -AcceptKey
        return
    }
    # Set-SCPItem expects an existing remote directory as Destination
    Set-SCPItem -ComputerName $VpsHost -Credential $Credential -Path $LocalFile -Destination $dir -AcceptKey
}

function Open-SshSession {
    param(
        [string]$VpsHost,
        [pscredential]$Credential
    )
    $session = New-SSHSession -ComputerName $VpsHost -Credential $Credential -AcceptKey -ErrorAction Stop
    return $session.SessionId
}

function Close-SshSession {
    param([int]$SessionId)
    Remove-SSHSession -SessionId $SessionId -ErrorAction SilentlyContinue | Out-Null
}

function Invoke-RemoteSoft {
    param(
        [int]$SessionId,
        [string]$Command,
        [int]$TimeoutSec = 120
    )
    $result = Invoke-SSHCommand -SessionId $SessionId -Command $Command -TimeOut $TimeoutSec
    if ($result.Output) { $result.Output | ForEach-Object { Write-Host $_ } }
    if ($result.Error) { $result.Error | ForEach-Object { Write-Host $_ -ForegroundColor DarkYellow } }
    return $result
}

function Invoke-Remote {
    param(
        [int]$SessionId,
        [string]$Command,
        [int]$TimeoutSec = 120
    )
    $result = Invoke-RemoteSoft -SessionId $SessionId -Command $Command -TimeoutSec $TimeoutSec
    if ($result.ExitStatus -ne 0) {
        throw "Remote command failed (exit $($result.ExitStatus)): $Command"
    }
    return $result
}

# --- Main ---
Write-Host ""
Write-Host "  Screen Ping - full VPS deploy" -ForegroundColor White
Write-Host "  =============================" -ForegroundColor DarkGray

$cfg = Get-DeployConfig
Ensure-PoshSSH
Import-Module Posh-SSH

$secure = ConvertTo-SecureString $cfg.Password -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($cfg.User, $secure)

Build-Web

Write-Step "Uploading files to VPS ($($cfg.Host))..."

$serverDir = Join-Path $Root "server"
$webDist = Join-Path $Root "web\dist"
$compose = Join-Path $Root "docker-compose.yml"
$nginxConf = Join-Path $DeployDir "nginx-screenping.conf"

Write-Step "Creating deploy package..."
$tarPath = New-DeployPackage -ServerDir $serverDir -WebDist $webDist -Compose $compose -NginxConf $nginxConf

Write-Step "Connecting to VPS..."
$sshSessionId = Open-SshSession -VpsHost $cfg.Host -Credential $credential
try {
    Write-Step "Preparing VPS folders..."
    $mkdirCmd = "mkdir -p $($cfg.RemotePath)/server $($cfg.RemotePath)/web/dist $($cfg.RemotePath)/data/uploads/avatars $($cfg.RemotePath)/data/avatars-keep"
    Invoke-Remote -SessionId $sshSessionId -Command $mkdirCmd

    Send-ScpFile -VpsHost $cfg.Host -Credential $credential -LocalFile $tarPath -RemoteDir $cfg.RemotePath

    Write-Step "Extracting on VPS..."
    $extractCmd = "cd $($cfg.RemotePath) && tar -xf deploy.tar && rm -f deploy.tar"
    Invoke-Remote -SessionId $sshSessionId -Command $extractCmd

    Write-Step "Migrating profile photos onto the VPS disk..."
    $migrateAvatars = @'
set -e
REMOTE_PATH='__REMOTE_PATH__'
cd "$REMOTE_PATH"
mkdir -p data/uploads/avatars data/avatars-keep
# Pull files out of the old Docker volume once, then keep them on the host.
if [ -z "$(ls -A data/uploads/avatars 2>/dev/null)" ]; then
  VOL=$(docker volume ls -q | grep -E '_uploads$' | head -n1 || true)
  if [ -n "$VOL" ]; then
    echo "Copying uploads from Docker volume $VOL"
    docker run --rm -v "$VOL:/from:ro" -v "$PWD/data/uploads:/to" alpine sh -c "cp -a /from/. /to/ && mkdir -p /to/avatars"
  fi
fi
if [ -d data/uploads/avatars ]; then
  cp -a data/uploads/avatars/. data/avatars-keep/ 2>/dev/null || true
fi
echo "Avatars on disk:"
ls -lh data/uploads/avatars data/avatars-keep 2>/dev/null || true
'@
    $migrateAvatars = $migrateAvatars.Replace("__REMOTE_PATH__", $cfg.RemotePath)
    $migrateAvatars = $migrateAvatars -replace "`r`n", "`n" -replace "`r", "`n"
    Invoke-Remote -SessionId $sshSessionId -Command $migrateAvatars -TimeoutSec 180

    Invoke-Remote -SessionId $sshSessionId -Command "test -f $($cfg.RemotePath)/web/dist/index.html"
    Invoke-Remote -SessionId $sshSessionId -Command "test -f $($cfg.RemotePath)/server/Dockerfile"

    Write-Step "Publishing website to /var/www/screenping..."
    $wwwCmd = "sudo mkdir -p /var/www/screenping/desktop/updates && sudo rsync -a --delete --exclude 'desktop/' $($cfg.RemotePath)/web/dist/ /var/www/screenping/ && sudo chown -R www-data:www-data /var/www/screenping && sudo chmod -R a+rX /var/www/screenping/"
    Invoke-Remote -SessionId $sshSessionId -Command $wwwCmd

    Write-Step "Updating Nginx (required for the website)..."
    $nginxCmd = "sudo cp $($cfg.RemotePath)/nginx-screenping.conf /etc/nginx/sites-available/screenping && sudo ln -sf /etc/nginx/sites-available/screenping /etc/nginx/sites-enabled/screenping && sudo rm -f /etc/nginx/sites-enabled/default && sudo nginx -t && sudo systemctl reload nginx"
    Invoke-Remote -SessionId $sshSessionId -Command $nginxCmd

    Remove-Item $tarPath -Force -ErrorAction SilentlyContinue

    Write-Step "Restarting API server (loads code from server/app volume)..."
    Invoke-Remote -SessionId $sshSessionId -Command "cd $($cfg.RemotePath) && docker compose build server && docker compose up -d --no-deps --force-recreate server" -TimeoutSec 600

    Write-Step "Checking site and API..."
    Start-Sleep -Seconds 5
    $check = Invoke-RemoteSoft -SessionId $sshSessionId -Command "curl -s http://127.0.0.1:8000/api/media/capabilities; echo; curl -sk -o /dev/null -w SITE:%{http_code} https://127.0.0.1/; echo"
    if ($check.Output) { $check.Output }
    if ($check.Output -match "avatar_upload") {
        Write-Host "Deploy OK: avatar API is live" -ForegroundColor Green
    }
    else {
        Write-Host "Warning: API check failed - server logs:" -ForegroundColor Yellow
        $logs = Invoke-RemoteSoft -SessionId $sshSessionId -Command "cd $($cfg.RemotePath) && docker compose logs server --tail 50"
        if ($logs.Output) { $logs.Output }
    }
    if ($check.Output -match "SITE:200") {
        Write-Host "Website OK (nginx serves /var/www/screenping)" -ForegroundColor Green
    }
    else {
        Write-Host "Website may still show 500 - run deploy\fix-nginx.bat" -ForegroundColor Yellow
    }

    Invoke-RemoteSoft -SessionId $sshSessionId -Command "cd $($cfg.RemotePath) && mkdir -p data/avatars-keep && cp -a data/uploads/avatars/. data/avatars-keep/ 2>/dev/null; echo AVATARS; ls -lh data/uploads/avatars 2>/dev/null || true"
}
finally {
    Close-SshSession -SessionId $sshSessionId
}

Write-Host ""
Write-Host 'Done! Open https://screenping.xyz and hard-refresh (Ctrl+Shift+R)' -ForegroundColor Green
Write-Host ""
