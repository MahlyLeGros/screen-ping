#Requires -Version 5.1
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "deploy.config.ps1")
Import-Module Posh-SSH
$secure = ConvertTo-SecureString $DeployVpsPassword -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($DeployVpsUser, $secure)
$session = New-SSHSession -ComputerName $DeployVpsHost -Credential $credential -AcceptKey -ErrorAction Stop
try {
    $remote = if ($DeployRemotePath) { $DeployRemotePath.TrimEnd("/") } else { "~/screen-ping" }
    $cmd = "cd $remote && docker compose logs server --since 25m 2>/dev/null | grep -E 'agentdbg|POST /api/media|GET /uploads' | tail -n 60"
    $r = Invoke-SSHCommand -SessionId $session.SessionId -Command $cmd -TimeOut 60
    if ($r.Output) { $r.Output | ForEach-Object { Write-Host $_ } } else { Write-Host "NO_MATCH" }
}
finally {
    Remove-SSHSession -SessionId $session.SessionId | Out-Null
}
