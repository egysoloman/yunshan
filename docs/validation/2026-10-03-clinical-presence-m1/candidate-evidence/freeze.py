from pathlib import Path
import hashlib, sys
root = Path(sys.argv[1]).resolve()
paths = [path for folder in ['src', 'tests'] for path in (root / folder).rglob('*') if path.is_file()]
paths += [root / name for name in ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html'] if (root / name).exists()]
for path in sorted(paths):
    print(hashlib.sha256(path.read_bytes()).hexdigest(), str(path.relative_to(root)))
