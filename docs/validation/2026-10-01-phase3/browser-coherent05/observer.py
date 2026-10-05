import datetime, hashlib, json, pathlib, re, shutil, subprocess, sys

root = pathlib.Path('/tmp/yunshan-phase3-root-coherent-05')
out = pathlib.Path('/workspace/yunshan/artifacts/phase3-browser-coherent05')
out.mkdir(parents=True, exist_ok=True)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = root / 'source-snapshot.json'
copied = json.loads(manifest.read_text())['copiedHashes']
current = lambda: {p: sha(root / p) for p in copied}
start = current()
assert start == copied
entry = re.search(r'src="([^"]+\.js)"', (root / 'dist/index.html').read_text()).group(1)
assert entry == '/assets/index-BH13EXr_.js'
assert sha(root / ('dist' + entry)) == '9b1f4bced913e77feac1f47ded156beb2c08005688d5daa2709a87f501b7081e'
assert json.loads(manifest.read_text())['destination'] == str(root)
record = {'scope': 'Actual unchanged coherent05 npm run test:browser, all11 checks and original60s limits. Fresh diagnostic context; not normal persistent-profile travel, visual/reference approval, or macOS performance.',
          'snapshot': str(root), 'sourceManifestSHA256': sha(manifest), 'fileCount': len(copied),
          'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sourceHashesStart': start,
          'entry': entry, 'entrySHA256Start': sha(root / ('dist' + entry)), 'executedScriptSHA256': sha(root / 'scripts/browser-test.mjs'),
          'observerSHA256': sha(pathlib.Path(__file__))}
shutil.copyfile(manifest, out / 'source-snapshot.json')
shutil.copyfile(root / 'scripts/browser-test.mjs', out / 'executed-browser-test.mjs')
shutil.copyfile(__file__, out / 'observer.py')
(out / 'run-manifest.json').write_text(json.dumps(record, indent=2) + '\n')
with (out / 'browser.log').open('w') as log:
    result = subprocess.run(['npm', 'run', 'test:browser'], cwd=root, stdout=log, stderr=subprocess.STDOUT)
record.update({'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exitCode': result.returncode,
               'sourceHashesEnd': current(), 'entrySHA256End': sha(root / ('dist' + entry))})
record['allCopiedFilesUnchanged'] = record['sourceHashesEnd'] == start
record['entryUnchanged'] = record['entrySHA256End'] == record['entrySHA256Start']
for name in ['browser-results.json', 'day.png', 'night.png', 'interior.png', 'driving-failure.json', 'aviation-failure.json', 'aircraft-city-button-probe.json']:
    path = root / 'artifacts' / name
    if path.exists() and path.stat().st_mtime >= datetime.datetime.fromisoformat(record['startedAt']).timestamp():
        shutil.copyfile(path, out / name)
record['resultSHA256'] = sha(out / 'browser-results.json') if (out / 'browser-results.json').exists() else None
(out / 'run-manifest.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({key: record[key] for key in ['exitCode', 'entry', 'allCopiedFilesUnchanged', 'entryUnchanged', 'resultSHA256']}))
sys.exit(result.returncode or (0 if record['allCopiedFilesUnchanged'] and record['entryUnchanged'] else 1))
