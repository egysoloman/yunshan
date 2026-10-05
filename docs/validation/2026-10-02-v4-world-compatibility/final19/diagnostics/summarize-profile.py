import json,collections,hashlib
from pathlib import Path
p=Path('diagnostics/world-save-final.cpuprofile');data=json.loads(p.read_text());nodes={n['id']:n for n in data['nodes']};parents={child:n['id'] for n in data['nodes'] for child in n.get('children',[])}
def key(node):
    f=node['callFrame'];return (f['functionName'] or '(anonymous)',f['url'],f['lineNumber']+1)
keys={i:key(n) for i,n in nodes.items()};total=sum(data['timeDeltas']);elapsed=0;groups={'whole_run':{'self':collections.Counter(),'inclusive':collections.Counter(),'total':0},'last_150s_approx':{'self':collections.Counter(),'inclusive':collections.Counter(),'total':0}}
for identifier,delta in zip(data['samples'],data['timeDeltas']):
    elapsed+=delta
    for name,g in groups.items():
        if name!='whole_run' and elapsed<total-150_000_000:continue
        g['total']+=delta;g['self'][keys[identifier]]+=delta;seen=set();current=identifier
        while current:
            k=keys[current]
            if k not in seen:g['inclusive'][k]+=delta;seen.add(k)
            current=parents.get(current)
result={'profileFile':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'samples':len(data['samples']),'weightedSampleDurationSeconds':total/1e6,'scope':'Single immutable final19 run, sampled time not hardware benchmark. Whole-run attribution exact for samples; tail150s approximate occupied-floor case (actual case151.203s).','groups':{}}
for name,g in groups.items():
    group={'weightedSeconds':g['total']/1e6}
    for category in ['self','inclusive']:
        group[category]=[{'function':k[0],'url':k[1],'line':k[2],'sampledSeconds':v/1e6,'sharePercent':v/g['total']*100} for k,v in g[category].most_common()]
    result['groups'][name]=group
Path('diagnostics/cpu-attribution.json').write_text(json.dumps(result,indent=2)+'\n')
for name,g in result['groups'].items():
    print(name,round(g['weightedSeconds'],3),'sampled seconds')
    for category in ['self','inclusive']:
        print(category)
        for row in g[category][:12]:print(round(row['sharePercent'],2),row['function'],Path(row['url']).name,row['line'])
