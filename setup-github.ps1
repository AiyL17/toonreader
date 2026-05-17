$TOKEN = "YOUR_GITHUB_TOKEN"
$HEADERS = @{
    Authorization = "token $TOKEN"
    "User-Agent"  = "toonreader-setup"
    Accept        = "application/vnd.github.v3+json"
}

# Step 1: Create repo
Write-Host "Creating repo..."
$repoBody = @{
    name        = "toonreader-launch"
    description = "ToonReader launcher redirect page"
    private     = $false
    auto_init   = $true
} | ConvertTo-Json

try {
    $repo = Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Method Post -Headers $HEADERS -Body $repoBody -ContentType "application/json"
    Write-Host "Repo created: $($repo.html_url)"
} catch {
    Write-Host "Repo may already exist, continuing..."
}

Start-Sleep -Seconds 2

# Step 2: Get SHA of README (auto-created by auto_init) so we can update files
Write-Host "Getting repo tree..."
$tree = Invoke-RestMethod -Uri "https://api.github.com/repos/AiyL17/toonreader-launch/git/trees/main" -Headers $HEADERS
Write-Host "Tree fetched OK"

# Step 3: Upload url.json
Write-Host "Uploading url.json..."
$urlJsonContent = '{"url":""}' 
$urlJsonB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($urlJsonContent))

$urlJsonBody = @{
    message = "init: add url.json"
    content = $urlJsonB64
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://api.github.com/repos/AiyL17/toonreader-launch/contents/url.json" -Method Put -Headers $HEADERS -Body $urlJsonBody -ContentType "application/json" | Out-Null
Write-Host "url.json uploaded"

# Step 4: Upload index.html
Write-Host "Uploading index.html..."
$indexHtml = @'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ToonReader</title>
  <link rel="manifest" href="/toonreader-launch/manifest.json" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="ToonReader" />
  <meta name="theme-color" content="#7c6af7" />
  <link rel="apple-touch-icon" href="/toonreader-launch/icon-192.png" />
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
      width: 96px;
      height: 96px;
      background: #7c6af7;
      border-radius: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo svg { width: 52px; height: 52px; }
    h1 { font-size: 1.8rem; font-weight: 700; color: #e8e8f0; }
    p  { color: #9898b0; font-size: 0.95rem; line-height: 1.5; max-width: 300px; }
    .status {
      font-size: 0.85rem;
      color: #9898b0;
      background: #1a1a22;
      border: 1px solid #2e2e3e;
      border-radius: 8px;
      padding: 10px 18px;
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
      background: #7c6af7;
      color: #fff;
      border: none;
      border-radius: 10px;
      padding: 14px 32px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
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
        // Bust cache so we always get the latest URL
        const res = await fetch(JSON_URL + '?t=' + Date.now());
        if (!res.ok) throw new Error('Could not fetch URL file');
        const data = await res.json();

        if (!data.url) {
          spinnerEl.style.display = 'none';
          statusEl.textContent = 'Server is offline';
          statusEl.className = 'status error';
          hintEl.textContent = 'Start the ToonReader server on your PC, then refresh this page.';
          return;
        }

        // Cache the URL locally for next time
        localStorage.setItem(CACHE_KEY, data.url);

        statusEl.textContent = 'Server found! Redirecting...';
        statusEl.className = 'status ok';
        spinnerEl.style.display = 'none';
        openBtn.href = data.url;
        openBtn.style.display = 'inline-block';

        // Auto-redirect after 1 second
        setTimeout(() => { window.location.href = data.url; }, 1000);

      } catch (err) {
        spinnerEl.style.display = 'none';

        // Try cached URL as fallback
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          statusEl.textContent = 'Using last known URL...';
          statusEl.className = 'status ok';
          openBtn.href = cached;
          openBtn.style.display = 'inline-block';
          hintEl.textContent = 'Could not reach GitHub. Opening last known server URL.';
          setTimeout(() => { window.location.href = cached; }, 1500);
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

$indexB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($indexHtml))
$indexBody = @{
    message = "init: add index.html launcher"
    content = $indexB64
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://api.github.com/repos/AiyL17/toonreader-launch/contents/index.html" -Method Put -Headers $HEADERS -Body $indexBody -ContentType "application/json" | Out-Null
Write-Host "index.html uploaded"

# Step 5: Upload manifest.json
Write-Host "Uploading manifest.json..."
$manifest = @'
{
  "name": "ToonReader",
  "short_name": "ToonReader",
  "description": "Your go-to reader for manga, manhwa & manhua.",
  "start_url": "/toonreader-launch/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0f0f13",
  "theme_color": "#7c6af7",
  "icons": [
    {
      "src": "/toonreader-launch/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/toonreader-launch/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
'@

$manifestB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($manifest))
$manifestBody = @{
    message = "init: add manifest.json"
    content = $manifestB64
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://api.github.com/repos/AiyL17/toonreader-launch/contents/manifest.json" -Method Put -Headers $HEADERS -Body $manifestBody -ContentType "application/json" | Out-Null
Write-Host "manifest.json uploaded"

# Step 6: Copy icons from local public/icons
Write-Host "Uploading icons..."
$icon192Path = "C:\xampp\htdocs\toonreader\public\icons\icon-192.png"
$icon512Path = "C:\xampp\htdocs\toonreader\public\icons\icon-512.png"

if (Test-Path $icon192Path) {
    $icon192B64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($icon192Path))
    $iconBody = @{ message = "init: add icon-192.png"; content = $icon192B64 } | ConvertTo-Json
    Invoke-RestMethod -Uri "https://api.github.com/repos/AiyL17/toonreader-launch/contents/icon-192.png" -Method Put -Headers $HEADERS -Body $iconBody -ContentType "application/json" | Out-Null
    Write-Host "icon-192.png uploaded"
}

if (Test-Path $icon512Path) {
    $icon512B64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($icon512Path))
    $iconBody = @{ message = "init: add icon-512.png"; content = $icon512B64 } | ConvertTo-Json
    Invoke-RestMethod -Uri "https://api.github.com/repos/AiyL17/toonreader-launch/contents/icon-512.png" -Method Put -Headers $HEADERS -Body $iconBody -ContentType "application/json" | Out-Null
    Write-Host "icon-512.png uploaded"
}

# Step 7: Enable GitHub Pages on main branch / root
Write-Host "Enabling GitHub Pages..."
$pagesBody = @{
    source = @{ branch = "main"; path = "/" }
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/AiyL17/toonreader-launch/pages" -Method Post -Headers $HEADERS -Body $pagesBody -ContentType "application/json" | Out-Null
    Write-Host "GitHub Pages enabled!"
} catch {
    Write-Host "Pages may already be enabled or needs manual activation."
}

Write-Host ""
Write-Host "=== DONE ==="
Write-Host "Launcher URL: https://aiyl17.github.io/toonreader-launch/"
Write-Host "Install this URL as a PWA on your phone."


