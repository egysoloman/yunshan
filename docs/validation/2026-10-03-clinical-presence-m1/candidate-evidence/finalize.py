from pathlib import Path
import hashlib, json, re, subprocess, datetime
base = Path('/tmp/yunshan-clinical-presence-m1-prep-20261003')
evidence = base / 'evidence'
candidate = base / 'candidate'
origin = Path('/tmp/yunshan-system-coherent-14/source')
original = base / 'original'
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
labels = ['strict-01','original-seven-01','strict-02','original-seven-02','strict-03','strict-04','original-seven-03','strict-05','candidate-sixteen-01','related-clinical-culture-v4-01','build-01']
runs = []
for label in labels:
    p = evidence / label
    item = {'label':label, 'pid':int((p/'pid.txt').read_text()), 'exitCode':int((p/'exit-code.txt').read_text()), 'cwd':(p/'cwd.txt').read_text().strip(), 'startUTC':(p/'start.utc').read_text().strip(), 'endUTC':(p/'end.utc').read_text().strip(), 'argv':(p/'argv.txt').read_text().splitlines(), 'freezeStatus':(p/'freeze-status.txt').read_text().strip(), 'filesBefore':len((p/'source-before.sha256').read_text().splitlines()), 'filesAfter':len((p/'source-after.sha256').read_text().splitlines()), 'rawLogSHA256':sha(p/'raw.log')}
    raw=(p/'raw.log').read_text()
    item['tests']={key:int(m.group(1)) for key in ['tests','pass','fail','cancelled','skipped','todo'] if (m:=re.search(r'ℹ '+key+r' (\d+)',raw))}
    item['validFinalSourceEvidence']=label in ['strict-05','candidate-sixteen-01','related-clinical-culture-v4-01','build-01']
    item['scope']='functional only; duration is not a benchmark'
    if label=='original-seven-01': item['interpretation']='0/7 fixture precondition failures: initial 100m building spacing left no native employed doctor within the real hiring route limit. Not M1 behavior evidence.'
    if label=='original-seven-02': item['interpretation']='1/7 pass (unmarked contract), 6 fixture funded-duty precondition failures caused by clearing routes before marked core re-planning. Not M1 behavior evidence.'
    if label=='strict-03': item['interpretation']='tsc exit0, but wrapper cwd at prototype root produced zero freeze inputs. Excluded from source stability evidence.'
    if label=='original-seven-03': item['interpretation']='Valid same-byte 7 regression cases: 2 pass, 5 actual treatment/pairing failures. Original production source unchanged.'
    runs.append(item)
(evidence/'run-results.json').write_text(json.dumps(runs, ensure_ascii=False, indent=2)+'\n')
files=[p for folder in ['src','tests'] for p in (candidate/folder).rglob('*') if p.is_file()]
files += [candidate/name for name in ['package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html'] if (candidate/name).exists()]
final_manifest=''.join(f'{sha(p)} {p.relative_to(candidate)}\n' for p in sorted(files))
(evidence/'candidate-final-48.sha256').write_text(final_manifest)
final_run_labels=['strict-05','candidate-sixteen-01','related-clinical-culture-v4-01','build-01']
freeze_equal={label:all((evidence/label/name).read_text()==final_manifest for name in ['source-before.sha256','source-after.sha256']) for label in final_run_labels}
assert len(files)==48 and all(freeze_equal.values()), freeze_equal
checks=[]
for line in (evidence/'source-origin.sha256').read_text().splitlines():
    digest,rel=line.split(None,1); rel=rel.strip()
    if rel.startswith(str(origin)+'/'): rel=rel[len(str(origin)+'/'):]
    for root in [origin,original]: checks.append({'root':str(root), 'path':rel, 'SHA256':sha(root/rel), 'matchesCapturedOrigin':sha(root/rel)==digest})
