import datetime, hashlib, json, os, pathlib, re, shutil, subprocess, sys

root, out = map(pathlib.Path, sys.argv[1:3])
harness = pathlib.Path(os.environ.get('YUNSHAN_PLAYER_JOURNEY_HARNESS', '/workspace/yunshan/scripts/player-journey.mjs'))
out.mkdir(parents=True, exist_ok=True)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest_path = pathlib.Path(os.environ['YUNSHAN_SNAPSHOT_MANIFEST']) if os.environ.get('YUNSHAN_SNAPSHOT_MANIFEST') else root / 'source-snapshot.json'
original_manifest = json.loads(manifest_path.read_text())
assert pathlib.Path(original_manifest['destination']) == root
expected = original_manifest['copiedHashes']
actual = lambda: {p: sha(root / p) for p in expected}
start = actual()
assert original_manifest['threeWayMatch'] and start == expected
entry = re.search(r'src="([^"]+\.js)"', (root / 'dist/index.html').read_text()).group(1)
entry_path = root / ('dist' + entry)
record = {
    'scope': 'Independent observer for a normal-URL native keyboard/mouse continuation. This observer reads immutable source/build hashes; it does not open the profile, change saved data, or access browser game internals.',
    'snapshot': str(root), 'sourceManifestSHA256': sha(manifest_path),
    'fileCount': len(expected), 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'sourceHashesStart': start, 'entry': entry, 'entrySHA256Start': sha(entry_path),
    'externalHarness': str(harness), 'externalHarnessSHA256Start': sha(harness),
    'copiedHarnessSHA256': sha(root / 'scripts/player-journey.mjs'),
    'observerSHA256': sha(pathlib.Path(__file__)),
}
record['externalHarnessMatchesCopied'] = record['externalHarnessSHA256Start'] == record['copiedHarnessSHA256']
command = ['node', '--import', 'tsx', str(harness), '--workspace=' + str(root), '--output=' + str(out), *sys.argv[3:]]
record['command'] = command
shutil.copyfile(manifest_path, out / 'source-snapshot.json')
shutil.copyfile(harness, out / 'executed-player-journey.mjs')
shutil.copyfile(__file__, out / 'observer.py')
(out / 'run-manifest.json').write_text(json.dumps(record, indent=2) + '\n')
with (out / 'journey.log').open('w') as log:
    result = subprocess.run(command, cwd='/workspace/yunshan', stdout=log, stderr=subprocess.STDOUT)
record.update({
    'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'exitCode': result.returncode, 'sourceHashesEnd': actual(),
    'entrySHA256End': sha(entry_path), 'externalHarnessSHA256End': sha(harness),
    'resultSHA256': sha(out / 'results.json') if (out / 'results.json').exists() else None,
})
record['allCopiedFilesUnchanged'] = record['sourceHashesEnd'] == start
record['entryUnchanged'] = record['entrySHA256End'] == record['entrySHA256Start']
record['externalHarnessUnchanged'] = record['externalHarnessSHA256End'] == record['externalHarnessSHA256Start']
(out / 'run-manifest.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({key: record[key] for key in ['exitCode', 'entry', 'allCopiedFilesUnchanged', 'entryUnchanged', 'externalHarnessUnchanged', 'resultSHA256']}))
sys.exit(result.returncode or (0 if all(record[key] for key in ['allCopiedFilesUnchanged', 'entryUnchanged', 'externalHarnessUnchanged']) else 1))
