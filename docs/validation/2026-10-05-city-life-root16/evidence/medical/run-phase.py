import datetime, hashlib, json, os, pathlib, signal, subprocess, sys, time

source, run_dir, encoded_argv, seconds=sys.argv[1:]
source=pathlib.Path(source).resolve();run=pathlib.Path(run_dir);argv=json.loads(encoded_argv);timeout=float(seconds)
assert source.is_dir() and not run.exists() and 0<timeout<=7200
run.mkdir(parents=True)
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def inputs():
 ps=[p for n in ['src','tests','scripts','adapters','public'] for p in (source/n).rglob('*') if p.is_file()]
 ps += [source/n for n in ['package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html'] if (source/n).is_file()]
 return {str(p.relative_to(source)):sha(p) for p in sorted(ps)}
def process(pid):
 try:
  raw=(pathlib.Path('/proc')/str(pid)/'stat').read_text();f=raw[raw.rfind(')')+2:].split()
  return {'pid':pid,'state':f[0],'parent':int(f[1]),'group':int(f[2]),'session':int(f[3]),'startTicks':int(f[19])}
 except (FileNotFoundError,ProcessLookupError):return None
known={}
def observe():
 rows={int(p.name):process(int(p.name)) for p in pathlib.Path('/proc').glob('[0-9]*') if p.is_dir()}
 owners={pid for pid,row in known.items() if rows.get(pid) and rows[pid]['startTicks']==row['startTicks']}
 while True:
  added={pid for pid,row in rows.items() if row and row['parent'] in owners and row['startTicks']>=identity['startTicks']}
  expanded=owners|added
  if expanded==owners:break
  owners=expanded
 for pid in owners:
  row=rows.get(pid)
  if row and (pid not in known or known[pid]['startTicks']==row['startTicks']):known[pid]=row
 return [row for pid,owned in known.items() if (row:=rows.get(pid)) and row['startTicks']==owned['startTicks']]
before=inputs();(run/'inputs-before.json').write_text(json.dumps(before,indent=2)+'\n');started=stamp()
with (run/'raw.log').open('wb') as raw:
 child=subprocess.Popen(argv,cwd=source,stdout=raw,stderr=subprocess.STDOUT,start_new_session=True)
 identity=process(child.pid);assert identity;known[child.pid]=identity
 (run/'owned-process.json').write_text(json.dumps({'pid':child.pid,'argv':argv,'identity':identity},indent=2)+'\n')
 timed_out=False;deadline=time.monotonic()+timeout
 while child.poll() is None:
  observe()
  if time.monotonic()>=deadline:timed_out=True;break
  time.sleep(.1)
 remaining=observe()
 if timed_out or any(row['state']!='Z' for row in remaining if row['pid']!=child.pid):
  for row in remaining:
   if row['state']!='Z':
    try:os.kill(row['pid'],signal.SIGTERM)
    except ProcessLookupError:pass
  cleanup_deadline=time.monotonic()+2
  while time.monotonic()<cleanup_deadline and any(row['state']!='Z' for row in observe()):time.sleep(.1)
  for row in observe():
   if row['state']!='Z':
    try:os.kill(row['pid'],signal.SIGKILL)
    except ProcessLookupError:pass
 child.wait()
after=inputs();members=observe()
(run/'inputs-after.json').write_text(json.dumps(after,indent=2)+'\n')
(run/'owned-descendants.json').write_text(json.dumps(list(known.values()),indent=2)+'\n')
receipt={'startedAt':started,'endedAt':stamp(),'argv':argv,'exitCode':child.returncode,'timedOut':timed_out,'status':'TIMEOUT_PARTIAL' if timed_out else 'PASS' if child.returncode==0 else 'FAIL','inputCount':len(before),'inputsStable':before==after,'rawSHA256':sha(run/'raw.log'),'ownedPid':child.pid,'observedDescendants':len(known),'finalOwnedMembers':members,'activeDescendants':[row for row in members if row['state']!='Z'],'wrapperSHA256':sha(pathlib.Path(__file__)),'ownershipScope':'PID/start-time identities discovered through recursive ancestry, including children that create new process groups/sessions; no unobserved historical process claim.'}
(run/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
sys.exit(0 if receipt['status']=='PASS' and receipt['inputsStable'] and not receipt['activeDescendants'] else 1)
