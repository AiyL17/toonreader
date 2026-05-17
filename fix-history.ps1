$TOKEN  = "YOUR_GITHUB_TOKEN"
$REMOTE = "https://AiyL17:$TOKEN@github.com/AiyL17/toonreader.git"
$WORK   = "C:\xampp\htdocs\toonreader"

git -C $WORK config user.email "toonreader@setup.local"
git -C $WORK config user.name  "ToonReader Setup"
git -C $WORK remote set-url origin $REMOTE

# The bad commit is c03a4471 — it has tokens in setup scripts.
# We need to rewrite history to remove those tokens from that commit.
# Strategy: use git filter-branch or BFG. Since BFG may not be installed,
# we'll use git filter-branch with env filter to replace file contents.

Write-Host "Rewriting git history to remove tokens..."

# Create a replacements file
$replaceScript = @"
import sys, os, re

patterns = [
    (r'github_pat_[A-Za-z0-9_]+', 'YOUR_GITHUB_TOKEN'),
    (r'ghp_[A-Za-z0-9]+', 'YOUR_GITHUB_TOKEN'),
]

for root, dirs, files in os.walk('.'):
    dirs[:] = [d for d in dirs if d != '.git']
    for fname in files:
        if fname.endswith(('.ps1', '.bat', '.js', '.json', '.md', '.txt')):
            path = os.path.join(root, fname)
            try:
                with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                new_content = content
                for pattern, replacement in patterns:
                    new_content = re.sub(pattern, replacement, new_content)
                if new_content != content:
                    with open(path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f'Cleaned: {path}')
            except Exception as e:
                print(f'Skip {path}: {e}')
"@

$replaceScript | Out-File -FilePath "$WORK\__clean.py" -Encoding utf8

# Use git filter-branch to rewrite all commits
$env:FILTER_BRANCH_SQUELCH_WARNING = 1
git -C $WORK filter-branch --force --tree-filter "python `"$WORK\__clean.py`"" --tag-name-filter cat -- --all

if ($LASTEXITCODE -ne 0) {
    Write-Host "filter-branch failed. Trying alternative approach..."
    
    # Alternative: squash everything into a single fresh commit
    Write-Host "Squashing all history into one clean commit..."
    
    # Get the current tree
    $tree = git -C $WORK write-tree
    
    # Create a new orphan commit with the current clean tree
    git -C $WORK checkout --orphan clean-main
    git -C $WORK add -A
    
    # Make sure tokens are cleaned in working tree
    Get-ChildItem "$WORK\*.ps1" | ForEach-Object {
        $c = Get-Content $_.FullName -Raw
        $c = $c -replace 'github_pat_[A-Za-z0-9_]+', 'YOUR_GITHUB_TOKEN'
        $c = $c -replace 'ghp_[A-Za-z0-9]+', 'YOUR_GITHUB_TOKEN'
        Set-Content $_.FullName $c
    }
    
    git -C $WORK add -A
    git -C $WORK commit -m "ToonReader - initial commit"
    
    # Replace main with clean-main
    git -C $WORK branch -D main
    git -C $WORK branch -m clean-main main
}

# Clean up
Remove-Item "$WORK\__clean.py" -ErrorAction SilentlyContinue
git -C $WORK for-each-ref --format="delete %(refname)" refs/original/ | git -C $WORK update-ref --stdin
git -C $WORK reflog expire --expire=now --all
git -C $WORK gc --prune=now --aggressive

# Push with force
Write-Host "Force pushing clean history..."
git -C $WORK push origin main --force
if ($LASTEXITCODE -eq 0) {
    Write-Host "Pushed successfully!"
} else {
    Write-Host "Push failed."
    exit 1
}

# Enable Pages
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

git -C $WORK remote set-url origin "https://github.com/AiyL17/toonreader.git"

Write-Host ""
Write-Host "=========================================="
Write-Host " DONE"
Write-Host " Launcher: https://aiyl17.github.io/toonreader/"
Write-Host "=========================================="

