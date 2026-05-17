$TOKEN = "YOUR_GITHUB_TOKEN"
$REPO  = "AiyL17/toonreader-launch"
$HEADERS = @{
    Authorization  = "token $TOKEN"
    "User-Agent"   = "toonreader-setup"
    Accept         = "application/vnd.github.v3+json"
    "Content-Type" = "application/json"
}

function B64Text($text) {
    return [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text))
}
function B64File($path) {
    return [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($path))
}
function POST($url, $body) {
    return Invoke-RestMethod -Uri $url -Method Post -Headers $HEADERS -Body ($body | ConvertTo-Json -Depth 10)
}

$base = "C:\xampp\htdocs\toonreader\launcher"

# ── 1. Create blobs ───────────────────────────────────────────────────────────
Write-Host "Creating blobs..."

function MakeBlob($content, $encoding = "base64") {
    $r = POST "https://api.github.com/repos/$REPO/git/blobs" @{ content = $content; encoding = $encoding }
    return $r.sha
}

$readmeSha  = MakeBlob (B64Text "# ToonReader Launcher`n`nRedirects to the current ToonReader server URL.")
Write-Host "  README: $readmeSha"

$indexSha   = MakeBlob (B64File "$base\index.html")
Write-Host "  index.html: $indexSha"

$manifestSha = MakeBlob (B64File "$base\manifest.json")
Write-Host "  manifest.json: $manifestSha"

$urlSha     = MakeBlob (B64File "$base\url.json")
Write-Host "  url.json: $urlSha"

$icon192Sha = MakeBlob (B64File "$base\icon-192.png")
Write-Host "  icon-192.png: $icon192Sha"

$icon512Sha = MakeBlob (B64File "$base\icon-512.png")
Write-Host "  icon-512.png: $icon512Sha"

# ── 2. Create tree ────────────────────────────────────────────────────────────
Write-Host "Creating tree..."
$tree = POST "https://api.github.com/repos/$REPO/git/trees" @{
    tree = @(
        @{ path = "README.md";    mode = "100644"; type = "blob"; sha = $readmeSha   }
        @{ path = "index.html";   mode = "100644"; type = "blob"; sha = $indexSha    }
        @{ path = "manifest.json";mode = "100644"; type = "blob"; sha = $manifestSha }
        @{ path = "url.json";     mode = "100644"; type = "blob"; sha = $urlSha      }
        @{ path = "icon-192.png"; mode = "100644"; type = "blob"; sha = $icon192Sha  }
        @{ path = "icon-512.png"; mode = "100644"; type = "blob"; sha = $icon512Sha  }
    )
}
Write-Host "  Tree: $($tree.sha)"

# ── 3. Create commit ──────────────────────────────────────────────────────────
Write-Host "Creating commit..."
$commit = POST "https://api.github.com/repos/$REPO/git/commits" @{
    message = "init: ToonReader launcher"
    tree    = $tree.sha
    parents = @()
}
Write-Host "  Commit: $($commit.sha)"

# ── 4. Create main branch ref ─────────────────────────────────────────────────
Write-Host "Creating main branch..."
try {
    $ref = POST "https://api.github.com/repos/$REPO/git/refs" @{
        ref = "refs/heads/main"
        sha = $commit.sha
    }
    Write-Host "  Branch created: $($ref.ref)"
} catch {
    Write-Host "  Branch may exist, trying to update..."
    try {
        Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/git/refs/heads/main" -Method Patch -Headers $HEADERS -Body (@{ sha = $commit.sha; force = $true } | ConvertTo-Json)
        Write-Host "  Branch updated"
    } catch {
        Write-Host "  Branch update failed: $_"
    }
}

# ── 5. Enable GitHub Pages ────────────────────────────────────────────────────
Write-Host "Enabling GitHub Pages..."
Start-Sleep -Seconds 3
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/pages" -Method Post -Headers $HEADERS -Body '{"source":{"branch":"main","path":"/"}}' | Out-Null
    Write-Host "  Pages enabled!"
} catch {
    Write-Host "  Pages already enabled or check manually:"
    Write-Host "  https://github.com/$REPO/settings/pages"
}

Write-Host ""
Write-Host "=========================================="
Write-Host " SUCCESS"
Write-Host " Repo:     https://github.com/$REPO"
Write-Host " Launcher: https://aiyl17.github.io/toonreader-launch/"
Write-Host " (Pages takes ~1 min to go live)"
Write-Host "=========================================="


