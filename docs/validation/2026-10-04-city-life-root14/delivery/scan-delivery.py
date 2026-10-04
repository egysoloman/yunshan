from pathlib import Path
import importlib.util,json,shutil,datetime
P=Path(__file__).resolve().parent;S=Path('/workspace/yunshan');D=S/'docs/validation/2026-10-04-city-life-root14'
spec=importlib.util.spec_from_file_location('delivery_safety',P/'delivery-safety-tools-as-used.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
files={}
for name in json.loads((P/'FROZEN-INPUTS.json').read_text())['inputs']:files['current-source/'+name]=S/name
for p in sorted(D.rglob('*')):
 if p.is_file():
  assert not p.is_symlink();files['public-evidence/'+p.relative_to(D).as_posix()]=p
for name in ['AGENTS.md','提示词.md','开发备忘录.md','docs/validation/2026-10-04-native-city-life/current-frozen-inputs.json']:files['current-metadata/'+name]=S/name
before=m.snapshot(files);report=m.safety_scan(files,before);assert report['status']=='PASS', 'Literal shape scan blocked; see non-value report'
assert m.snapshot(files)==before
report.update({'tarExtension':'regular members and safe prior in-archive hardlinks expanded recursively; no extraction or external access','sourceBeforeAfterStable':True,'inputGraphSHA256':json.loads((P/'FROZEN-INPUTS.json').read_text())['graphSHA256'],'meaning':'Literal-shape credential scan only; not semantic security/antivirus audit','completeGoal':False})
(P/'DELIVERY-SAFETY.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');(P/'DELIVERY-SAFETY-FILEMAP.json').write_text(json.dumps(before,ensure_ascii=False,indent=2)+'\n')
for n in ['DELIVERY-SAFETY.json','DELIVERY-SAFETY-FILEMAP.json','delivery-safety-tools-as-used.py','scan-delivery.py','package-current-source.py','MEMO-ENTRY.json']:shutil.copyfile(P/n,D/'delivery'/n)
print(json.dumps({k:report[k]for k in ['status','findingCount','statistics','sourceBeforeAfterStable']},ensure_ascii=False))
