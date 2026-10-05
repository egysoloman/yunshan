import datetime, hashlib, json, os, pathlib, re, subprocess, traceback

base = pathlib.Path('/tmp/yunshan-system-coherent-18')
source, shared = base / 'source', pathlib.Path('/workspace/yunshan')
manifest = json.loads((base / 'source-snapshot.json').read_text())
names = sorted(manifest['copiedHashes'])
excluded = {'.gitattributes', '.gitignore', 'AGENTS.md', '开发备忘录.md', '提示词.md'}
executable = [name for name in names if name not in excluded]
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def hashes(root, selected): return {name: sha(root / name) for name in selected}
receipt_path = base / 'build-receipt.json'
assert not receipt_path.exists() and not (source / 'dist').exists()
receipt = {'state': 'RUNNING', 'launcherPID': os.getpid(), 'startedAtUTC': now(),
    'sourceInputCount': len(names), 'sharedExecutableCount': len(executable),
    'sourceManifestSHA256': sha(base / 'source-snapshot.json'),
    'sourceStart': hashes(source, names), 'sharedExecutableStart': hashes(shared, executable),
    'scope': 'Fresh production build of exact integrated E1 final04 executable inputs; prior candidate test scopes retain their original source binding. No full npm/WebGL/ART/macOS/economic steady-state claim.'}
def record(): receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
assert receipt['sourceStart'] == manifest['copiedHashes']
assert receipt['sharedExecutableStart'] == {name: manifest['copiedHashes'][name] for name in executable}
record()
code = 1
try:
    log = base / 'build.raw.log'
    receipt['command'] = ['npm', 'run', 'build']
    with log.open('xb') as stream:
        child = subprocess.Popen(receipt['command'], cwd=source, stdout=stream, stderr=subprocess.STDOUT)
        receipt['workerPID'] = child.pid
        receipt['workerStartTicks'] = pathlib.Path('/proc', str(child.pid), 'stat').read_text().rsplit(')', 1)[1].split()[19]
        record()
        print(json.dumps({'state': 'RUNNING', 'pid': child.pid, 'startedAtUTC': receipt['startedAtUTC']}), flush=True)
        code = child.wait()
    receipt.update({'buildExitCode': code, 'rawSha256': sha(log), 'rawBytes': log.stat().st_size})
    assert code == 0, 'Original failed build is retained.'
    dist = source / 'dist'
    files = {str(p.relative_to(dist)): sha(p) for p in sorted(dist.rglob('*')) if p.is_file()}
    entries = re.findall(r'<script[^>]+src="([^"]+)"', (dist / 'index.html').read_text())
    assert len(entries) == 1
    entry = entries[0]
    asset = dist / entry.lstrip('/')
    maps = {name: digest for name, digest in files.items() if name.endswith('.map')}
    assert entry.lstrip('/') + '.map' in maps
    receipt['production'] = {'freshForThisSource': True, 'entryPath': entry, 'entryBytes': asset.stat().st_size,
        'entrySha256': sha(asset), 'distHashes': files, 'maps': maps}
    receipt['state'] = 'PASS_FRESH_BUILD'
except Exception:
    code = 1
    receipt.update({'state': 'FAIL', 'error': traceback.format_exc()})
finally:
    receipt['sourceEnd'] = hashes(source, names)
    receipt['sharedExecutableEnd'] = hashes(shared, executable)
    receipt['sourceStable'] = receipt['sourceStart'] == receipt['sourceEnd']
    receipt['sharedExecutableStable'] = receipt['sharedExecutableStart'] == receipt['sharedExecutableEnd']
    if not receipt['sourceStable'] or not receipt['sharedExecutableStable']:
        code = 1
        receipt['state'] = 'FAIL_INPUT_CHANGED'
    receipt.update({'exitCode': code, 'endedAtUTC': now(), 'workerPresentAfterWait': pathlib.Path('/proc', str(receipt.get('workerPID', 0))).exists()})
    record()
    print(json.dumps({key: receipt[key] for key in ['state', 'exitCode', 'sourceStable', 'sharedExecutableStable', 'endedAtUTC']}), flush=True)
raise SystemExit(code)