assert len(checks)==72 and all(c['matchesCapturedOrigin'] for c in checks)
(evidence/'origin-verification.json').write_text(json.dumps({'checkedAtUTC':utc(),'sourceFilesPerTree':36,'checks':checks},ensure_ascii=False,indent=2)+'\n')
fixture=(candidate/'tests/clinical-presence-fixture.ts').read_text()
controls=fixture[fixture.index('export function attachControls('):fixture.index('export function pin(')]
cash=fixture[fixture.index('export function cash('):fixture.index('export function publicCare(')]
(evidence/'controlled-route-function.txt').write_text(controls)
(evidence/'physical-cash-function.txt').write_text(cash)
patches=[base/name for name in ['01-shared-presence.patch','02-doctor-ground-routing.patch','03-proposed-tests.patch']]
checkdir=evidence/'patch-apply-check-final';checkdir.mkdir(exist_ok=True)
(checkdir/'start.utc').write_text(utc()+'\n')
with (checkdir/'raw.log').open('w') as out:
    command=['git','apply','--check',*[str(p) for p in patches]]
    task=subprocess.Popen(command,cwd=origin,stdout=out,stderr=subprocess.STDOUT)
    (checkdir/'pid.txt').write_text(str(task.pid)+'\n');code=task.wait()
(checkdir/'end.utc').write_text(utc()+'\n');(checkdir/'exit-code.txt').write_text(str(code)+'\n');(checkdir/'cwd.txt').write_text(str(origin)+'\n');(checkdir/'argv.txt').write_text('\n'.join(command)+'\n')
assert code==0
owned=[]
for run in runs:
    process=Path(f'/proc/{run["pid"]}')
    owned.append({'label':run['label'],'pid':run['pid'],'exitCode':run['exitCode'],'processDirectoryPresentAtRead':process.exists()})
assert not any(p['processDirectoryPresentAtRead'] for p in owned), owned
(evidence/'owned-jobs-released.json').write_text(json.dumps({'checkedAtUTC':utc(),'allOwnedRuntimeJobsExited':True,'signalsSent':0,'jobs':owned},ensure_ascii=False,indent=2)+'\n')
manifest=json.loads((evidence/'candidate-manifest.json').read_text())
manifest.update({'status':'ISOLATED_FINAL_FUNCTIONAL_VERIFIED_NOT_SHARED_APPLIED','proposedTestCount':16,'actualFinalNewTests':{'pass':16,'fail':0},'actualRelatedTests':{'clinical':21,'culture':15,'v4Services':2,'pass':38,'fail':0},'strictExitCode':0,'buildExitCode':0,'buildEntry':'candidate/dist/assets/index-DE32DbEy.js','candidateInputFileCount':48,'candidateFreezeSHA256':sha(evidence/'candidate-final-48.sha256'),'finalRunsMatchCandidateFreeze':freeze_equal,'patchApplyCheck':{'origin':str(origin),'exitCode':code},'ownedRuntimeJobsReleased':True,'controlledRouteFunctionSHA256':sha(evidence/'controlled-route-function.txt'),'physicalCashFunctionSHA256':sha(evidence/'physical-cash-function.txt'),'baselineSameBytes':{name:(original/'tests'/name).read_bytes()==(candidate/'tests'/name).read_bytes() for name in ['clinical-presence-fixture.ts','clinical-presence-regression.test.ts']},'notRun':['full npm test','browser/GL/native UI','default clinical coverage audit','14/30/60 days','performance benchmark'],'sharedSourceApplied':False,'ZIPProduced':False,'libraryUploaded':False})
(evidence/'candidate-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':manifest['status'],'freeze48SHA256':manifest['candidateFreezeSHA256'],'controlFunctionSHA256':manifest['controlledRouteFunctionSHA256'],'cashFunctionSHA256':manifest['physicalCashFunctionSHA256'],'applyCheckExit':code,'ownedJobsAllReleased':True},ensure_ascii=False,indent=2))
