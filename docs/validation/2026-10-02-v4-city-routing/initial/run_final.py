import hashlib,json,subprocess
from datetime import datetime,timezone
from pathlib import Path

root=Path('/tmp/yunshan-v4-city-core-final-01')
manifest=json.loads((root/'source-snapshot.json').read_text())
names=sorted(manifest['copiedHashes'])
def hashes(directory):
    return {name:hashlib.sha256((directory/name).read_bytes()).hexdigest() for name in names}
before=hashes(root)
assert before==manifest['copiedHashes']
checks=[
    ('strict',['npm','exec','tsc','--','--noEmit']),
    ('v4',['node','--import','tsx','--test','--test-isolation=none','tests/v4-simulation.test.ts']),
    ('journey',['node','--import','tsx','--test','--test-isolation=none','tests/journey.test.ts']),
    ('legacy-core',['node','--import','tsx','--test','--test-isolation=none','--test-name-pattern=large civic interiors|stepped civic floors|citizens use the shared narrow stair core|Chinese and earned English','tests/simulation.test.ts']),
]
status={'scope':'CPU-only strict; all eight v4 simulation tests; existing journey file; selected four unmarked/civic core tests. No browser, Renderer, GPU, full suite or performance claim.','snapshot':str(root),'startedAt':datetime.now(timezone.utc).isoformat(),'sourceStart':before,'checks':[]}
out=root/'artifacts'
out.mkdir(exist_ok=True)
for label,command in checks:
    started=datetime.now(timezone.utc).isoformat()
    with (out/f'{label}.log').open('wb') as log:
        completed=subprocess.run(command,cwd=root,stdout=log,stderr=subprocess.STDOUT)
    record={'name':label,'command':command,'startedAt':started,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':completed.returncode,'rawLog':str(out/f'{label}.log'),'sha256':hashlib.sha256((out/f'{label}.log').read_bytes()).hexdigest()}
    status['checks'].append(record)
    print(json.dumps(record),flush=True)
    (out/'run-status.json').write_text(json.dumps(status,ensure_ascii=False,indent=2)+'\n')
status['finishedAt']=datetime.now(timezone.utc).isoformat()
status['sourceEnd']=hashes(root)
status['snapshotUnchanged']=status['sourceStart']==status['sourceEnd']
status['sharedEnd']=hashes(Path(manifest['source']))
status['sharedChangedNames']=[name for name in names if status['sharedEnd'][name]!=before[name]]
(out/'run-status.json').write_text(json.dumps(status,ensure_ascii=False,indent=2)+'\n')
assert status['snapshotUnchanged']
raise SystemExit(int(any(item['exitCode'] for item in status['checks'])))
