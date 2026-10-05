from pathlib import Path
import subprocess,os,json,datetime,time
root=Path('/tmp/yunshan-coherent14-native-frame-barrier-01')
evidence=root/'native-home-evidence'
if evidence.exists():
 raise SystemExit('Refuse to overwrite any existing native evidence directory')
evidence.mkdir()
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def proc(pid):
 try:
  raw=(Path('/proc')/str(pid)/'stat').read_text();tail=raw.rsplit(') ',1)[1].split()
  return {'pid':pid,'ppid':int(tail[1]),'state':tail[0],'startTicks':int(tail[19])}
 except FileNotFoundError:return {'pid':pid,'state':'ABSENT'}
started=utc();begin=time.monotonic();env=os.environ.copy();env.update({'YUNSHAN_COMPILED_VALIDATION_APPROVED':'1','YUNSHAN_HOME_NATIVE_APPROVED':'1','YUNSHAN_HOME_EVIDENCE':str(evidence),'YUNSHAN_HOME_NATIVE_PORT':'4189'})
with (evidence/'native-home-run.log').open('wb') as log:
 child=subprocess.Popen(['node',str(root/'native-home-rest.mjs')],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
 start={'atUTC':started,'wrapper':proc(os.getpid()),'node':proc(child.pid),'actualScript':str(root/'native-home-rest.mjs'),'cwd':str(root),'port':4189,'approval':'Root explicit actual14 exclusive GPU GO; no formal11 or ZIP approval','signalsSentByWrapper':[]}
 (evidence/'owned-launch-start.json').write_text(json.dumps(start,ensure_ascii=False,indent=2)+'\n')
 print('START '+json.dumps(start,ensure_ascii=False),flush=True)
 result=child.wait()
end={'startedAtUTC':started,'endedAtUTC':utc(),'wallSeconds':time.monotonic()-begin,'nodePID':child.pid,'rawNodeExitCode':result,'wrapper':proc(os.getpid()),'signalsSentByWrapper':[],'evidenceRoot':str(evidence)}
(evidence/'raw-exit.json').write_text(json.dumps(end,ensure_ascii=False,indent=2)+'\n')
print('RAW_EXIT '+json.dumps(end,ensure_ascii=False),flush=True)
raise SystemExit(result if 0<=result<256 else 1)
