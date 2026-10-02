import hashlib,json,shutil,subprocess
from datetime import datetime,timezone
from pathlib import Path

source=Path('/workspace/yunshan')
destination=Path('/tmp/yunshan-v4-city-core-final-01')
assert not destination.exists(), 'A prior immutable run must not be overwritten.'
base=json.loads(Path('/tmp/yunshan-phase3-root-coherent-05/source-snapshot.json').read_text())
files=sorted(set(base['originHashesBefore']) | set(subprocess.check_output(['rg','--files','src','tests','scripts','public'],cwd=source,text=True).splitlines()))
def hashes(root):
    return {name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in files}
before=hashes(source)
destination.mkdir()
for name in files:
    target=destination/name
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(source/name,target)
copied=hashes(destination)
after=hashes(source)
manifest={'copiedAt':datetime.now(timezone.utc).isoformat(),'source':str(source),'destination':str(destination),'sourceFileCount':len(files),'originHashesBefore':before,'copiedHashes':copied,'originHashesAfter':after,'threeWayEqual':before==copied==after,'scope':'CPU strict and targeted v4/core/journey tests only; no CityRenderer, browser, GPU or full suite.'}
(destination/'source-snapshot.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
assert manifest['threeWayEqual'], 'Source changed while copying; retain the snapshot as invalid and do not run it.'
(destination/'node_modules').symlink_to(source/'node_modules',target_is_directory=True)
print(json.dumps({'destination':str(destination),'sourceFileCount':len(files),'threeWayEqual':True},ensure_ascii=False))
