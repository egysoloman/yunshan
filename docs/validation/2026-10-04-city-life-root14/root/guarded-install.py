import pathlib,json,hashlib,shutil,subprocess,datetime
P=pathlib.Path(__file__).resolve().parent; S=pathlib.Path('/workspace/yunshan'); A=P/'assembly'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
frozen=json.loads((P/'FROZEN-INPUTS.json').read_text()); expected=frozen['inputs']; old=json.loads((P/'SHARED-295-BEFORE.json').read_text())
def inputs(base):
 out={}
 for folder in ['src','tests','scripts','adapters','public']:
  for p in sorted((base/folder).rglob('*')):
   if p.is_file():
    assert not p.is_symlink(),str(p)
    out[p.relative_to(base).as_posix()]=sha(p)
 for name in ['index.html','package-lock.json','package.json','tsconfig.json','vite.config.ts']:out[name]=sha(base/name)
 return dict(sorted(out.items()))
assert inputs(S)==old, 'shared source changed after original295 guard'
assert inputs(A)==expected, 'accepted304 assembly changed'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=S,text=True).strip()=='d95cf99b006bba4f31a9ab2a1980ac588fff9f64'
assert subprocess.check_output(['git','branch','--show-current'],cwd=S,text=True).strip()=='takeover-city-life'
phases=['build01','legacy1-exact24-01','ui01','browser01','old-current-factory01','product-day01','default-full-partition24-01']
for phase in phases:
 r=json.loads((P/phase/'receipt.json').read_text());assert r['status']=='PASS' and r['inputsStable'] and not r['activeDescendants']
 assert sha(P/phase/'raw.log')==r['rawSHA256']
 assert json.loads((P/phase/'inputs-before.json').read_text())==expected
 assert json.loads((P/phase/'inputs-after.json').read_text())==expected
assert set(old)<=set(expected)
new=sorted(set(expected)-set(old)); changed=sorted(k for k in old if old[k]!=expected[k]); assert all(not(S/n).exists() for n in new)
backup=P/'install-before'; backup.mkdir()
memo=sha(S/'开发备忘录.md')
for name in changed:
 dst=backup/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(S/name,dst); assert sha(dst)==old[name]
for name in changed+new:
 dst=S/name; dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(A/name,dst); assert sha(dst)==expected[name]
assert inputs(S)==expected and sha(S/'开发备忘录.md')==memo
bm=json.loads((P/'BUILD-DIST-MAP.json').read_text());rows={}
for name,r in bm['files'].items():
 assert sha(A/'dist'/name)==r['sha256']
 dst=S/'dist'/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(A/'dist'/name,dst);assert sha(dst)==r['sha256'];rows[name]=r
receipt={'status':'GUARDED_INSTALLED','at':now(),'baseCommit':'d95cf99b006bba4f31a9ab2a1980ac588fff9f64','branch':'takeover-city-life','oldInputCount':len(old),'inputCount':len(expected),'productionSourceCount':sum(k.startswith('src/') for k in expected),'graphSHA256':frozen['graphSHA256'],'changedPaths':changed,'newPaths':new,'removedPaths':[],'shared304AllSHAMatch':True,'assembly304AllSHAMatch':True,'rootOwnedMemoPreservedSHA256':memo,'freshBuildArtifactCount':len(rows),'freshBuildArtifacts':rows,'entry':bm['entry'],'acceptedPhases':phases,'completeGoal':False,'otherCandidatesInstalled':False}
(P/'INSTALL-RECEIPT.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
pointer={**receipt,'sourceScope':'All regular src/tests/scripts/adapters/public and five config inputs; docs/dist separately mapped','report':'docs/validation/2026-10-04-city-life-root14/REPORT.md','installReceiptSHA256':sha(P/'INSTALL-RECEIPT.json'),'inputs':expected}
(S/'docs/validation/2026-10-04-native-city-life/current-frozen-inputs.json').write_text(json.dumps(pointer,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:receipt[k] for k in ['status','inputCount','productionSourceCount','graphSHA256','changedPaths','newPaths','entry']},ensure_ascii=False))
