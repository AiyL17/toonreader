$TOKEN = "YOUR_GITHUB_TOKEN"
$HEADERS = @{
    Authorization = "token $TOKEN"
    "User-Agent"  = "toonreader-setup"
    Accept        = "application/vnd.github.v3+json"
}

function GHPut($path, $message, $contentB64, $sha = $null) {
    $body = @{ message = $message; content = $contentB64 }
    if ($sha) { $body.sha = $sha }
    $json = $body | ConvertTo-Json
    try {
        $r = Invoke-RestMethod -Uri "https://api.github.com/repos/AiyL17/toonreader-launch/contents/$path" -Method Put -Headers $HEADERS -Body $json -ContentType "application/json"
        Write-Host "  OK: $path"
        return $r
    } catch {
        Write-Host "  FAIL: $path — $_"
    }
}

function GHGetSha($path) {
    try {
        $r = Invoke-RestMethod -Uri "https://api.github.com/repos/AiyL17/toonreader-launch/contents/$path" -Headers $HEADERS
        return $r.sha
    } catch { return $null }
}

function B64($str) {
    return [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($str))
}

function B64File($path) {
    return [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($path))
}

# ── Step 1: Create repo ───────────────────────────────────────────────────────
Write-Host "Step 1: Creating GitHub repo..."
$repoJson = '{"name":"toonreader-launch","description":"ToonReader launcher redirect page","private":false,"auto_init":false}'
try {
    $repo = Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Method Post -Headers $HEADERS -Body $repoJson -ContentType "application/json"
    Write-Host "  Repo created: $($repo.html_url)"
} catch {
    $errMsg = $_.ToString()
    if ($errMsg -like "*already exists*" -or $errMsg -like "*name already exists*") {
        Write-Host "  Repo already exists, continuing..."
    } else {
        Write-Host "  Repo creation error: $errMsg"
    }
}

# ── Step 2: Create README first (initializes the repo with a commit) ──────────
Write-Host "Step 2: Initializing repo with README..."
$readmeSha = GHGetSha "README.md"
GHPut "README.md" "init: ToonReader launcher" (B64 "# ToonReader Launcher`n`nThis page redirects to the current ToonReader server URL.`n") $readmeSha
Start-Sleep -Seconds 2

# ── Step 3: Upload url.json ───────────────────────────────────────────────────
Write-Host "Step 3: Uploading url.json..."
$urlSha = GHGetSha "url.json"
GHPut "url.json" "init: add url.json" (B64 '{"url":""}') $urlSha

# ── Step 4: Upload index.html ─────────────────────────────────────────────────
Write-Host "Step 4: Uploading index.html..."

