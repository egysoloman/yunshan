"""CODEPREP / NOT_RUN. Run only after parent binds and authorizes a new epoch.

No trees are copied. The wrapper copies only its five explicitly named input
files into a previously absent evidence directory and observes owned resources.
"""
import datetime
import hashlib
import json
import os
import pathlib
import re
import signal
import socket
import subprocess
import sys
import time

assert len(sys.argv) == 2, 'Supply a separately reviewed completed root18 binding.'
binding_path = pathlib.Path(sys.argv[1]).resolve()
binding = json.loads(binding_path.read_text())
assert binding['state'] == 'BOUND_ROOT18_COMPLETED_ACTUAL_BUILD'
assert binding['composite'] == 'root18'
assert binding['production']['freshForThisSource'] is True
assert binding['production']['buildExitCode'] == 0
source = pathlib.Path(binding['sourceRoot'])
out = pathlib.Path(binding['outRoot'])
script = pathlib.Path(__file__).resolve().with_name('education-ui.mjs')
shared = pathlib.Path('/workspace/yunshan')
excluded = {'.gitattributes', '.gitignore', 'AGENTS.md', '开发备忘录.md', '提示词.md'}


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def processes():
    answer = {}
    for directory in pathlib.Path('/proc').iterdir():
        if not directory.name.isdigit():
            continue
        try:
            raw = (directory / 'stat').read_text()
            fields = raw[raw.rfind(')') + 2:].split()
            command = (directory / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace')
            answer[int(directory.name)] = {'parentPID': int(fields[1]), 'state': fields[0], 'startTicks': fields[19], 'command': command}
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
    return answer


def descendants(process_map, first):
    answer = {first}
    while True:
        found = {pid for pid, info in process_map.items() if info['parentPID'] in answer}
        if found <= answer:
            return answer
        answer |= found


def source_inputs():
    return {name: sha(source / name) for name in manifest['copiedHashes']}


def shared_inputs():
    return {name: sha(shared / name) for name in manifest['copiedHashes'] if name not in excluded}


def dist_inputs():
    return {str(file.relative_to(source / 'dist')): sha(file)
            for file in sorted((source / 'dist').rglob('*')) if file.is_file()}


def port_is_free(port):
    with socket.socket() as connection:
        connection.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            connection.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False


manifest_path = pathlib.Path(binding['sourceManifest']['path'])
receipt_path = pathlib.Path(binding['buildReceipt']['path'])
assert sha(manifest_path) == binding['sourceManifest']['sha256']
assert sha(receipt_path) == binding['buildReceipt']['sha256']
manifest = json.loads(manifest_path.read_text())
assert manifest['sourceRoot'] == str(source)
assert len(manifest['copiedHashes']) == binding['sourceManifest']['totalFiles']
assert len(set(manifest['copiedHashes']) - excluded) == binding['sourceManifest']['sharedExecutableFiles']
assert source_inputs() == manifest['copiedHashes']
assert dist_inputs() == binding['production']['distHashes']
assert port_is_free(binding['port']), 'No server is started on an occupied port.'
out.mkdir(parents=True, exist_ok=False)
for original, filename in [(script, 'education-ui-as-run.mjs'), (pathlib.Path(__file__), 'run-education-dom-as-run.py'),
                           (binding_path, 'binding-as-run.json'), (manifest_path, 'source-manifest-as-run.json'),
                           (receipt_path, 'build-receipt-as-run.json')]:
    (out / filename).write_bytes(original.read_bytes())
env = dict(os.environ)
env['YUNSHAN_EDUCATION_DOM_BINDING'] = str(binding_path)
status = {
    'status': 'RUNNING', 'startedAtUTC': now(), 'launcherPID': os.getpid(),
    'launcherStartTicks': processes()[os.getpid()]['startTicks'],
    'scriptSha256': sha(script), 'wrapperSha256': sha(pathlib.Path(__file__)),
    'bindingSha256': sha(binding_path), 'sourceManifestSha256': sha(manifest_path), 'buildReceiptSha256': sha(receipt_path),
    'sourceBefore': source_inputs(), 'distBefore': dist_inputs(), 'sharedExecutableBefore': shared_inputs(),
    'ownedProcesses': {}, 'port': binding['port'], 'portFreeBefore': True,
    'scope': 'Owned Node/Vite and Chromium DOM only. No Renderer or WebGL/GPU/3D acceptance. Fresh production artifacts verified, source CityUI executed.',
}
profiles = set()
started = time.monotonic()
with (out / 'raw.log').open('xb') as stream:
    child = subprocess.Popen(['node', str(script)], cwd=source, env=env, stdout=stream,
                             stderr=subprocess.STDOUT, start_new_session=True)
    status['nodePID'] = child.pid
    launched_process = processes().get(child.pid)
    if launched_process:
        status['nodeStartTicks'] = launched_process['startTicks']
        status['ownedProcesses'][str(child.pid)] = {**launched_process, 'firstObservedAtUTC': now()}
    (out / 'launch.json').write_text(json.dumps({
        'startedAtUTC': status['startedAtUTC'], 'launcherPID': os.getpid(), 'nodePID': child.pid,
        'nodeStartTicks': status.get('nodeStartTicks'), 'scriptSha256': status['scriptSha256'],
        'bindingSha256': status['bindingSha256'], 'port': binding['port'],
    }, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'nodePID': child.pid, 'startedAtUTC': status['startedAtUTC'], 'port': binding['port'], 'out': str(out)}), flush=True)
    while child.poll() is None:
        current = processes()
        for pid in descendants(current, child.pid):
            if pid not in current:
                continue
            info = current[pid]
            prior = status['ownedProcesses'].get(str(pid))
            if prior is None:
                status['ownedProcesses'][str(pid)] = {**info, 'firstObservedAtUTC': now()}
            elif prior['startTicks'] == info['startTicks']:
                prior['lastObservedAtUTC'] = now()
            profiles.update(re.findall(r'--user-data-dir=([^\s]+)', info['command']))
        if time.monotonic() - started >= 1200:
            status['watchdogFirstFailure'] = 'Declared 20-minute outer wall guard reached; no retry, timeout or staging change.'
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
            break
        time.sleep(.25)
    code = child.wait()
