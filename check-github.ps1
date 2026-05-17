$TOKEN = "YOUR_GITHUB_TOKEN"
$HEADERS = @{
    Authorization = "token $TOKEN"
    "User-Agent"  = "toonreader-setup"
    Accept        = "application/vnd.github.v3+json"
}

Write-Host "=== Checking token scopes ==="
$resp = Invoke-WebRequest -Uri "https://api.github.com/user" -Headers $HEADERS
Write-Host "Scopes: $($resp.Headers['X-OAuth-Scopes'])"
Write-Host "Login:  $(($resp.Content | ConvertFrom-Json).login)"

Write-Host ""
Write-Host "=== Listing repos ==="
$repos = Invoke-RestMethod -Uri "https://api.github.com/user/repos?per_page=20&type=all" -Headers $HEADERS
foreach ($r in $repos) {
    Write-Host "  $($r.full_name) [private=$($r.private)]"
}

Write-Host ""
Write-Host "=== Checking toonreader-launch specifically ==="
try {
    $repo = Invoke-RestMethod -Uri "https://api.github.com/repos/AiyL17/toonreader-launch" -Headers $HEADERS
    Write-Host "  Found: $($repo.full_name)"
} catch {
    Write-Host "  Not found: $_"
}


