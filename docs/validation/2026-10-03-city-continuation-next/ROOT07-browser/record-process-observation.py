import argparse,datetime,hashlib,json,socket
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('new_output');p.add_argument('--owned-run');p.add_argument('--preflight',action='store_true');a=p.parse_args()
rows={}
for d in Path('/proc').iterdir():
 if not d.name.isdigit():continue
 try:
  raw=(d/'stat').read_text();f=raw[raw.rfind(')')+2:].split()
  rows[int(d.name)]={'pid':int(d.name),'name':(d/'comm').read_text().strip(),'state':f[0],'parent':int(f[1]),'group':int(f[2]),'session':int(f[3]),'startTicks':int(f[19])}
 except (FileNotFoundError,ProcessLookupError,ValueError):pass
browser=[r for r in rows.values() if any(v in r['name'] for v in ['chromium','chrome','crashpad'])];active=[r for r in browser if r['state']!='Z'];z=[r for r in browser if r['state']=='Z'];ports={}
for port in [4173,4187,4197,4318]:
 sk=socket.socket()
 try:sk.bind(('127.0.0.1',port));ports[str(port)]='FREE'
 except OSError as e:ports[str(port)]='OCCUPIED: '+str(e)
 finally:sk.close()
parent=None;desc=[]
if a.owned_run:
 q=Path(a.owned_run)/'owned-process.json'
 if q.exists():
  parent=json.loads(q.read_text())['pid'];ids={parent};changed=True
  while changed:
   n={r['pid'] for r in rows.values() if r['parent'] in ids};changed=not n.issubset(ids);ids|=n
  desc=[r for pid,r in rows.items() if pid in ids]
report={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'activeBrowserProcesses':active,'zombieBrowserProcesses':z,'ports':ports,'ownedPid':parent,'ownedDescendantsAcrossSessions':desc,'ownedActiveDescendants':[r for r in desc if r['state']!='Z'],'remainingKnownRootCpuAudit':rows.get(21540),'observerSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'scope':'Read-only /proc process identities and local port binds. Zombies are recorded separately; a missing parent does not alone prove detached browser cleanup.'}
out=Path(a.new_output);assert not out.exists();out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'output':str(out),'activeBrowserProcesses':active,'zombieCount':len(z),'ports':ports,'ownedPid':parent,'ownedDescendantsAcrossSessions':desc}))
if a.preflight:assert not active and all(v=='FREE' for v in ports.values()),'Live exclusive browser/strict-port preflight failed'
