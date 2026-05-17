$files = @(
    'setup-github.ps1',
    'setup-github2.ps1',
    'setup-github3.ps1',
    'setup-github4.ps1',
    'setup-launcher.ps1',
    'check-github.ps1',
    'push-launcher.ps1'
)

foreach ($f in $files) {
    $path = "C:\xampp\htdocs\toonreader\$f"
    if (Test-Path $path) {
        $content = Get-Content $path -Raw
        $content = $content -replace 'github_pat_[A-Za-z0-9_]+', 'YOUR_GITHUB_TOKEN'
        $content = $content -replace 'ghp_[A-Za-z0-9]+', 'YOUR_GITHUB_TOKEN'
        Set-Content $path $content
        Write-Host "Cleaned: $f"
    }
}
Write-Host "Done."

