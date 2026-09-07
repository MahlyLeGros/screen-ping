#Requires -Version 5.1
<#
  Backup VPS production data to this PC (Postgres + uploads + .env).
  Run: powershell -ExecutionPolicy Bypass -File deploy\backup-vps.ps1
  Or double-click: deploy\backup-vps.bat
#>
$ErrorActionPreference = "Stop"

$DeployDir = $PSScriptRoot
$ConfigFile = Join-Path $DeployDir "deploy.config.ps1"
$ProjectRoot = Resolve-Path (Join-Path $DeployDir "..")
$LocalBackupRoot = Join-Path (Split-Path $ProjectRoot -Parent) "screen-ping-backup"

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
        Write-Host "Missing deploy\deploy.config.ps1 - copy from deploy.config.example.ps1" -ForegroundColor Yellow
        exit 1
    }
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
    if ([string]::IsNullOrWhiteSpace($remotePath)) {
        Write-Host "Set DeployRemotePath in deploy\deploy.config.ps1" -ForegroundColor Yellow
        exit 1
    }
    return @{
        Host       = $vpsHost
        User       = $user
        Password   = $password
        RemotePath = $remotePath.TrimEnd("/")
    }
}

function Invoke-Remote {
    param(
        [int]$SessionId,
        [string]$Command,
        [int]$TimeoutSec = 300
    )
    $result = Invoke-SSHCommand -SessionId $SessionId -Command $Command -TimeOut $TimeoutSec
    if ($result.Output) { $result.Output | ForEach-Object { Write-Host $_ } }
    if ($result.Error) { $result.Error | ForEach-Object { Write-Host $_ -ForegroundColor DarkYellow } }
    if ($result.ExitStatus -ne 0) {
        throw "Remote command failed (exit $($result.ExitStatus)): $Command"
    }
    return $result
}

function Get-RemoteFile {
    param(
        [string]$VpsHost,
        [pscredential]$Credential,
        [string]$RemoteFile,
        [string]$LocalDir
    )
    $name = Split-Path $RemoteFile -Leaf
    $localPath = Join-Path $LocalDir $name
    Write-Host "  Download: $RemoteFile -> $localPath"
    if (Get-Command Get-SCPFile -ErrorAction SilentlyContinue) {
        Get-SCPFile -ComputerName $VpsHost -Credential $Credential -RemoteFile $RemoteFile -LocalFile $localPath -AcceptKey
    }
    elseif (Get-Command Get-SCPItem -ErrorAction SilentlyContinue) {
        Get-SCPItem -ComputerName $VpsHost -Credential $Credential -Path $RemoteFile -PathType File -Destination $LocalDir -AcceptKey
    }
    else {
        throw "Posh-SSH SCP download cmdlet not found (Get-SCPFile / Get-SCPItem)"
    }
    if (-not (Test-Path $localPath)) {
        throw "Download failed: $localPath missing"
    }
    $item = Get-Item $localPath
    if ($item.Length -le 0) {
        throw "Download failed: $localPath is empty"
    }
    Write-Host ("  OK ({0:N1} KB)" -f ($item.Length / 1KB)) -ForegroundColor Green
}

# --- Main ---
Write-Host ""
Write-Host "  Screen Ping - backup VPS data" -ForegroundColor White
Write-Host "  =============================" -ForegroundColor DarkGray

$cfg = Get-DeployConfig
Ensure-PoshSSH
Import-Module Posh-SSH

$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$localDir = Join-Path $LocalBackupRoot $stamp
New-Item -ItemType Directory -Path $localDir -Force | Out-Null

$secure = ConvertTo-SecureString $cfg.Password -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($cfg.User, $secure)

Write-Step "Connecting to $($cfg.Host)..."
$session = New-SSHSession -ComputerName $cfg.Host -Credential $credential -AcceptKey -ErrorAction Stop
$sessionId = $session.SessionId
$remoteDir = "/home/$($cfg.User)/screenping-backup-$stamp"

