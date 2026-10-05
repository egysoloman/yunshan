"""External adaptation of the actual coherent05 observers. No launch before root READY.
Commands are deliberately sequential; this owner never accesses the r10 profile.
"""
import datetime, fcntl, hashlib, json, os, pathlib, re, shutil, subprocess, sys

prepared = pathlib.Path(__file__).resolve().parent
config = json.loads((prepared / 'config.json').read_text())
root = pathlib.Path(config['snapshot'])
stage = sys.argv[1] if len(sys.argv) > 1 else ''
assert stage in ['pilot-home'], 'Choose one explicit stage'
out = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None
assert out and str(out).startswith('/workspace/yunshan/artifacts/'), 'Provide a new original-artifact output directory'
assert not out.exists(), 'Preserve earlier run originals; choose a new directory'
sha = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()

# The absence of root-ready.json is intentional while full npm is still RUNNING.
# This check occurs before the lock, subprocess, preview, browser or Playwright.
ready = json.loads(pathlib.Path(config['rootReadyFile']).read_text())
assert ready['rootFinalReady'] is True and ready['fullRulesCompleted'] is True
assert ready['fullRulesExitCode'] == 0
assert ready['snapshot'] == str(root)
assert ready['sourceManifestSHA256'] == config['sourceManifestSHA256']
assert ready['entrySHA256'] == config['entrySHA256']
assert sha(ready['fullRulesEvidence']) == ready['fullRulesEvidenceSHA256']
manifest_path = root / 'source-snapshot.json'
assert sha(manifest_path) == config['sourceManifestSHA256']
manifest = json.loads(manifest_path.read_text())
assert manifest['snapshotRoot'] == str(root) and manifest['threeWayExact'] is True
assert manifest['inputCount'] == len(manifest['copiedHashes']) == 99
assert manifest['initialHashes'] == manifest['copiedHashes'] == manifest['finalWorkspaceHashes']
current = lambda: {file: sha(root / file) for file in manifest['copiedHashes']}
start = current(); assert start == manifest['copiedHashes']
entry = re.search(r'src="([^"]+\.js)"', (root / 'dist/index.html').read_text()).group(1)
assert entry == config['entry']
entry_path = root / ('dist' + entry)
assert entry_path.stat().st_size == config['entryBytes'] and sha(entry_path) == config['entrySHA256']
assert sha(root / 'dist/index.html') == config['distIndexSHA256']
assert sha(root / 'scripts/browser-test.mjs') == config['originalBrowserSHA256']

executed = prepared / 'pilot-home-runner.mjs'; extra = [str(out)]
gate = prepared / 'document-gate.mjs'
command = ['node', '--import', str(gate), str(executed)] + extra
lock = open('/tmp/yunshan-v4-browser-visual-gpu-owner.lock', 'w')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
record = {'scope': 'Exact final99 source/strict entry; original assertions and original sixty-second limits. Linux software GPU; no Mac performance or ordinary player journey claim.',
  'stage': stage, 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'actualCwd': str(root), 'actualCommand': command, 'observerSHA256Start': sha(__file__),
  'sourceManifestSHA256Start': sha(manifest_path), 'sourceHashesStart': start,
  'entry': entry, 'entrySHA256Start': sha(entry_path), 'entryBytes': entry_path.stat().st_size,
  'distIndexSHA256Start': sha(root / 'dist/index.html'), 'executedSHA256Start': sha(executed),
  'documentGateSHA256Start': sha(gate), 'sourceGateSHA256Start': sha(prepared / 'fixed-source-gate.mjs'),
  'configSHA256Start': sha(prepared / 'config.json'), 'rootReady': ready,
  'rootReadySHA256Start': sha(config['rootReadyFile']), 'fileCount': 99, 'persistentProfile': None, 'supportingArtifactHashesStart': {name:sha(prepared / name) for name in ['body-capture-observers.mjs','pilot-market-b24-fixture.json','export-pilot-fixture.mts']}}
out.mkdir(parents=True)
for p, name in [(manifest_path,'source-snapshot.json'),(executed,'executed-wrapper.mjs'),
                (gate,'executed-document-gate.mjs'),(prepared / 'fixed-source-gate.mjs','executed-source-gate.mjs'),
                (pathlib.Path(__file__),'observer.py'),(prepared / 'config.json','execution-config.json')]:
    shutil.copyfile(p,out / name)
(out / 'run-manifest.json').write_text(json.dumps(record,indent=2)+'\n')
env = os.environ.copy(); env['YUNSHAN_GATE_OUTPUT'] = str(out / 'document-provenance.json')
env['YUNSHAN_VISUAL_PORT'] = str(config['opticalPort'])
result = None
try:
    with (out / 'execution.log').open('w') as log:
        result = subprocess.run(command,cwd=root,stdout=log,stderr=subprocess.STDOUT,env=env)
finally:
    record.update({'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'exitCode':result.returncode if result else None,'sourceHashesEnd':current(),
      'sourceManifestSHA256End':sha(manifest_path),'entrySHA256End':sha(entry_path),
      'distIndexSHA256End':sha(root / 'dist/index.html'),'executedSHA256End':sha(executed),
      'documentGateSHA256End':sha(gate),'sourceGateSHA256End':sha(prepared / 'fixed-source-gate.mjs'),
      'configSHA256End':sha(prepared / 'config.json'),'rootReadySHA256End':sha(config['rootReadyFile']),
      'observerSHA256End':sha(__file__)})
    record['supportingArtifactHashesEnd'] = {name:sha(prepared / name) for name in record['supportingArtifactHashesStart']}
    record['supportingArtifactsUnchanged'] = record['supportingArtifactHashesStart'] == record['supportingArtifactHashesEnd']
    record['allInputsUnchanged'] = record['sourceHashesEnd'] == start
    record['allProvenanceUnchanged'] = all(record[k+'Start'] == record[k+'End'] for k in
      ['sourceManifestSHA256','entrySHA256','distIndexSHA256','executedSHA256','documentGateSHA256',
       'sourceGateSHA256','configSHA256','rootReadySHA256','observerSHA256'])
    if False:
        started = datetime.datetime.fromisoformat(record['startedAt']).timestamp()
        record['browserOriginalArtifacts'] = {}
        for p in sorted((root / 'artifacts').glob('*')):
            if p.is_file() and p.stat().st_mtime >= started and p.suffix in ['.json','.png']:
                shutil.copyfile(p,out / p.name)
                record['browserOriginalArtifacts'][p.name] = sha(p)
    record['status'] = 'passed' if result and result.returncode == 0 and record['allInputsUnchanged'] and record['allProvenanceUnchanged'] and record['supportingArtifactsUnchanged'] else 'failed'
    (out / 'run-manifest.json').write_text(json.dumps(record,indent=2)+'\n')
    fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
print(json.dumps({k:record[k] for k in ['status','exitCode','entry','allInputsUnchanged','allProvenanceUnchanged']}))
sys.exit(result.returncode if result and result.returncode else (0 if record['status']=='passed' else 1))