$indexHtml = @'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ToonReader</title>
  <link rel="manifest" href="manifest.json" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="ToonReader" />
  <meta name="theme-color" content="#7c6af7" />
  <link rel="apple-touch-icon" href="icon-192.png" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0f0f13;
      color: #e8e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      gap: 20px;
      padding: 24px;
      text-align: center;
    }
    .logo {
      width: 96px; height: 96px;
      background: #7c6af7;
      border-radius: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo svg { width: 52px; height: 52px; }
    h1 { font-size: 1.8rem; font-weight: 700; }
    p  { color: #9898b0; font-size: 0.95rem; line-height: 1.5; max-width: 300px; }
    .status {
      font-size: 0.85rem; color: #9898b0;
      background: #1a1a22; border: 1px solid #2e2e3e;
      border-radius: 8px; padding: 10px 18px;
    }
    .status.error { color: #e05555; border-color: #e05555; }
    .status.ok    { color: #4caf7d; border-color: #4caf7d; }
    .spinner {
      width: 32px; height: 32px;
      border: 3px solid #2e2e3e;
      border-top-color: #7c6af7;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .open-btn {
      display: none;
      background: #7c6af7; color: #fff;
      border: none; border-radius: 10px;
      padding: 14px 32px; font-size: 1rem;
      font-weight: 600; cursor: pointer;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="logo">
    <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
    </svg>
  </div>
  <h1>ToonReader</h1>
  <div class="spinner" id="spinner"></div>
  <div class="status" id="status">Looking up server...</div>
  <a class="open-btn" id="open-btn">Open ToonReader</a>
  <p id="hint"></p>

  <script>
    const CACHE_KEY = 'toonreader_url';
    const JSON_URL  = 'https://raw.githubusercontent.com/AiyL17/toonreader-launch/main/url.json';

    async function launch() {
      const statusEl  = document.getElementById('status');
      const spinnerEl = document.getElementById('spinner');
      const openBtn   = document.getElementById('open-btn');
      const hintEl    = document.getElementById('hint');

      try {
        const res = await fetch(JSON_URL + '?t=' + Date.now());
        if (!res.ok) throw new Error('Could not fetch URL file');
        const data = await res.json();

        if (!data.url) {
          spinnerEl.style.display = 'none';
          statusEl.textContent = 'Server is offline';
          statusEl.className = 'status error';
          hintEl.textContent = 'Start the ToonReader server on your PC, then tap refresh.';
          return;
        }

        localStorage.setItem(CACHE_KEY, data.url);
        statusEl.textContent = 'Server found! Redirecting...';
        statusEl.className = 'status ok';
        spinnerEl.style.display = 'none';
        openBtn.href = data.url;
        openBtn.style.display = 'inline-block';
        setTimeout(() => { window.location.href = data.url; }, 800);

      } catch (err) {
        spinnerEl.style.display = 'none';
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          statusEl.textContent = 'Using last known URL...';
          statusEl.className = 'status ok';
          openBtn.href = cached;
          openBtn.style.display = 'inline-block';
          hintEl.textContent = 'Could not reach GitHub. Opening last known server URL.';
          setTimeout(() => { window.location.href = cached; }, 1200);
        } else {
          statusEl.textContent = 'Could not reach launcher';
          statusEl.className = 'status error';
          hintEl.textContent = 'Check your internet connection and try again.';
        }
      }
    }

    launch();
  </script>
</body>
</html>
'@

$indexSha = GHGetSha "index.html"
GHPut "index.html" "init: add launcher page" (B64 $indexHtml) $indexSha

# ── Step 5: Upload manifest.json ──────────────────────────────────────────────
Write-Host "Step 5: Uploading manifest.json..."
$manifest = '{"name":"ToonReader","short_name":"ToonReader","description":"Your go-to reader for manga, manhwa & manhua.","start_url":"./","display":"standalone","orientation":"portrait","background_color":"#0f0f13","theme_color":"#7c6af7","icons":[{"src":"icon-192.png","sizes":"192x192","type":"image/png","purpose":"any maskable"},{"src":"icon-512.png","sizes":"512x512","type":"image/png","purpose":"any maskable"}]}'
$manifestSha = GHGetSha "manifest.json"
GHPut "manifest.json" "init: add manifest" (B64 $manifest) $manifestSha

# ── Step 6: Upload icons ──────────────────────────────────────────────────────
Write-Host "Step 6: Uploading icons..."
$icon192Path = "C:\xampp\htdocs\toonreader\public\icons\icon-192.png"
$icon512Path = "C:\xampp\htdocs\toonreader\public\icons\icon-512.png"

if (Test-Path $icon192Path) {
    $sha = GHGetSha "icon-192.png"
    GHPut "icon-192.png" "init: add icon-192" (B64File $icon192Path) $sha
}
if (Test-Path $icon512Path) {
    $sha = GHGetSha "icon-512.png"
    GHPut "icon-512.png" "init: add icon-512" (B64File $icon512Path) $sha
}

# ── Step 7: Enable GitHub Pages ───────────────────────────────────────────────
Write-Host "Step 7: Enabling GitHub Pages..."
$pagesJson = '{"source":{"branch":"main","path":"/"}}'
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/AiyL17/toonreader-launch/pages" -Method Post -Headers $HEADERS -Body $pagesJson -ContentType "application/json" | Out-Null
    Write-Host "  GitHub Pages enabled!"
} catch {
    Write-Host "  Pages may already be enabled — check https://github.com/AiyL17/toonreader-launch/settings/pages"
}

Write-Host ""
Write-Host "=========================================="
Write-Host " SETUP COMPLETE"
Write-Host "=========================================="
Write-Host " Launcher URL (install this as PWA):"
Write-Host " https://aiyl17.github.io/toonreader-launch/"
Write-Host "=========================================="