try {
    Write-Step "Creating remote backup ($remoteDir)..."

    $remoteScript = @'
set -e
REMOTE_PATH='__REMOTE_PATH__'
BACKUP_DIR='__BACKUP_DIR__'
mkdir -p "$BACKUP_DIR"
cd "$REMOTE_PATH"

echo "Dumping Postgres..."
docker compose exec -T db pg_dump -U screenping -d screenping > "$BACKUP_DIR/screenping-backup.sql"
test -s "$BACKUP_DIR/screenping-backup.sql"

echo "Archiving uploads (host folder, then Docker volume fallback)..."
if [ -d "$REMOTE_PATH/data/uploads" ]; then
  tar czf "$BACKUP_DIR/uploads-backup.tar.gz" -C "$REMOTE_PATH/data/uploads" .
elif [ -d "$REMOTE_PATH/data/avatars-keep" ]; then
  mkdir -p /tmp/screenping-uploads-backup/avatars
  cp -a "$REMOTE_PATH/data/avatars-keep/." /tmp/screenping-uploads-backup/avatars/
  tar czf "$BACKUP_DIR/uploads-backup.tar.gz" -C /tmp/screenping-uploads-backup .
else
  UPLOAD_VOL=$(docker volume ls -q | grep -E '_uploads$' | head -n1 || true)
  if [ -z "$UPLOAD_VOL" ]; then
    echo "No uploads found" >&2
    exit 1
  fi
  echo "Using volume: $UPLOAD_VOL"
  docker run --rm -v "$UPLOAD_VOL:/data:ro" -v "$BACKUP_DIR:/backup" alpine \
    tar czf /backup/uploads-backup.tar.gz -C /data .
fi
test -s "$BACKUP_DIR/uploads-backup.tar.gz"

echo "Copying .env..."
if [ -f "$REMOTE_PATH/.env" ]; then
  cp "$REMOTE_PATH/.env" "$BACKUP_DIR/env-prod-backup"
elif [ -f "$REMOTE_PATH/server/.env" ]; then
  cp "$REMOTE_PATH/server/.env" "$BACKUP_DIR/env-prod-backup"
else
  printf '%s\n' "WARNING: no .env found on VPS" > "$BACKUP_DIR/env-prod-backup"
fi

ls -lh "$BACKUP_DIR"
echo BACKUP_READY
'@
    $remoteScript = $remoteScript.Replace("__REMOTE_PATH__", $cfg.RemotePath).Replace("__BACKUP_DIR__", $remoteDir)
    # Bash over SSH rejects Windows CRLF — force LF
    $remoteScript = $remoteScript -replace "`r`n", "`n" -replace "`r", "`n"

    Invoke-Remote -SessionId $sessionId -Command $remoteScript -TimeoutSec 600 | Out-Null

    Write-Step "Downloading to $localDir ..."
    Get-RemoteFile -VpsHost $cfg.Host -Credential $credential -RemoteFile "$remoteDir/screenping-backup.sql" -LocalDir $localDir
    Get-RemoteFile -VpsHost $cfg.Host -Credential $credential -RemoteFile "$remoteDir/uploads-backup.tar.gz" -LocalDir $localDir
    Get-RemoteFile -VpsHost $cfg.Host -Credential $credential -RemoteFile "$remoteDir/env-prod-backup" -LocalDir $localDir

    Write-Step "Cleaning remote temp files..."
    Invoke-Remote -SessionId $sessionId -Command "rm -rf '$remoteDir' /home/$($cfg.User)/screenping-backup-*" -TimeoutSec 60 | Out-Null
}
finally {
    Remove-SSHSession -SessionId $sessionId -ErrorAction SilentlyContinue | Out-Null
}

$restoreNotes = @"
Screen Ping — backup $stamp
===========================

Files:
  screenping-backup.sql   = comptes, amis, historique
  uploads-backup.tar.gz   = avatars + medias
  env-prod-backup         = secrets prod (SECRET_KEY, etc.)

Restore (nouveau VPS, apres docker compose up):
  1. Copier env-prod-backup vers $($cfg.RemotePath)/.env
  2. cat screenping-backup.sql | docker compose exec -T db psql -U screenping -d screenping
  3. Restaurer uploads (avatars persistent sur le disque VPS):
       mkdir -p $($cfg.RemotePath)/data/uploads
       tar xzf uploads-backup.tar.gz -C $($cfg.RemotePath)/data/uploads
       docker compose up -d --force-recreate server
"@
Set-Content -Path (Join-Path $localDir "RESTORE.txt") -Value $restoreNotes -Encoding UTF8

Write-Host ""
Write-Host "  Backup OK" -ForegroundColor Green
Write-Host "  Folder: $localDir" -ForegroundColor Green
Write-Host ""
Write-Host "  Copy this folder to Drive / USB as well." -ForegroundColor Yellow
Write-Host ""
