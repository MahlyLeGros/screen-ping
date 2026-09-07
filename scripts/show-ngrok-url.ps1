# Poll ngrok local API until the HTTPS tunnel URL is available.
$deadline = (Get-Date).AddSeconds(45)
$url = $null

while ((Get-Date) -lt $deadline) {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 2
        $url = ($resp.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1).public_url
        if ($url) { break }
    } catch {
        # ngrok still starting
    }
    Start-Sleep -Seconds 2
}

if ($url) {
    Write-Host ""
    Write-Host "  Public URL (share with friend):" -ForegroundColor Green
    Write-Host "  $url" -ForegroundColor Cyan
    Write-Host ""
    try {
        Set-Clipboard -Value $url
        Write-Host "  (copied to clipboard)" -ForegroundColor DarkGray
    } catch {
        # clipboard optional
    }
} else {
    Write-Host ""
    Write-Host "  Could not read ngrok URL yet." -ForegroundColor Yellow
    Write-Host "  Check the ngrok window, or open http://127.0.0.1:4040" -ForegroundColor Yellow
    Write-Host ""
}
