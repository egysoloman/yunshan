import datetime, hashlib, json, os, pathlib, re, subprocess, traceback

base = pathlib.Path('/tmp/yunshan-system-coherent-17')
source, shared = base / 'source', pathlib.Path('/workspace/yunshan')
manifest = json.loads((base / 'source-snapshot.json').read_text())
keys = sorted(manifest['copiedHashes'])
excluded = {'.gitattributes', '.gitignore', 'AGENTS.md', '开发备忘录.md', '提示词.md'}
executables = [name for name in keys if name not in excluded]
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def hashes(root, names): return {name: sha(root / name) for name in names}
status = {'state': 'RUNNING', 'launcherPID': os.getpid(), 'startedAtUTC': now(),
 'inputCount': len(keys), 'sharedExecutableCount': len(executables), 'manifestSHA256': sha(base / 'source-snapshot.json'),
 'sourceStart': hashes(source, keys), 'sharedExecutableStart': hashes(shared, executables), 'runs': [],
 'scope': 'Composite17 build and two distinct related sets:97 medical/controller/retail,42 research(40pass,2old-origin cases separate). No full npm/GPU/Mac/steadystate or E1 course claim.'}
def record(): (base / 'build-related-run-status.json').write_text(json.dumps(status, ensure_ascii=False, indent=2) + '\n')
assert status['sourceStart'] == manifest['copiedHashes']
assert status['sharedExecutableStart'] == {name: manifest['copiedHashes'][name] for name in executables}
record()
try:
 commands = [
  ('build', ['npm', 'run', 'build'], None),
  ('related-medical-controller-retail97', ['node', '--import', 'tsx', '--test', '--test-isolation=none',
   'tests/clinical-presence-regression.test.ts', 'tests/clinical-presence-contract.test.ts', 'tests/clinical.test.ts',
   'tests/culture.test.ts', 'tests/v4-services.test.ts', 'tests/controller-input-time.test.ts', 'tests/controller.test.ts',
   'tests/controller-v4.test.ts', 'tests/retail-period.test.ts'], (97,97,0)),
  ('research-related42', ['node', '--import', 'tsx', '--test', '--test-isolation=none',
   'tests/research-offsite-causal.test.ts','tests/research-labor.test.ts','tests/research-task-budget.test.ts'], (42,40,2))]
 for label, command, expected in commands:
  log = base / (label + '.log')
  run = {'label': label, 'command': command, 'cwd': str(source), 'startedAtUTC': now(), 'log': str(log)}
  status['runs'].append(run)
  env = dict(os.environ); env.pop('YUNSHAN_RESEARCH_OLD_PENDING_DIR',None); env.pop('YUNSHAN_RESEARCH_REPRO_DIR',None)
  run['oldOriginCaptureEnvironmentUnset'] = True
  with log.open('wb') as stream:
   child = subprocess.Popen(command, cwd=source, env=env, stdout=stream, stderr=subprocess.STDOUT)
   run['pid'] = child.pid; record()
   print(json.dumps({'state':'RUNNING','label':label,'pid':child.pid,'startedAtUTC':run['startedAtUTC']}),flush=True)
   code = child.wait()
  run.update({'exitCode':code,'endedAtUTC':now(),'rawBytes':log.stat().st_size,'logSHA256':sha(log)})
  run['summary'] = {key:int(value) for key,value in re.findall(r'(?:#|ℹ) (tests|pass|fail|cancelled|skipped|todo) (\d+)',log.read_text())}
  record(); print(json.dumps({'label':label,'exitCode':code,'summary':run['summary'],'endedAtUTC':run['endedAtUTC']}),flush=True)
  if code: raise RuntimeError(label + ' failed; original raw retained')
  if expected:
   tests, passed, skipped = expected
   assert run['summary'] == {'tests':tests,'pass':passed,'fail':0,'cancelled':0,'skipped':skipped,'todo':0}
 index = (source/'dist/index.html').read_text(); entries = re.findall(r'<script[^>]+src="([^"]+)"',index)
 assert len(entries)==1
 entry=entries[0]; asset=source/'dist'/entry.lstrip('/')
 status['build']={'entry':entry,'entryBytes':asset.stat().st_size,'entrySHA256':sha(asset),
  'sourceMaps':{str(p.relative_to(source/'dist')):sha(p) for p in sorted((source/'dist').rglob('*.map'))}}
 status['state'],status['exitCode']='PASS_BUILD_AND_RELATED97_RESEARCH40',0
except Exception:
 status.update({'state':'FAIL','exitCode':1,'error':traceback.format_exc()})
finally:
 status['sourceEnd']=hashes(source,keys);status['sharedExecutableEnd']=hashes(shared,executables)
 status['sourceStable']=status['sourceStart']==status['sourceEnd'];status['sharedExecutableStable']=status['sharedExecutableStart']==status['sharedExecutableEnd']
 if not status['sourceStable'] or not status['sharedExecutableStable']: status['state'],status['exitCode']='FAIL_SOURCE_CHANGED',1
 status['endedAtUTC']=now();record()
 print(json.dumps({key:status[key] for key in ['state','exitCode','sourceStable','sharedExecutableStable','endedAtUTC']}),flush=True)
raise SystemExit(status['exitCode'])
