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
