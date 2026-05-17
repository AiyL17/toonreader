$TOKEN = "YOUR_GITHUB_TOKEN"
$REPO  = "AiyL17/toonreader"
$HEADERS = @{
    Authorization = "token $TOKEN"
    "User-Agent"  = "toonreader-setup"
    Accept        = "application/vnd.github.v3+json"
}

function B64Text($text) {
    return [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text))
}
function B64File($path) {
    return [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($path))
}

function GHGetSha($path) {
    try {
        $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/contents/$path" -Headers $HEADERS
        return $r.sha
    } catch { return $null }
}

function GHPut($path, $message, $b64) {
    $sha = GHGetSha $path
    $body = @{ message = $message; content = $b64 }
    if ($sha) { $body.sha = $sha }
    $json = $body | ConvertTo-Json
    try {
        Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/contents/$path" -Method Put -Headers $HEADERS -Body $json -ContentType "application/json" | Out-Null
        Write-Host "  OK: $path"
    } catch {
        Write-Host "  FAIL: $path"
        Write-Host "  $_"
    }
}

# ── Verify repo access ────────────────────────────────────────────────────────
Write-Host "Checking repo access..."
try {
    $repo = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO" -Headers $HEADERS
    Write-Host "  Found: $($repo.full_name) (default branch: $($repo.default_branch))"
} catch {
    Write-Host "  ERROR: Cannot access repo. Check token permissions."
    Write-Host "  $_"
    exit 1
}

$branch = $repo.default_branch

# ── Upload launcher files into docs/ folder ───────────────────────────────────
# We use docs/ because GitHub Pages can serve from /docs on any branch
Write-Host ""
Write-Host "Uploading launcher files to docs/ ..."

$base = "C:\xampp\htdocs\toonreader\launcher"

GHPut "docs/index.html"    "launcher: add redirect page"  (B64File "$base\index.html")
GHPut "docs/manifest.json" "launcher: add manifest"       (B64File "$base\manifest.json")
GHPut "docs/url.json"      "launcher: add url.json"       (B64File "$base\url.json")
GHPut "docs/icon-192.png"  "launcher: add icon 192"       (B64File "$base\icon-192.png")
GHPut "docs/icon-512.png"  "launcher: add icon 512"       (B64File "$base\icon-512.png")

# ── Enable GitHub Pages from /docs ────────────────────────────────────────────
Write-Host ""
Write-Host "Enabling GitHub Pages (branch: $branch, path: /docs)..."
$pagesBody = "{`"source`":{`"branch`":`"$branch`",`"path`":`"/docs`"}}"
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/pages" -Method Post -Headers $HEADERS -Body $pagesBody -ContentType "application/json" | Out-Null
    Write-Host "  GitHub Pages enabled!"
} catch {
    # Try PATCH in case it already exists
    try {
        Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/pages" -Method Put -Headers $HEADERS -Body $pagesBody -ContentType "application/json" | Out-Null
        Write-Host "  GitHub Pages updated!"
    } catch {
        Write-Host "  Could not auto-enable Pages. Do it manually:"
        Write-Host "  https://github.com/$REPO/settings/pages"
        Write-Host "  Set: Source = $branch branch, /docs folder"
    }
}

Write-Host ""
Write-Host "=========================================="
Write-Host " DONE"
Write-Host " Launcher URL (install as PWA on phone):"
Write-Host " https://aiyl17.github.io/toonreader/"
Write-Host " (GitHub Pages takes ~1 min to go live)"
Write-Host "=========================================="


