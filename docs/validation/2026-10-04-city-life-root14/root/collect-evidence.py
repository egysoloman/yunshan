from pathlib import Path
import json,hashlib,shutil,stat,datetime
P=Path(__file__).resolve().parent; B=P.parent; D=Path('/workspace/yunshan/docs/validation/2026-10-04-city-life-root14')
rows=[]
def copy(src,dest):
 assert src.is_file() and not src.is_symlink();s=src.stat();key=lambda q:(q.st_dev,q.st_ino,q.st_size,q.st_mtime_ns,q.st_ctime_ns);raw=src.read_bytes();assert key(src.stat())==key(s)
 dst=D/dest;dst.parent.mkdir(parents=True,exist_ok=True)
 if dst.exists():assert dst.read_bytes()==raw,'Existing copy differs: '+dest
 else:dst.write_bytes(raw)
 assert dst.read_bytes()==raw
 rows.append({'source':str(src),'path':dest,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
for name in ['FROZEN-INPUTS.json','SHARED-295-BEFORE.json','PREPARE-RECEIPT.json','PROVIDER-INPUTS.json','PROVIDER-ARCHIVES-VERIFICATION.json','PROVIDER-MEMBER-VERIFICATION-01-FAIL.json','ROOT14-civic-history-final-source.tar.gz.MEMBERS.json','ROOT14-civic-history-short-evidence.tar.gz.MEMBERS.json','BUILD-DIST-MAP.json','INSTALL-RECEIPT.json','PLAN.md','run-phase-as-used.py','guarded-install.py','default-full-partition24-as-used.mts','old-current-factory-as-used.mts','UI-ARTIFACTS.json','BROWSER-ARTIFACTS.json']:
 copy(P/name,'root/'+name)
for phase in ['build01','legacy1-exact24-01','ui01','browser01','old-current-factory01','product-day01','default-full-partition24-01']:
 for src in sorted((P/phase).rglob('*')):
  if src.is_file():copy(src,'root/'+src.relative_to(P).as_posix())
for group,rel in [('ROOT14-civic-history-implementation-20261004-01','provider'),('ROOT14-civic-history-independent-review-20261004-01','independent-review')]:
 base=B/group
 for src in sorted(base.iterdir()):
  if src.is_file():copy(src,rel+'/'+src.name)
 if rel=='provider':
  for src in sorted((base/'delivery').iterdir()):copy(src,'delivery/'+src.name)
for group,rel in [('ROOT14-default-food-route-audit-20261004-01','food-route-audit'),('ROOT14-building-sweep-implementation-20261004-01','building-sweep-candidate')]:
 base=B/group
 for src in sorted(base.iterdir()):
  if src.is_file():copy(src,rel+'/'+src.name)
 for src in sorted(base.rglob('*')):
  if src.is_file() and len(src.relative_to(base).parts)>1 and (src.relative_to(base).parts[0].startswith('pure-')):
   copy(src,rel+'/'+src.relative_to(base).as_posix())
 if rel=='building-sweep-candidate':
  for version,folder in [('failed01','base/source'),('passed02','candidate02/source')]:
   for name in ['src/geometry/upright-cylinder-sweep.ts','tests/upright-cylinder-sweep.test.ts']:
    src=base/folder/name
    if src.exists():copy(src,rel+'/source-overlay/'+version+'/'+name)
  for src in [base/'candidate02/run-validation.py']:copy(src,rel+'/tooling/'+src.name)
(D/'ORIGINAL-COPY-FILEMAP.json').write_text(json.dumps({'status':'ORIGINAL_BYTES_VERIFIED','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':rows,'scope':'Selected original files only; complete provider source/short evidence TARs separately preserved; full local CLOSED producer trees not claimed copied'},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'files':len(rows),'totalBytes':sum(r['bytes'] for r in rows),'publicEvidence':str(D)}))
