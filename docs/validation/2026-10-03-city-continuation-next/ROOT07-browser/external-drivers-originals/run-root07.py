"""Prepared ROOT07 phase driver. Never executes without a root authorization file.

Run one phase at a time, and preserve failures/partials rather than overwrite.
The unchanged v2 wrapper owns each command's new process session and raw log.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys

HERE = Path(__file__).resolve().parent
DIRECTORIES = ('src', 'tests', 'scripts', 'adapters', 'public')
CONFIGS = ('package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html')
PHASES = {
    'build': (['npm', 'run', 'build'], 300),
    'rendering': (['node', '--import', 'tsx', '--test', '--test-isolation=none',
                   'tests/rendering.test.ts', 'tests/architecture-bodies.test.ts',
                   'tests/chunk-residency.test.ts'], 600),
    'dom': (['npm', 'run', 'test:ui'], 600),
    'webgl': (['npm', 'run', 'test:browser'], 900),
}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as reader:
        for chunk in iter(lambda: reader.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def regular_files(root):
    """No symlink traversal; never scan HOME, hidden configuration or secrets."""
    if not root.exists():
        return []
    result = []
    for directory, names, files in os.walk(root, followlinks=False):
        for name in names[:]:
            full = Path(directory) / name
            if full.is_symlink():
                raise ValueError('Unexpected symlink in bounded runtime inputs: ' + str(full))
        for name in files:
            full = Path(directory) / name
            mode = full.lstat().st_mode
            if not stat.S_ISREG(mode):
                raise ValueError('Unexpected nonregular bounded input: ' + str(full))
            result.append(full)
    return sorted(result)


def runtime_inputs(source):
    result = []
    for directory in DIRECTORIES:
        result.extend(regular_files(source / directory))
    for name in CONFIGS:
        full = source / name
        if full.exists():
            assert stat.S_ISREG(full.lstat().st_mode)
            result.append(full)
    return {str(p.relative_to(source)): digest(p) for p in sorted(result)}


def freeze(source, destination, mapping):
    destination.mkdir(parents=True, exist_ok=False)
    for relative, expected in mapping.items():
        original, target = source / relative, destination / relative
        assert digest(original) == expected, 'Original changed before snapshot: ' + relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
        assert digest(target) == expected and digest(original) == expected, 'Snapshot copy changed: ' + relative


def artifact_mapping(source):
    return {str(p.relative_to(source)): digest(p) for p in regular_files(source / 'artifacts')}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


parser = argparse.ArgumentParser()
parser.add_argument('phase', choices=(*PHASES, 'captures'))
parser.add_argument('source')
parser.add_argument('new_scope')
parser.add_argument('authorization')
args = parser.parse_args()
source = Path(args.source).resolve()
scope = Path(args.new_scope).resolve()
authorization_path = Path(args.authorization).resolve()
assert source.is_dir() and not scope.exists()
assert str(source).startswith('/workspace/yunshan-work/')
assert not any('root06' in part.lower() for part in source.parts), 'Do not execute ROOT06 DRAFT'
authorization = json.loads(authorization_path.read_text())
assert authorization['status'] == 'ROOT07_BROWSER_EXECUTION_AUTHORIZED'
assert Path(authorization['sourcePath']).resolve() == source
assert authorization['scope'] == 'ROOT07'
assert authorization['exclusiveGPU'] is True
before = runtime_inputs(source)
assert before == authorization['inputs'], 'Source differs from root-authorized final ROOT07 frozen inputs'
scope.mkdir(parents=True, mode=0o700)
write_json(scope / 'authorization-used.json', authorization)
freeze(source, scope / 'source-before', before)
artifacts_before = artifact_mapping(source)
artifact_times_before = {name: (source / name).stat().st_mtime_ns for name in artifacts_before}
write_json(scope / 'artifacts-before.json', artifacts_before)
if artifacts_before:
    freeze(source, scope / 'artifacts-before-originals', artifacts_before)
dist_before = {str(p.relative_to(source)): digest(p) for p in regular_files(source / 'dist')}
write_json(scope / 'dist-before.json', dist_before)
if dist_before:
    freeze(source, scope / 'dist-before-originals', dist_before)
if args.phase == 'captures':
    command = ['node', str(HERE / 'capture-root07.mjs'), str(source), str(scope / 'capture-originals'), str(authorization_path)]
    limit = 900
else:
    command, limit = PHASES[args.phase]
environment = dict(os.environ)
if args.phase == 'dom':
    environment['YUNSHAN_UI_PORT'] = '4318'
started = stamp()
wrapped = subprocess.run([sys.executable, str(HERE / 'run-phase-v2-original.py'), str(source),
                          str(scope / 'run'), json.dumps(command), str(limit)], env=environment,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
(scope / 'wrapper-raw.log').write_bytes(wrapped.stdout)
after = runtime_inputs(source)
freeze(source, scope / 'source-after', after)
artifacts_after = artifact_mapping(source)
artifact_times_after = {name: (source / name).stat().st_mtime_ns for name in artifacts_after}
write_json(scope / 'artifacts-after.json', artifacts_after)
if artifacts_after:
    freeze(source, scope / 'artifacts-after-originals', artifacts_after)
dist_after = {str(p.relative_to(source)): digest(p) for p in regular_files(source / 'dist')}
write_json(scope / 'dist-after.json', dist_after)
if dist_after:
    freeze(source, scope / 'dist-after-originals', dist_after)
produced = {name: sha for name, sha in artifacts_after.items() if artifacts_before.get(name) != sha}
unchanged = {name: sha for name, sha in artifacts_after.items() if artifacts_before.get(name) == sha}
rewritten_same = {name: sha for name, sha in unchanged.items() if artifact_times_before[name] != artifact_times_after[name]}
untouched = {name: sha for name, sha in unchanged.items() if name not in rewritten_same}
write_json(scope / 'artifact-provenance.json', {'newOrChanged': produced, 'rewrittenSameSHA256': rewritten_same,
    'preexistingUntouched': untouched, 'beforeMtimeNS': artifact_times_before, 'afterMtimeNS': artifact_times_after,
    'note': 'All originals retained. Untouched preexisting files are not attributed to this run. Identical rewritten result bytes remain explicit.'})
result_file = {'dom': 'ui-results.json', 'webgl': 'browser-results.json'}.get(args.phase)
actual_result = None
if result_file and (scope / 'artifacts-after-originals' / 'artifacts' / result_file).is_file():
    actual_result = json.loads((scope / 'artifacts-after-originals' / 'artifacts' / result_file).read_text())
expected_checks = {'dom': 35, 'webgl': 11}.get(args.phase)
observed_checks = actual_result.get('checks') if actual_result else None
if isinstance(observed_checks, list):
    observed_checks = len(observed_checks)
# The original browser result stores checks as a list of names/data; UI stores count.
if observed_checks is None and actual_result and isinstance(actual_result.get('results'), list):
    observed_checks = len(actual_result['results'])
owned_receipt = json.loads((scope / 'run' / 'receipt.json').read_text()) if (scope / 'run' / 'receipt.json').is_file() else {}
status = 'PASS' if wrapped.returncode == 0 and before == after else owned_receipt.get('status', 'FAIL')
if status == 'PASS' and (wrapped.returncode or before != after):
    status = 'FAIL'
if expected_checks is not None:
    if observed_checks != expected_checks or not actual_result or actual_result.get('failure') or actual_result.get('errors'):
        status = 'FAIL'
    if args.phase == 'dom' and actual_result and actual_result.get('status') != 'passed':
        status = 'FAIL'
    if 'artifacts/' + result_file not in produced and 'artifacts/' + result_file not in rewritten_same:
        status = 'FAIL'
if owned_receipt.get('timedOut'):
    status = 'TIMEOUT_PARTIAL'
receipt = {'phase': args.phase, 'startedAt': started, 'endedAt': stamp(), 'status': status,
    'command': command, 'timeoutSeconds': limit, 'wrapperExitCode': wrapped.returncode, 'ownedProcessReceipt': owned_receipt,
    'sourcePath': str(source), 'inputCount': len(before), 'inputsStable': before == after,
    'authorizationSHA256': digest(authorization_path), 'originalWrapperSHA256': digest(HERE / 'run-phase-v2-original.py'),
    'phaseDriverSHA256': digest(Path(__file__)), 'expectedChecks': expected_checks, 'observedChecks': observed_checks,
    'actualResultFile': result_file, 'actualResult': actual_result,
    'distStable': dist_before == dist_after, 'scope': 'ROOT07 actual isolated run; Linux software WebGL is functional evidence only',
    'ART': 'FAIL_REFERENCE_GAPS_REMAIN', 'Mac': 'NOT_RUN', 'Library': 'ROOT_WILL_DELIVER_UNIFIED_ORIGINALS'}
write_json(scope / 'phase-receipt.json', receipt)
print(json.dumps(receipt, ensure_ascii=False))
sys.exit(0 if status == 'PASS' else 1)
