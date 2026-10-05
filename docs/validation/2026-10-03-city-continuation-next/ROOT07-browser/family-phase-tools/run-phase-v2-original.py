import datetime, hashlib, json, os, pathlib, signal, subprocess, sys, time

source, run_dir, encoded_argv, seconds = sys.argv[1:]
source, run = pathlib.Path(source).resolve(), pathlib.Path(run_dir)
argv, timeout = json.loads(encoded_argv), float(seconds)
assert source.is_dir() and not run.exists() and isinstance(argv, list) and all(isinstance(x, str) for x in argv)
assert 0 < timeout <= 7200
run.mkdir(parents=True, mode=0o700)
def stamp(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def inputs():
    paths = []
    for directory in ['src', 'tests', 'scripts', 'adapters', 'public']:
        paths.extend(p for p in (source / directory).rglob('*') if p.is_file())
    paths.extend(source / name for name in ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html'] if (source / name).is_file())
    return {str(p.relative_to(source)): sha(p) for p in sorted(paths)}
def group_members(group):
    rows = []
    for path in pathlib.Path('/proc').glob('[0-9]*/stat'):
        try:
            raw = path.read_text(); fields = raw[raw.rfind(')') + 2:].split()
            if int(fields[2]) != group or int(fields[3]) != group: continue
            rows.append({'pid': int(path.parent.name), 'state': fields[0], 'parent': int(fields[1]), 'group': int(fields[2]), 'session': int(fields[3]), 'startTicks': int(fields[19])})
        except (FileNotFoundError, ProcessLookupError, ValueError): pass
    return sorted(rows, key=lambda row: row['pid'])
before = inputs(); (run / 'inputs-before.json').write_text(json.dumps(before, indent=2) + '\n')
started = stamp()
with (run / 'raw.log').open('wb') as raw:
    child = subprocess.Popen(argv, cwd=source, stdout=raw, stderr=subprocess.STDOUT, start_new_session=True)
    identity = group_members(child.pid)
    (run / 'owned-process.json').write_text(json.dumps({'pid': child.pid, 'group': child.pid, 'argv': argv, 'membersAtStart': identity}, indent=2) + '\n')
    timed_out = False
    try: child.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(child.pid, signal.SIGTERM)
        try: child.wait(timeout=2)
        except subprocess.TimeoutExpired: pass
    # npm can exit before its test runner. Check the owned new session as well
    # as the parent; never describe parent-gone as full descendant cleanup.
    remaining = group_members(child.pid)
    if any(row['state'] != 'Z' for row in remaining):
        os.killpg(child.pid, signal.SIGTERM)
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline and any(row['state'] != 'Z' for row in group_members(child.pid)): time.sleep(.1)
        if any(row['state'] != 'Z' for row in group_members(child.pid)): os.killpg(child.pid, signal.SIGKILL)
    child.wait()
after = inputs(); (run / 'inputs-after.json').write_text(json.dumps(after, indent=2) + '\n')
members = group_members(child.pid)
receipt = {'startedAt': started, 'endedAt': stamp(), 'argv': argv, 'exitCode': child.returncode, 'timedOut': timed_out,
    'status': 'TIMEOUT_PARTIAL' if timed_out else 'PASS' if child.returncode == 0 else 'FAIL',
    'inputCount': len(before), 'inputsStable': before == after, 'rawSHA256': sha(run / 'raw.log'),
    'ownedPid': child.pid, 'finalOwnedSessionMembers': members, 'activeDescendants': [row for row in members if row['state'] != 'Z'],
    'wrapperSHA256': sha(pathlib.Path(__file__))}
(run / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
sys.exit(0 if receipt['status'] == 'PASS' and receipt['inputsStable'] and not receipt['activeDescendants'] else 1)
