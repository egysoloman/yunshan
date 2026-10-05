import datetime, hashlib, json, os, pathlib, re, subprocess, traceback

base = pathlib.Path('/tmp/yunshan-system-coherent-14')
source = base / 'source'
shared = pathlib.Path('/workspace/yunshan')
manifest = json.loads((base / 'source-snapshot.json').read_text())
excluded = {'.gitattributes', '.gitignore', 'AGENTS.md', '开发备忘录.md', '提示词.md'}
keys = sorted(manifest['copiedHashes'])
executables = [key for key in keys if key not in excluded]
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def hashes(root, names): return {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in names}
def record():
    (base / 'build-related-run-status.json').write_text(json.dumps(status, ensure_ascii=False, indent=2) + '\n')
status = {'state': 'RUNNING', 'launcherPID': os.getpid(), 'startedAtUTC': now(),
          'inputCount': len(keys), 'sharedExecutableCount': len(executables),
          'manifestSHA256': hashlib.sha256((base / 'source-snapshot.json').read_bytes()).hexdigest(),
          'sourceStart': hashes(source, keys), 'sharedExecutableStart': hashes(shared, executables), 'runs': [],
          'scope': 'Actual composite14 build and related controller/retail43; no full npm, GPU, native home, Mac or whole city steadystate conclusion.'}
assert status['sourceStart'] == manifest['copiedHashes']
assert status['sharedExecutableStart'] == {name: manifest['copiedHashes'][name] for name in executables}
record()
try:
    commands = [('build', ['npm', 'run', 'build']),
                ('related-controller-retail', ['node', '--import', 'tsx', '--test', '--test-isolation=none',
                    'tests/controller-input-time.test.ts', 'tests/controller.test.ts',
                    'tests/controller-v4.test.ts', 'tests/retail-period.test.ts'])]
    for label, command in commands:
        log = base / (label + '.log')
        run = {'label': label, 'command': command, 'cwd': str(source), 'startedAtUTC': now(), 'log': str(log)}
        status['runs'].append(run)
        with log.open('wb') as stream:
            child = subprocess.Popen(command, cwd=source, stdout=stream, stderr=subprocess.STDOUT)
            run['pid'] = child.pid
            record()
            print(json.dumps({'state': 'RUNNING', 'label': label, 'pid': child.pid, 'startedAtUTC': run['startedAtUTC']}), flush=True)
            code = child.wait()
        raw = log.read_bytes()
        run.update({'exitCode': code, 'endedAtUTC': now(), 'rawBytes': len(raw), 'logSHA256': hashlib.sha256(raw).hexdigest()})
        run['summary'] = {key: int(value) for key, value in re.findall(rb'# (tests|pass|fail|cancelled|skipped|todo) (\d+)', raw)} if False else {
            key.decode(): int(value) for key, value in re.findall(rb'# (tests|pass|fail|cancelled|skipped|todo) (\d+)', raw)}
        record()
        print(json.dumps({'label': label, 'exitCode': code, 'summary': run['summary'], 'endedAtUTC': run['endedAtUTC']}), flush=True)
        if code: raise RuntimeError(label + ' failed; original raw log preserved')
    index = (source / 'dist/index.html').read_text()
    entries = re.findall(r'<script[^>]+src="([^"]+)"', index)
    assert len(entries) == 1
    entry = entries[0]
    asset = source / 'dist' / entry.lstrip('/')
    status['build'] = {'entry': entry, 'entryBytes': asset.stat().st_size, 'entrySHA256': hashlib.sha256(asset.read_bytes()).hexdigest(),
        'sourceMaps': {str(path.relative_to(source / 'dist')): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted((source / 'dist').rglob('*.map'))}}
    status['state'] = 'PASS_BUILD_AND_RELATED43'
    status['exitCode'] = 0
except Exception:
    status['state'] = 'FAIL'
    status['exitCode'] = 1
    status['error'] = traceback.format_exc()
finally:
    status['sourceEnd'] = hashes(source, keys)
    status['sharedExecutableEnd'] = hashes(shared, executables)
    status['sourceStable'] = status['sourceStart'] == status['sourceEnd']
    status['sharedExecutableStable'] = status['sharedExecutableStart'] == status['sharedExecutableEnd']
    if not status['sourceStable'] or not status['sharedExecutableStable']:
        status['state'], status['exitCode'] = 'FAIL_SOURCE_CHANGED', 1
    status['endedAtUTC'] = now()
    record()
    print(json.dumps({key: status[key] for key in ['state', 'exitCode', 'sourceStable', 'sharedExecutableStable', 'endedAtUTC']}), flush=True)
raise SystemExit(status['exitCode'])
