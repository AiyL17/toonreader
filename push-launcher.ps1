$TOKEN  = "YOUR_GITHUB_TOKEN"
$REMOTE = "https://AiyL17:$TOKEN@github.com/AiyL17/toonreader.git"
$WORK   = "C:\xampp\htdocs\toonreader"
$DOCS   = "$WORK\docs"
$SRC    = "$WORK\launcher"

# ── 1. Make sure docs/ folder exists with launcher files ─────────────────────
Write-Host "Preparing docs/ folder..."
if (-not (Test-Path $DOCS)) { New-Item -ItemType Directory -Path $DOCS | Out-Null }

Copy-Item "$SRC\index.html"    "$DOCS\index.html"    -Force
Copy-Item "$SRC\manifest.json" "$DOCS\manifest.json" -Force
Copy-Item "$SRC\url.json"      "$DOCS\url.json"      -Force
Copy-Item "$SRC\icon-192.png"  "$DOCS\icon-192.png"  -Force
Copy-Item "$SRC\icon-512.png"  "$DOCS\icon-512.png"  -Force
Write-Host "  Files copied to docs/"

# ── 2. Configure git identity (needed for commits) ───────────────────────────
git -C $WORK config user.email "toonreader@setup.local"
git -C $WORK config user.name  "ToonReader Setup"

# ── 3. Set remote with token ─────────────────────────────────────────────────
Write-Host "Setting remote..."
git -C $WORK remote set-url origin $REMOTE 2>$null
if ($LASTEXITCODE -ne 0) {
    git -C $WORK remote add origin $REMOTE
}

# ── 4. Pull latest so we don't conflict ──────────────────────────────────────
Write-Host "Pulling latest from remote..."
git -C $WORK fetch origin main 2>&1 | Out-Null
git -C $WORK checkout main 2>&1 | Out-Null

# ── 5. Stage and commit docs/ ─────────────────────────────────────────────────
Write-Host "Committing launcher files..."
git -C $WORK add docs/
$status = git -C $WORK status --porcelain
if ($status) {
    git -C $WORK commit -m "launcher: add GitHub Pages redirect page"
    Write-Host "  Committed."
} else {
    Write-Host "  Nothing new to commit (already up to date)."
}

# ── 6. Push ───────────────────────────────────────────────────────────────────
Write-Host "Pushing to GitHub..."
git -C $WORK push origin main
if ($LASTEXITCODE -eq 0) {
    Write-Host "  Pushed successfully!"
} else {
    Write-Host "  Push failed. Check output above."
    exit 1
}

# ── 7. Enable GitHub Pages via API ───────────────────────────────────────────
Write-Host "Enabling GitHub Pages..."
$HEADERS = @{
    Authorization = "token $TOKEN"
    "User-Agent"  = "toonreader-setup"
    Accept        = "application/vnd.github.v3+json"
}
$pagesBody = '{"source":{"branch":"main","path":"/docs"}}'
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/AiyL17/toonreader/pages" -Method Post -Headers $HEADERS -Body $pagesBody -ContentType "application/json" | Out-Null
    Write-Host "  GitHub Pages enabled!"
} catch {
    try {
        Invoke-RestMethod -Uri "https://api.github.com/repos/AiyL17/toonreader/pages" -Method Put -Headers $HEADERS -Body $pagesBody -ContentType "application/json" | Out-Null
        Write-Host "  GitHub Pages updated!"
    } catch {
        Write-Host "  Enable Pages manually at:"
        Write-Host "  https://github.com/AiyL17/toonreader/settings/pages"
        Write-Host "  Set: Source = main branch, /docs folder"
    }
}

# ── 8. Restore remote without token (security) ───────────────────────────────
git -C $WORK remote set-url origin "https://github.com/AiyL17/toonreader.git"

Write-Host ""
Write-Host "=========================================="
Write-Host " ALL DONE"
Write-Host " Launcher URL (add to phone home screen):"
Write-Host " https://aiyl17.github.io/toonreader/"
Write-Host " (Pages takes ~1 min to go live)"
Write-Host "=========================================="


