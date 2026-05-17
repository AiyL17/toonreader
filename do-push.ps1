$TOKEN  = "YOUR_GITHUB_TOKEN"
$REMOTE = "https://AiyL17:$TOKEN@github.com/AiyL17/toonreader.git"
$WORK   = "C:\xampp\htdocs\toonreader"

git -C $WORK config user.email "toonreader@setup.local"
git -C $WORK config user.name  "ToonReader Setup"
git -C $WORK remote set-url origin $REMOTE

# Reset the bad commit, keep the docs/ changes staged
Write-Host "Resetting last commit..."
git -C $WORK reset HEAD~1

# Stage ONLY docs/ and the cleaned setup scripts
Write-Host "Staging only safe files..."
git -C $WORK add docs/
git -C $WORK add setup-github.ps1 setup-github2.ps1 setup-github3.ps1 setup-github4.ps1 setup-launcher.ps1 check-github.ps1 push-launcher.ps1 clean-tokens.ps1

# Commit cleanly
Write-Host "Committing..."
git -C $WORK commit -m "launcher: add GitHub Pages redirect page"

# Push
Write-Host "Pushing..."
git -C $WORK push origin main
if ($LASTEXITCODE -eq 0) {
    Write-Host "Pushed OK!"
} else {
    Write-Host "Push failed."
    exit 1
}

# Enable Pages via API
Write-Host "Enabling GitHub Pages..."
$HEADERS = @{
    Authorization = "token $TOKEN"
    "User-Agent"  = "toonreader-setup"
    Accept        = "application/vnd.github.v3+json"
}
$pagesBody = '{"source":{"branch":"main","path":"/docs"}}'
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/AiyL17/toonreader/pages" -Method Post -Headers $HEADERS -Body $pagesBody -ContentType "application/json" | Out-Null
    Write-Host "Pages enabled!"
} catch {
    try {
        Invoke-RestMethod -Uri "https://api.github.com/repos/AiyL17/toonreader/pages" -Method Put -Headers $HEADERS -Body $pagesBody -ContentType "application/json" | Out-Null
        Write-Host "Pages updated!"
    } catch {
        Write-Host "Enable Pages manually: https://github.com/AiyL17/toonreader/settings/pages"
        Write-Host "Set: Source = main branch, /docs folder"
    }
}

# Restore remote without token
git -C $WORK remote set-url origin "https://github.com/AiyL17/toonreader.git"

Write-Host ""
Write-Host "=========================================="
Write-Host " DONE"
Write-Host " Launcher: https://aiyl17.github.io/toonreader/"
Write-Host " (Pages takes ~1 min to go live)"
Write-Host "=========================================="

