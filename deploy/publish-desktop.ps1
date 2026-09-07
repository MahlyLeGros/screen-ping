#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$DeployDir = $PSScriptRoot
$Root = Resolve-Path (Join-Path $DeployDir "..")
$ConfigFile = Join-Path $DeployDir "deploy.config.ps1"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
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
    return @{
        Host       = $vpsHost
        User       = $user
        Password   = $password
        RemotePath = $remotePath
    }
}

function Ensure-PoshSSH {
    if (Get-Module -ListAvailable -Name Posh-SSH) { return }
    Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue
    Install-Module -Name Posh-SSH -Scope CurrentUser -Force -AllowClobber
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
    Set-SCPItem -ComputerName $VpsHost -Credential $Credential -Path $LocalFile -Destination $dir -AcceptKey
}

Write-Host ""
Write-Host "  Screen Ping - publish desktop installer" -ForegroundColor White
Write-Host "  =======================================" -ForegroundColor DarkGray

$cfg = Get-DeployConfig
Ensure-PoshSSH
Import-Module Posh-SSH

$desktopDir = Join-Path $Root "desktop"
$packageJson = Get-Content (Join-Path $desktopDir "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$productName = $packageJson.build.productName
if (-not $productName) { $productName = "Screen Ping" }
$installerName = "$productName Setup $version.exe"

Write-Step "Generating icons..."
Push-Location $desktopDir
try {
    node scripts/gen-icons.js
    if ($LASTEXITCODE -ne 0) { throw "Icon generation failed" }

    Write-Step "Building installer (npm run dist)..."
    $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
    if (-not (Test-Path "node_modules")) {
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    }
    npm run dist
    if ($LASTEXITCODE -ne 0) { throw "npm run dist failed" }
}
finally {
    Pop-Location
}

$releaseDir = Join-Path $desktopDir "release"
$installerPath = Join-Path $releaseDir $installerName
$latestYml = Join-Path $releaseDir "latest.yml"
if (-not (Test-Path $installerPath)) { throw "Installer not found: $installerPath" }
if (-not (Test-Path $latestYml)) { throw "latest.yml not found: $latestYml" }

$installerUrlName = [Uri]::EscapeDataString($installerName)
$downloadUrl = "https://screenping.xyz/desktop/updates/$installerUrlName"
$latestJson = @{
    version      = $version
    download_url = $downloadUrl
    update_protocol = "screenping://update"
} | ConvertTo-Json -Compress

$latestJsonDir = Join-Path $Root "server\app\desktop"
if (-not (Test-Path $latestJsonDir)) {
    New-Item -ItemType Directory -Path $latestJsonDir -Force | Out-Null
}
$latestJsonPath = Join-Path $latestJsonDir "latest.json"
[System.IO.File]::WriteAllText(
    $latestJsonPath,
    $latestJson,
    (New-Object System.Text.UTF8Encoding($false))
)
Write-Host "Updated $latestJsonPath" -ForegroundColor Green

# Maintain stepwise version catalog + per-version feed (N → N+1 updates).
$versionsPath = Join-Path $latestJsonDir "versions.json"
$versionList = @()
if (Test-Path $versionsPath) {
    try {
        $parsed = Get-Content $versionsPath -Raw | ConvertFrom-Json
        if ($parsed -is [System.Array]) {
            $versionList = @($parsed | ForEach-Object { [string]$_ })
        }
    } catch {
        $versionList = @()
    }
}
if ($versionList -notcontains $version) {
    $versionList += $version
}
$versionList = @($versionList | Sort-Object {
    $p = ($_ -replace '^v','').Split('.')
    [int]($p[0]); [int]($p[1]); [int]($p[2])
} -Unique)
$versionsJson = ($versionList | ConvertTo-Json -Compress)
if (-not $versionsJson.StartsWith("[")) { $versionsJson = "[$versionsJson]" }
[System.IO.File]::WriteAllText(
    $versionsPath,
    $versionsJson,
    (New-Object System.Text.UTF8Encoding($false))
)
Write-Host "Updated $versionsPath ($($versionList -join ', '))" -ForegroundColor Green

$versionFeedDir = Join-Path $releaseDir "version-feed\$version"
New-Item -ItemType Directory -Path $versionFeedDir -Force | Out-Null
node (Join-Path $desktopDir "scripts\write-version-feed.js") $latestYml $version $installerName $versionFeedDir
if ($LASTEXITCODE -ne 0) { throw "Failed to write per-version latest.yml" }
$versionFeedYml = Join-Path $versionFeedDir "latest.yml"
if (-not (Test-Path $versionFeedYml)) { throw "Version feed missing: $versionFeedYml" }

Write-Step "Uploading to VPS ($($cfg.Host))..."
$secure = ConvertTo-SecureString $cfg.Password -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($cfg.User, $secure)
$session = New-SSHSession -ComputerName $cfg.Host -Credential $credential -AcceptKey -ErrorAction Stop

try {
    $remoteUpdates = "/var/www/screenping/desktop/updates"
    $staging = "/home/$($cfg.User)/desktop-publish-staging"

    Write-Step "Preparing staging folder on VPS..."
    $prep = Invoke-SSHCommand -SessionId $session.SessionId -Command "mkdir -p $staging/v/$version" -TimeOut 120
    if ($prep.ExitStatus -ne 0) {
        throw "Failed to create staging folder on VPS"
    }

    Send-ScpFile -VpsHost $cfg.Host -Credential $credential -LocalFile $installerPath -RemoteDir $staging
    Send-ScpFile -VpsHost $cfg.Host -Credential $credential -LocalFile $latestYml -RemoteDir $staging
    Send-ScpFile -VpsHost $cfg.Host -Credential $credential -LocalFile $versionFeedYml -RemoteDir "$staging/v/$version"
    Send-ScpFile -VpsHost $cfg.Host -Credential $credential -LocalFile $latestJsonPath -RemoteDir "$($cfg.RemotePath)/server/app/desktop"
    Send-ScpFile -VpsHost $cfg.Host -Credential $credential -LocalFile $versionsPath -RemoteDir "$($cfg.RemotePath)/server/app/desktop"
    $bootstrapLocal = Join-Path $DeployDir "bootstrap-update-feeds.py"
    Send-ScpFile -VpsHost $cfg.Host -Credential $credential -LocalFile $bootstrapLocal -RemoteDir $staging

    Write-Step "Installing files into web root..."
    $installerRemote = "$remoteUpdates/$installerName"
    $appDesktop = "$($cfg.RemotePath)/server/app/desktop"
    $moveCmd = @"
sudo mkdir -p '$remoteUpdates/v/$version'
sudo cp -f '$staging/$installerName' '$installerRemote'
sudo cp -f '$staging/latest.yml' '$remoteUpdates/latest.yml'
sudo cp -f '$staging/v/$version/latest.yml' '$remoteUpdates/v/$version/latest.yml'
sudo python3 '$staging/bootstrap-update-feeds.py' '$remoteUpdates' '$appDesktop/versions.json'
sudo cp -f '$remoteUpdates/versions.json' '$appDesktop/versions.json' 2>/dev/null || true
sudo chown -R www-data:www-data /var/www/screenping/desktop
sudo chmod -R a+rX /var/www/screenping/desktop
rm -rf '$staging/$installerName' '$staging/latest.yml' '$staging/v' '$staging/bootstrap-update-feeds.py'
"@
    $move = Invoke-SSHCommand -SessionId $session.SessionId -Command $moveCmd -TimeOut 600
    if ($move.ExitStatus -ne 0) {
        if ($move.Error) { $move.Error | ForEach-Object { Write-Host $_ -ForegroundColor Red } }
        if ($move.Output) { $move.Output | ForEach-Object { Write-Host $_ } }
        throw "Failed to install desktop update files on VPS"
    }
    if ($move.Output) { $move.Output | ForEach-Object { Write-Host $_ } }

    Write-Host ""
    Write-Host "Published desktop $version" -ForegroundColor Green
    Write-Host ('  Installer: ' + $downloadUrl)
    Write-Host ('  Feed (latest): https://screenping.xyz/desktop/updates/latest.yml')
    Write-Host ('  Feed (step): https://screenping.xyz/desktop/updates/v/' + $version + '/latest.yml')
}
finally {
    Remove-SSHSession -SessionId $session.SessionId -ErrorAction SilentlyContinue | Out-Null
}