status.update({
    'exitCode': code, 'endedAtUTC': now(), 'wallSeconds': time.monotonic() - started,
    'ownedProfiles': sorted(profiles), 'profilesRemaining': [profile for profile in profiles if pathlib.Path(profile).exists()],
    'sourceAfter': source_inputs(), 'distAfter': dist_inputs(), 'sharedExecutableAfter': shared_inputs(),
    'rawSha256': sha(out / 'raw.log'), 'portFreeAfter': port_is_free(binding['port']),
})
final_processes = processes()
status['ownedProcessAfter'] = {
    pid: ({**final_processes[int(pid)], 'sameStartTicks': final_processes[int(pid)]['startTicks'] == original['startTicks']}
          if int(pid) in final_processes else {'gone': True})
    for pid, original in status['ownedProcesses'].items()
}
status['ownedLiveNonZombieAfter'] = [
    pid for pid, info in status['ownedProcessAfter'].items()
    if info.get('sameStartTicks') and info['state'] != 'Z'
]
status['sourceStable'] = status['sourceBefore'] == status['sourceAfter']
status['distStable'] = status['distBefore'] == status['distAfter']
status['sharedExecutableStable'] = status['sharedExecutableBefore'] == status['sharedExecutableAfter']
status['status'] = 'FINISHED'
with (out / 'resource-receipt.json').open('x') as receipt:
    receipt.write(json.dumps(status, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: status[key] for key in [
    'exitCode', 'nodePID', 'sourceStable', 'distStable', 'sharedExecutableStable',
    'ownedLiveNonZombieAfter', 'profilesRemaining', 'portFreeAfter', 'endedAtUTC',
]}, ensure_ascii=False), flush=True)
if not all(status[key] for key in ['sourceStable', 'distStable', 'sharedExecutableStable', 'portFreeAfter']) \
        or status['ownedLiveNonZombieAfter'] or status['profilesRemaining']:
    raise SystemExit(code if code != 0 else 1)
raise SystemExit(code)
