$TOKEN = "YOUR_GITHUB_TOKEN"
$REPO  = "AiyL17/toonreader-launch"
$HEADERS = @{
    Authorization = "token $TOKEN"
    "User-Agent"  = "toonreader-setup"
    Accept        = "application/vnd.github.v3+json"
}

function GHGetSha($path) {
    try {
        $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/contents/$path" -Headers $HEADERS
        return $r.sha
    } catch { return $null }
}

function GHPutText($path, $message, $text) {
    $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text))
    $sha = GHGetSha $path
    $body = @{ message = $message; content = $b64 }
    if ($sha) { $body.sha = $sha }
    $json = $body | ConvertTo-Json
    try {
        Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/contents/$path" -Method Put -Headers $HEADERS -Body $json -ContentType "application/json" | Out-Null
        Write-Host "  OK: $path"
    } catch { Write-Host "  FAIL: $path - $_" }
}

function GHPutFile($path, $message, $filePath) {
    $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($filePath))
    $sha = GHGetSha $path
    $body = @{ message = $message; content = $b64 }
    if ($sha) { $body.sha = $sha }
    $json = $body | ConvertTo-Json
    try {
        Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/contents/$path" -Method Put -Headers $HEADERS -Body $json -ContentType "application/json" | Out-Null
        Write-Host "  OK: $path"
    } catch { Write-Host "  FAIL: $path - $_" }
}

# Step 1: Create repo
Write-Host "Step 1: Creating repo..."
$repoJson = '{"name":"toonreader-launch","description":"ToonReader launcher redirect page","private":false,"auto_init":false}'
try {
    $repo = Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Method Post -Headers $HEADERS -Body $repoJson -ContentType "application/json"
    Write-Host "  Created: $($repo.html_url)"
    Start-Sleep -Seconds 2
} catch {
    Write-Host "  Already exists or error, continuing..."
}

# Step 2: Upload all files
Write-Host "Step 2: Uploading files..."
$base = "C:\xampp\htdocs\toonreader\launcher"

GHPutText "README.md"    "init: readme"    "# ToonReader Launcher`n`nRedirects to the current ToonReader server URL."
GHPutFile "index.html"   "init: launcher"  "$base\index.html"
GHPutFile "manifest.json" "init: manifest" "$base\manifest.json"
GHPutFile "url.json"     "init: url"       "$base\url.json"
GHPutFile "icon-192.png" "init: icon 192"  "$base\icon-192.png"
GHPutFile "icon-512.png" "init: icon 512"  "$base\icon-512.png"

# Step 3: Enable GitHub Pages
Write-Host "Step 3: Enabling GitHub Pages..."
$pagesJson = '{"source":{"branch":"main","path":"/"}}'
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/pages" -Method Post -Headers $HEADERS -Body $pagesJson -ContentType "application/json" | Out-Null
    Write-Host "  GitHub Pages enabled!"
} catch {
    Write-Host "  Pages already enabled or needs manual activation."
    Write-Host "  Go to: https://github.com/$REPO/settings/pages"
    Write-Host "  Set Source = main branch, / (root)"
}

Write-Host ""
Write-Host "=========================================="
Write-Host " ALL DONE"
Write-Host " Launcher: https://aiyl17.github.io/toonreader-launch/"
Write-Host "=========================================="


