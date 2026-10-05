#!/usr/bin/env python3
"""Prepared orchestration only. Requires later explicit root CPU GO flag."""
from pathlib import Path
import argparse, datetime, hashlib, json, math, os, subprocess, sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
AUTHORIZATION = '--authorized-m2-causal-before'
LOADER = Path('/workspace/yunshan/node_modules/tsx/dist/loader.mjs')

def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path, value):
    with path.open('x', encoding='utf-8') as output:
        json.dump(value, output, ensure_ascii=False, indent=2); output.write('\n')
def fingerprint(spec):
    rows = []
    for row in spec['files']:
        path = Path(row['path'])
        if path.is_symlink():
            raise RuntimeError('refuse symlink artifact input: ' + str(path))
        actual = digest(path)
        if actual != row['sha256']:
            raise RuntimeError('input SHA mismatch: ' + str(path))
        rows.append({**row, 'actualSha256': actual, 'matched': True})
    return {'atUtc': utc(), 'members': rows, 'allExpectedHashesMatch': True}
def trace_from(log, wanted):
    found = []
    for raw in log.read_text(errors='replace').splitlines():
        if raw.startswith('# '): raw = raw[2:]
        try: item = json.loads(raw)
        except (ValueError, TypeError): continue
        if isinstance(item, dict) and item.get('label') == wanted: found.append(item)
    return found

def classify(case, exit_code, stdout):
    traces = trace_from(stdout, case['traceLabel'])
    result = {'actualChildExit': exit_code, 'traceCount': len(traces), 'causal': False,
              'classification': 'CAUSAL_FALSE_FIXTURE_NOT_ESTABLISHED'}
    if len(traces) != 1: return result
    record = traces[0]['record']
    earned = record['earned']; before = record['before']; after = record['after']
    phase_start = before['clock']; phase_end = after['clock']
    meters = record['meters']; speed = record['speed']; delta = record['actualTreatmentDeltaMinutes']
    numbers = [phase_start, phase_end, meters, speed, delta, earned['start'], earned['end'], earned['minutes']]
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in numbers): return result
    if abs(phase_end - phase_start - 4) > 1e-7 or not (0 < meters < 4 * speed): return result
    if abs(earned['end'] - earned['start'] - earned['minutes']) > 1e-7 or earned['minutes'] <= 0 or earned['end'] > phase_end + 1e-7: return result
    starts = [phase_start, earned['start']]; ends = [phase_end, earned['end']]
    if case['id'] == 'D2':
        patient = record['derivedPatientWindow']; starts.append(patient['start']); ends.append(patient['end'])
    overlap = max(0, min(ends) - max(starts))
    if not (0 < overlap < 4 - 1e-7): return result
    result.update({'causal': True, 'actualTreatmentDeltaMinutes': delta,
                   'boundedCurrentIntervalMinutes': overlap,
                   'oracle': 'ordered real source/route/physical/attendance assertions completed before trace; original hard assertion still present'})
    if exit_code != 0 and delta > overlap + 1e-7:
        result['classification'] = 'ACTUAL_OLD_TIMING_BEHAVIOR_FAIL'
    elif exit_code == 0 and delta <= overlap + 1e-7:
        result['classification'] = 'BOUNDED_CURRENT_WINDOW_NO_OLD_FAILURE_FOUND'
    else:
        result['causal'] = False; result['classification'] = 'CAUSAL_FALSE_OTHER_ASSERTION_FAILURE'
    return result

