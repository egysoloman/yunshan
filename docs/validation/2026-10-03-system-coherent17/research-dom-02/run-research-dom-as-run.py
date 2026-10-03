import datetime, hashlib, json, os, pathlib, re, subprocess, time

base=pathlib.Path('/tmp/yunshan-system-coherent-17'); out=base/'research-dom-02';out.mkdir(exist_ok=False)
script=pathlib.Path('/tmp/yunshan-research-ui-prep-20261003/research-ui.mjs')
source=base/'source';shared=pathlib.Path('/workspace/yunshan')
manifest=json.loads((base/'source-snapshot.json').read_text());excluded={'.gitattributes','.gitignore','AGENTS.md','开发备忘录.md','提示词.md'}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def inputs():return {n:sha(shared/n)for n in manifest['copiedHashes']if n not in excluded}
def dist():return {str(p.relative_to(source/'dist')):sha(p)for p in sorted((source/'dist').rglob('*'))if p.is_file()}
env=dict(os.environ);env.update(YUNSHAN_RESEARCH_UI_SOURCE=str(source),YUNSHAN_RESEARCH_UI_MANIFEST=str(base/'source-snapshot.json'),YUNSHAN_RESEARCH_UI_OUT=str(out),YUNSHAN_RESEARCH_UI_PORT='4197')
status={'startedAtUTC':now(),'launcherPID':os.getpid(),'scriptSHA256':sha(script),'distBefore':dist(),'sharedExecutableBefore':inputs(),'ownedProcesses':{},'ownedProfiles':[],'port':4197}
profiles=set()
with (out/'raw.log').open('wb')as stream:
 child=subprocess.Popen(['node',str(script)],cwd=source,env=env,stdout=stream,stderr=subprocess.STDOUT);status['nodePID']=child.pid
 (out/'launch.json').write_text(json.dumps({'startedAtUTC':status['startedAtUTC'],'launcherPID':os.getpid(),'nodePID':child.pid,'scriptSHA256':status['scriptSHA256']},indent=2))
 print(json.dumps({'launchedNodePID':child.pid,'startedAtUTC':status['startedAtUTC'],'output':str(out)}),flush=True)
 while child.poll()is None:
  processes={}
  for p in pathlib.Path('/proc').iterdir():
   if not p.name.isdigit():continue
   try:
    raw=(p/'stat').read_text();fields=raw[raw.rfind(')')+2:].split();processes[int(p.name)]=(int(fields[1]),fields[0],fields[19])
   except(FileNotFoundError,PermissionError,ProcessLookupError):pass
  descendants={child.pid}
  while True:
   found={pid for pid,(parent,_,_)in processes.items()if parent in descendants}
   if found<=descendants:break
   descendants|=found
  for pid in descendants:
   if pid not in processes:continue
   parent,state,start=processes[pid]
   try:
    command=pathlib.Path(f'/proc/{pid}/cmdline').read_bytes().replace(b'\0',b' ').decode(errors='replace')
   except(FileNotFoundError,PermissionError,ProcessLookupError):continue
   status['ownedProcesses'][str(pid)]={'parentPID':parent,'startTicks':start,'command':command}
   profiles.update(re.findall(r'--user-data-dir=([^\s]+)',command))
  time.sleep(.25)
 code=child.wait()
status.update({'exitCode':code,'endedAtUTC':now(),'ownedProfiles':sorted(profiles),'profilesRemaining':[p for p in profiles if pathlib.Path(p).exists()],
 'ownedPIDPresenceAfter':{pid:pathlib.Path('/proc',pid).exists()for pid in status['ownedProcesses']},'rawSHA256':sha(out/'raw.log'),
 'distAfter':dist(),'sharedExecutableAfter':inputs()})
status['distStable']=status['distBefore']==status['distAfter'];status['sharedExecutableStable']=status['sharedExecutableBefore']==status['sharedExecutableAfter']
(out/'resource-receipt.json').write_text(json.dumps(status,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:status[k]for k in ['exitCode','nodePID','distStable','sharedExecutableStable','profilesRemaining','endedAtUTC']},ensure_ascii=False),flush=True)
raise SystemExit(code)
