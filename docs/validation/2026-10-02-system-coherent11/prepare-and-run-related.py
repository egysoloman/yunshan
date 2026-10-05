import pathlib,json,hashlib,subprocess,datetime,sys,shutil,os
root=pathlib.Path(__file__).parent
live=pathlib.Path('/workspace/yunshan'); source=root/'source'
prior=json.loads(pathlib.Path('/tmp/yunshan-system-coherent-10/source-snapshot.json').read_text())
paths=sorted(set(prior['copiedHashes'])|{'tests/npc-public-rest.test.ts','tests/fixtures/npc-rest-offer-native.json'})
def hashes(base): return {rel:hashlib.sha256((base/rel).read_bytes()).hexdigest() for rel in paths}
initial=hashes(live)
assert initial['src/simulation.ts']=='ba289751a2990ae405538801561d6032c982148f15887c1c8745da2264a06f49'
assert not source.exists()
for rel in paths:
 target=source/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(live/rel,target)
(source/'node_modules').symlink_to(live/'node_modules',target_is_directory=True)
copied=hashes(source); assert hashes(live)==initial==copied
snapshot={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'gitHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=live,text=True).strip(),'sourceRoot':str(live),'snapshotRoot':str(source),'inputCount':len(paths),'initialHashes':initial,'copiedHashes':copied,'copyStable':True,'previousSnapshot':str(pathlib.Path('/tmp/yunshan-system-coherent-10/source-snapshot.json')),'previousInputDifferences':[rel for rel in paths if initial[rel]!=prior['copiedHashes'].get(rel)],'worldGeometryUnchanged':initial['src/world.ts']==prior['copiedHashes']['src/world.ts'],'reason':'Minimal nighttime full-home cross-district public-rest selection, preserving local offer order. No claim of full11 suite or default economic steady-state.'}
(root/'source-snapshot.json').write_text(json.dumps(snapshot,ensure_ascii=False,indent=2)+'\n')
results=[]
commands=[('build',['npm','run','build']),('home-and-npc-rest',['node','--import','tsx','--test','--test-isolation=none','tests/home-rest.test.ts','tests/npc-clock.test.ts','tests/npc-home-rest-voxels.test.ts','tests/npc-public-rest.test.ts']),('native-save-and-module-migration',['node','--import','tsx','--test','--test-isolation=none','--test-name-pattern=the original native r5 export|a saved module manifest prevents missing financial custody|legacy core saves initialize extension state','tests/world-layout.test.ts','tests/banking.test.ts','tests/extensions.test.ts'])]
for label,command in commands:
 started=datetime.datetime.now(datetime.timezone.utc).isoformat()
 (root/'runner-progress.json').write_text(json.dumps({'label':label,'command':command,'state':'running','startedAt':started},indent=2)+'\n')
 with (root/(label+'.log')).open('wb') as log: code=subprocess.run(command,cwd=source,stdout=log,stderr=subprocess.STDOUT).returncode
 data=(root/(label+'.log')).read_bytes();lines=data.decode(errors='replace').splitlines()
 record={'label':label,'command':command,'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':code,'logSha256':hashlib.sha256(data).hexdigest(),'summary':[x for x in lines if x.startswith(('ℹ tests','ℹ pass','ℹ fail','ℹ skipped','ℹ cancelled','ℹ duration','✔','✖','✓'))]}
 results.append(record);end=hashes(source);assert end==copied
 (root/'related-run-status.json').write_text(json.dumps({'results':results,'sourceStart':copied,'sourceEnd':end,'sourceStable':True},ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(record,ensure_ascii=False),flush=True)
 if code:sys.exit(code)
(root/'runner-progress.json').write_text(json.dumps({'state':'related-complete','sourceStable':True},indent=2)+'\n')