def artifact_members(directory):
    rows = []
    for path in sorted(directory.rglob('*')):
        if path.is_symlink(): raise RuntimeError('refuse output symlink: ' + str(path))
        if path.is_file(): rows.append({'path': str(path.relative_to(directory)), 'bytes': path.stat().st_size, 'sha256': digest(path)})
    return rows

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(AUTHORIZATION, action='store_true', dest='authorized')
    args = parser.parse_args()
    if not args.authorized: parser.error('root CPU GO has not been encoded; preparation must not run')
    if os.environ.get('NODE_OPTIONS'):
        raise RuntimeError('unexpected NODE_OPTIONS: abort without dumping environment')
    spec = json.loads((HERE / 'execution-inputs.json').read_text())
    before_all = fingerprint(spec)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    run_dir = ROOT / ('before-execution-' + stamp)
    run_dir.mkdir(exist_ok=False)
    write(run_dir / 'invocation-start.json', {'status': 'RUNNING', 'wrapperPid': os.getpid(), 'cwd': str(ROOT), 'argv': sys.argv,
        'startedAtUtc': utc(), 'authorizationScope': 'D1+D2 original final03 only; no M2 fix, no D3/contract/test expansion',
        'sourceCount': 124, 'forbiddenExecuted': {'GPU': False, 'build': False, 'fullSuite': False, 'ZIP': False, 'Library': False}})
    write(run_dir / 'input-first.json', before_all)
    print(json.dumps({'event': 'M2_WRAPPER_STARTED', 'wrapperPid': os.getpid(), 'runDir': str(run_dir), 'atUtc': utc()}), flush=True)
    cases = [{'id': 'D1', 'file': 'm2-doctor-late.test.ts', 'traceLabel': 'M2_DOCTOR_LATE'},
             {'id': 'D2', 'file': 'm2-npc-patient-late.test.ts', 'traceLabel': 'M2_NPC_PATIENT_LATE'}]
    receipts = []
    for case in cases:
        case_dir = run_dir / case['id']; case_dir.mkdir()
        write(case_dir / 'input-first.json', fingerprint(spec))
        capture_dir = case_dir / 'checkpoints'; capture_dir.mkdir()
        argv = ['node', '--import', str(LOADER), '--test', '--test-isolation=none', str(HERE / 'drivers' / case['file'])]
        env = os.environ.copy(); env['YUNSHAN_M2_CAPTURE_DIR'] = str(capture_dir)
        # D3 is NOT_READY and cannot be implicitly enabled by inherited env.
        env.pop('YUNSHAN_M2_AUTHENTIC_HISTORY_INPUT', None)
        stdout_path = case_dir / 'stdout.log'; stderr_path = case_dir / 'stderr.log'
        started = utc()
        with stdout_path.open('xb') as stdout, stderr_path.open('xb') as stderr:
            process = subprocess.Popen(argv, cwd=ROOT, env=env, stdout=stdout, stderr=stderr)
            start = {'id': case['id'], 'status': 'RUNNING', 'startedAtUtc': started,
                     'ownedPid': process.pid, 'wrapperPid': os.getpid(), 'cwd': str(ROOT), 'argv': argv,
                     'selectedEnv': {'YUNSHAN_M2_CAPTURE_DIR': str(capture_dir), 'YUNSHAN_M2_AUTHENTIC_HISTORY_INPUT': 'UNSET', 'NODE_OPTIONS': 'UNSET_OR_EMPTY'}}
            write(case_dir / 'command-start.json', start)
            print(json.dumps({'event': 'M2_CASE_STARTED', **start, 'runDir': str(run_dir)}), flush=True)
            exit_code = process.wait()
        ended = utc()
        write(case_dir / 'input-last.json', fingerprint(spec))
        classification = classify(case, exit_code, stdout_path)
        checkpoints = []
        for facts in sorted(capture_dir.glob('*.facts.json')):
            item = json.loads(facts.read_text()); checkpoints.append({'file': facts.name, 'label': item['label'], 'tick': item['tick'], 'clock': item['clock']})
        end = {**start, 'status': 'EXITED', 'endedAtUtc': ended, 'exitCode': exit_code,
               'ownedChildClosed': process.poll() is not None, 'classification': classification,
               'checkpoints': checkpoints,
               'stdout': {'sha256': digest(stdout_path), 'bytes': stdout_path.stat().st_size},
               'stderr': {'sha256': digest(stderr_path), 'bytes': stderr_path.stat().st_size}}
        write(case_dir / 'command-end.json', end)
        write(case_dir / 'members-sha256.json', artifact_members(case_dir))
        receipts.append(end)
        print(json.dumps({'event': 'M2_CASE_EXITED', 'id': case['id'], 'pid': process.pid, 'exit': exit_code, 'classification': classification, 'atUtc': ended}), flush=True)
    write(run_dir / 'input-last.json', fingerprint(spec))
    status = 'ACTUAL_OLD_TIMING_BEHAVIOR_FAIL' if all(r['classification']['classification'] == 'ACTUAL_OLD_TIMING_BEHAVIOR_FAIL' for r in receipts) else 'ACTUAL_SCOPED_RESULTS_SEE_CASES'
    summary = {'status': status, 'endedAtUtc': utc(), 'wrapperPid': os.getpid(), 'runDir': str(run_dir),
               'allOwnedChildrenClosed': all(r['ownedChildClosed'] for r in receipts), 'originalAndAsRunInputsUnchanged': True,
               'cases': receipts, 'D3': 'NOT_RUN_NOT_READY_AUTHENTIC_INPUT_MISSING',
               'mathContract': 'NOT_RUN_NOT_RUNTIME_EVIDENCE', 'candidateFix': 'NOT_IMPLEMENTED'}
    write(run_dir / 'summary.json', summary)
    write(run_dir / 'members-sha256.json', artifact_members(run_dir))
    print(json.dumps({'event': 'M2_BEFORE_COMPLETE', 'status': status, 'runDir': str(run_dir), 'allOwnedChildrenClosed': summary['allOwnedChildrenClosed'], 'atUtc': utc()}), flush=True)
    return 1 if any(r['exitCode'] != 0 for r in receipts) else 0

if __name__ == '__main__':
    raise SystemExit(main())
