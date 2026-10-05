#!/usr/bin/env python3
"""Prepared only. Do not execute until root gives new short-runtime GO."""
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path('/tmp/yunshan-bedside-native-build-probe-01')
SOURCES = {
    'before09': pathlib.Path('/tmp/yunshan-system-coherent-09/source'),
    'after10': pathlib.Path('/tmp/yunshan-system-coherent-10/source'),
}
SEALED = {
    '/tmp/yunshan-system-coherent-09/dom09-original-evidence.zip': '1b1c74c3774cf48a361d3e0f75715679c0d365e718c9453a8909f0ff0eb8de53',
    '/tmp/yunshan-system-coherent-10/dom10-original-evidence.zip': 'eb205f44b17c252b1532404b4d8809470e636e69d2513e7ff6ef5c5d7a60cfe6',
    '/tmp/yunshan-npc-bed-voxel-candidate-01/npc-bed-voxel-evidence.zip': 'f789c0ce5c58f636d58c256214f0e8535d95bc0f66f5d250df4afdc9b60db3d2',
}
def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()
def inputs():
    records = {}
    for label, source in SOURCES.items():
        manifest_path = source.parent / 'source-snapshot.json'
        manifest = json.loads(manifest_path.read_text())
        baseline = manifest['copiedHashes']
        actual = {name: digest(source / name) for name in baseline}
        records[label] = {'source': str(source), 'manifest': str(manifest_path), 'manifestSHA256': digest(manifest_path),
                          'count': len(actual), 'hashes': actual, 'baselineDifferences': [name for name in baseline if actual[name] != baseline[name]]}
    return records
def sealed():
    return {name: digest(pathlib.Path(name)) for name in SEALED}
def prepared():
    return {path.name: digest(path) for path in ROOT.iterdir() if path.is_file()}
def write(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')

if len(sys.argv) != 3 or sys.argv[1] != '--authorized-run' or sys.argv[2] not in SOURCES:
    raise SystemExit('Only after new root GO: python3 run-once.py --authorized-run before09|after10')
label = sys.argv[2]
out = ROOT / 'runs' / label
out.mkdir(parents=True, exist_ok=False)  # Never silently overwrite or rerun evidence.
receipt = {'label': label, 'startUTC': utc(), 'command': ['node', '--import', 'tsx', str(ROOT / 'probe.mjs'), label],
           'cwd': str(SOURCES[label]), 'envOverrides': {}, 'scope': 'Short five-building logic-only native build/recovery probe, no renderer/GPU/full/default city',
           'sourceBefore': inputs(), 'sealedBefore': sealed(), 'preparedBefore': prepared()}
write(out / 'before.json', receipt)
assert receipt['sourceBefore']['before09']['count'] == 102
assert receipt['sourceBefore']['after10']['count'] == 103
assert all(not record['baselineDifferences'] for record in receipt['sourceBefore'].values())
assert receipt['sealedBefore'] == SEALED
with (out / 'stdout.log').open('xb') as stdout, (out / 'stderr.log').open('xb') as stderr:
    completed = subprocess.run(receipt['command'], cwd=receipt['cwd'], stdout=stdout, stderr=stderr, check=False)
receipt.update({'endUTC': utc(), 'exitCode': completed.returncode, 'sourceAfter': inputs(),
                'sealedAfter': sealed(), 'preparedAfter': prepared(),
                'stdoutSHA256': digest(out / 'stdout.log'), 'stderrSHA256': digest(out / 'stderr.log'),
                'stdoutBytes': (out / 'stdout.log').stat().st_size, 'stderrBytes': (out / 'stderr.log').stat().st_size})
receipt['sourceUnchanged'] = receipt['sourceAfter'] == receipt['sourceBefore']
receipt['sealedUnchanged'] = receipt['sealedAfter'] == receipt['sealedBefore']
receipt['preparedUnchanged'] = receipt['preparedAfter'] == receipt['preparedBefore']
result_path = out / 'result.json'
receipt['resultSHA256'] = digest(result_path) if result_path.exists() else None
receipt['actualResult'] = json.loads(result_path.read_text())['status'] if result_path.exists() else 'NO_RESULT_FILE'
write(out / 'run-status.json', receipt)
print(json.dumps({k: receipt[k] for k in ['label', 'startUTC', 'endUTC', 'exitCode', 'actualResult', 'sourceUnchanged', 'sealedUnchanged', 'preparedUnchanged', 'stdoutSHA256', 'stderrSHA256']}))
assert receipt['sourceUnchanged'] and receipt['sealedUnchanged'] and receipt['preparedUnchanged']
raise SystemExit(completed.returncode)
