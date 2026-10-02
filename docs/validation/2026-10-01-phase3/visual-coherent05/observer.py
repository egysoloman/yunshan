import datetime, hashlib, json, os, pathlib, re, shutil, subprocess, sys

root = pathlib.Path('/tmp/yunshan-phase3-root-coherent-05')
out = pathlib.Path('/workspace/yunshan/artifacts/phase3-visual-coherent05')
wrapper = pathlib.Path('/tmp/yunshan-coherent04-fixed-optics-capture.mjs')
selection = 'core-waterfall,market-street,residential-first-person,bridge-structure,bridge-walk-center,bridge-public-road'
out.mkdir(parents=True, exist_ok=True)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = root / 'source-snapshot.json'
copied = json.loads(manifest.read_text())['copiedHashes']
current = lambda: {p: sha(root / p) for p in copied}
start = current()
assert start == copied
assert root == pathlib.Path('/tmp/yunshan-phase3-root-coherent-05')
assert json.loads(manifest.read_text())['destination'] == str(root)
assert len(copied) == 89
entry = re.search(r'src="([^"]+\.js)"', (root / 'dist/index.html').read_text()).group(1)
assert entry == '/assets/index-BH13EXr_.js'
assert sha(root / ('dist' + entry)) == '9b1f4bced913e77feac1f47ded156beb2c08005688d5daa2709a87f501b7081e'
gate = pathlib.Path('/tmp/yunshan-coherent05-document-gate.mjs')
command = ['node', '--import', str(gate), str(wrapper), str(out), selection]
record = {'scope': 'Six original diagnostic camera poses, new fixed pixelRatio1/FOV48/noon/1440x900. Full89-source/entry and separate external shadow/residency wrapper start/end observer. No persistent player profile or ordinary travel. Technical pass is separate from actual reference visual review; old obstructed bridge-structure remains included.',
          'snapshot': str(root), 'sourceManifestSHA256': sha(manifest), 'fileCount': len(copied),
          'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sourceHashesStart': start,
          'entry': entry, 'entrySHA256Start': sha(root / ('dist' + entry)),
          'wrapper': str(wrapper), 'wrapperSHA256Start': sha(wrapper),
          'originalVisualReviewSHA256': sha(root / 'scripts/visual-review.mjs'),
          'originalMacro6WrapperSHA256': sha(pathlib.Path('/tmp/yunshan-phase2-visual-macro6-capture.mjs')),
          'observerSHA256': sha(pathlib.Path(__file__)), 'views': selection.split(','), 'actualCwd': str(root),
          'actualCommand': command, 'documentGateSHA256Start': sha(gate)}
shutil.copyfile(manifest, out / 'source-snapshot.json')
shutil.copyfile(wrapper, out / 'executed-optics-shadow-wrapper.mjs')
shutil.copyfile(__file__, out / 'observer.py')
shutil.copyfile(gate, out / 'executed-document-gate.mjs')
(out / 'run-manifest.json').write_text(json.dumps(record, indent=2) + '\n')
env = os.environ.copy(); env['YUNSHAN_VISUAL_PORT'] = '4198'
env['YUNSHAN_GATE_OUTPUT'] = str(out / 'document-provenance.json')
print(json.dumps({'exactWorkspace': str(root), 'entry': entry, 'entrySHA256': record['entrySHA256Start'], 'fileCount': len(copied), 'actualCwd': str(root), 'actualCommand': command}), flush=True)
with (out / 'capture.log').open('w') as log:
    result = subprocess.run(command, cwd=root, stdout=log, stderr=subprocess.STDOUT, env=env)
record.update({'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exitCode': result.returncode,
               'sourceHashesEnd': current(), 'entrySHA256End': sha(root / ('dist' + entry)), 'wrapperSHA256End': sha(wrapper)})
record['allCopiedFilesUnchanged'] = record['sourceHashesEnd'] == start
record['entryUnchanged'] = record['entrySHA256End'] == record['entrySHA256Start']
record['wrapperUnchanged'] = record['wrapperSHA256End'] == record['wrapperSHA256Start']
record['documentGateSHA256End'] = sha(gate)
record['documentGateUnchanged'] = record['documentGateSHA256End'] == record['documentGateSHA256Start']
aggregate = out / ('capture-results-' + selection + '.json')
record['resultSHA256'] = sha(aggregate) if aggregate.exists() else None
(out / 'run-manifest.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({key: record[key] for key in ['exitCode', 'entry', 'allCopiedFilesUnchanged', 'entryUnchanged', 'wrapperUnchanged', 'resultSHA256']}))
sys.exit(result.returncode or (0 if record['allCopiedFilesUnchanged'] and record['entryUnchanged'] and record['wrapperUnchanged'] else 1))
