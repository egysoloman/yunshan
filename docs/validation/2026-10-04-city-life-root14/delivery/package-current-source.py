from pathlib import Path
import json,hashlib,zipfile,stat,datetime,shutil
P=Path(__file__).resolve().parent;S=Path('/workspace/yunshan');D=S/'docs/validation/2026-10-04-city-life-root14';T=P/'delivery';T.mkdir()
sha=lambda b:hashlib.sha256(b).hexdigest();f=json.loads((P/'FROZEN-INPUTS.json').read_text());files={}
for name,h in f['inputs'].items():
 p=S/name;assert p.is_file() and not p.is_symlink() and sha(p.read_bytes())==h;files[name]=p
for name,r in json.loads((P/'BUILD-DIST-MAP.json').read_text())['files'].items():
 p=S/'dist'/name;assert sha(p.read_bytes())==r['sha256'];files['dist/'+name]=p
for name in ['AGENTS.md','提示词.md','开发备忘录.md']:files[name]=S/name
files['SOURCE-INPUTS.json']=P/'FROZEN-INPUTS.json';files['INSTALL-RECEIPT.json']=P/'INSTALL-RECEIPT.json'
expected={n:{'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())}for n,p in sorted(files.items())};(T/'SOURCE-FILEMAP.json').write_text(json.dumps(expected,ensure_ascii=False,indent=2)+'\n')
archive=T/'yunshan-root14-current-source.zip'
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True)as z:
 for name,p in sorted(files.items()):
  raw=p.read_bytes();assert {'bytes':len(raw),'sha256':sha(raw)}==expected[name]
  info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=3;info.external_attr=(stat.S_IFREG|0o644)<<16;z.writestr(info,raw)
 z.writestr('SOURCE-FILEMAP.json',(T/'SOURCE-FILEMAP.json').read_bytes())
with zipfile.ZipFile(archive)as z:
 assert z.testzip()is None and len(z.infolist())==len(expected)+1
 for n,r in expected.items():
  raw=z.read(n);assert {'bytes':len(raw),'sha256':sha(raw)}==r and raw==files[n].read_bytes()
r={'status':'PASS','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceInputs':len(f['inputs']),'freshBuildFiles':7,'originalFiles':len(files),'manifestMember':1,'everySourceBeforeAfterExact':True,'everyMemberSHABytesCRCExact':True,'graphSHA256':f['graphSHA256'],'archive':{'name':archive.name,'bytes':archive.stat().st_size,'sha256':sha(archive.read_bytes())},'metadataMemoScope':'Actual pre-publication memo snapshot; final Git memo may prepend real publication receipt later','completeGoal':False}
(T/'SOURCE-VERIFICATION.json').write_text(json.dumps(r,indent=2)+'\n')
for src in [archive,T/'SOURCE-FILEMAP.json',T/'SOURCE-VERIFICATION.json']:shutil.copyfile(src,D/'delivery'/src.name);assert src.read_bytes()==(D/'delivery'/src.name).read_bytes()
print(json.dumps(r))
