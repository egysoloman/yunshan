import pathlib,json,hashlib,subprocess,datetime,re,shutil,sys
root=pathlib.Path('/tmp/yunshan-phase2-root-coherent-02')
out=pathlib.Path('/workspace/yunshan/artifacts/phase2-browser-coherent02-nativeboarding'); out.mkdir(parents=True,exist_ok=True)
hashfile=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
m=json.loads((root/'source-snapshot.json').read_text()); hashes=m['copiedHashes']
def current():return {p:hashfile(root/p) for p in hashes}
start=current(); assert start==hashes
entry=re.search(r'src="([^"]+\.js)"',(root/'dist/index.html').read_text()).group(1)
s={'snapshot':str(root),'sourceManifestSHA256':hashfile(root/'source-snapshot.json'),'fileCount':len(hashes),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'entry':entry,'entrySHA256Start':hashfile(root/('dist'+entry)),'sourceHashesStart':start,'executedExternalHarnessSHA256Start':hashfile(pathlib.Path('/tmp/yunshan-browser-native-boarding-harness/browser-test.mjs')),'observerSHA256':hashfile(pathlib.Path(__file__)),'scope':'City external native-boarding harness, all 11 checks and original 60s returns. Source original script unchanged. Additional legal ground-exit and native permissions probes; independent source/entry/harness start-end observer only. Diagnostic debug context; not normal player journey or macOS performance.'}
(out/'run-manifest.json').write_text(json.dumps(s,indent=2)+'\n')
shutil.copyfile(root/'source-snapshot.json',out/'source-snapshot.json')
with (out/'browser.log').open('w') as log:r=subprocess.run(['node','/tmp/yunshan-browser-native-boarding-harness/browser-test.mjs'],cwd=root,stdout=log,stderr=subprocess.STDOUT)
s.update({'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':r.returncode,'sourceHashesEnd':current(),'entrySHA256End':hashfile(root/('dist'+entry)),'executedExternalHarnessSHA256End':hashfile(pathlib.Path('/tmp/yunshan-browser-native-boarding-harness/browser-test.mjs'))})
s['allCopiedFilesUnchanged']=s['sourceHashesEnd']==start; s['entryUnchanged']=s['entrySHA256End']==s['entrySHA256Start']
for name in ['browser-results.json','day.png','night.png','interior.png','driving-failure.json','aviation-failure.json','aircraft-city-button-probe.json']:
 p=root/'artifacts'/name
 if p.exists() and p.stat().st_mtime >= datetime.datetime.fromisoformat(s['startedAt']).timestamp():shutil.copyfile(p,out/name)
s['externalHarnessUnchanged']=s['executedExternalHarnessSHA256End']==s['executedExternalHarnessSHA256Start']
s['resultSHA256']=hashfile(out/'browser-results.json') if (out/'browser-results.json').exists() else None
(out/'run-manifest.json').write_text(json.dumps(s,indent=2)+'\n')
print(json.dumps({k:s[k] for k in ['exitCode','entry','allCopiedFilesUnchanged','entryUnchanged','resultSHA256']}))
sys.exit(r.returncode or (0 if s['allCopiedFilesUnchanged'] and s['entryUnchanged'] else 1))
