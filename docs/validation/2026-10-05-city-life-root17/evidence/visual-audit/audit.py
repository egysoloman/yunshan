#!/usr/bin/env python3
"""Read-only audit of sealed ROOT17 GPU results; does not import game code."""
from pathlib import Path
import collections, csv, datetime, hashlib, json, math, struct, sys

OUT = Path(__file__).resolve().parent
GPU = Path('/tmp/ROOT17-visual-gpu-20261005-01')
REPO = Path('/workspace/yunshan')
VISUAL = Path('/workspace/yunshan-work/ROOT17-visual-city-20261005-01')
sha = lambda b: hashlib.sha256(b).hexdigest()
compact = lambda x: json.dumps(x, ensure_ascii=False, separators=(',', ':')).encode()
load = lambda p: json.loads(p.read_bytes())

def write(name, obj):
    p = OUT / name
    with p.open('x', encoding='utf-8') as f:
        f.write(json.dumps(obj, ensure_ascii=False, indent=2) + '\n')

def record(p):
    b = p.read_bytes()
    return {'path': str(p), 'bytes': len(b), 'sha256': sha(b)}

def inputs(source):
    pairs = []
    for folder in ['src', 'tests', 'scripts', 'adapters', 'public']:
        pairs += [(str(p.relative_to(source)), sha(p.read_bytes())) for p in (source / folder).rglob('*') if p.is_file()]
    pairs += [(f, sha((source / f).read_bytes())) for f in ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html']]
    return dict(sorted(pairs))

def difference(a, b, pointer=''):
    if type(a) is not type(b): return [{'path': pointer, 'before': a, 'after': b}]
    if isinstance(a, dict):
        result = []
        for key in sorted(set(a) | set(b)):
            escaped = key.replace('~', '~0').replace('/', '~1')
            if key not in a or key not in b:
                result.append({'path': pointer + '/' + escaped, 'beforeExists': key in a, 'afterExists': key in b, 'before': a.get(key), 'after': b.get(key)})
            else: result += difference(a[key], b[key], pointer + '/' + escaped)
        return result
    if isinstance(a, list):
        result = []
        for i in range(max(len(a), len(b))):
            if i >= len(a) or i >= len(b):
                result.append({'path': pointer + '/' + str(i), 'beforeExists': i < len(a), 'afterExists': i < len(b), 'before': a[i] if i < len(a) else None, 'after': b[i] if i < len(b) else None})
            else: result += difference(a[i], b[i], pointer + '/' + str(i))
        return result
    return [] if a == b else [{'path': pointer, 'before': a, 'after': b}]

def distance(a, b): return math.hypot(a['x'] - b['x'], a['z'] - b['z'])

def nearest_segment(a, b, target):
    dx, dz = b['x'] - a['x'], b['z'] - a['z']
    length2 = dx * dx + dz * dz
    t = max(0, min(1, ((target['x'] - a['x']) * dx + (target['z'] - a['z']) * dz) / length2)) if length2 else 0
    return {'fraction': t, 'distance': math.hypot(a['x'] + t * dx - target['x'], a['z'] + t * dz - target['z'])}

def walk_audit(w):
    all_unique = []
    for s in w['positions']:
        if not all_unique or s['body'] != all_unique[-1]['body']:
            all_unique.append(s)
    pulses = []
    key_events = [e for e in w['events'] if e['type'] in ['keydown', 'keyup'] and e['code'] == 'KeyW']
    for index, p in enumerate(w['pulses']):
        target = {'x': p['target'][0], 'z': p['target'][2]}
        observed = [s for s in w['positions'] if p['begin']['at'] <= s['at'] <= p['end']['at']]
        unique = []
        for s in observed:
            if not unique or s['body'] != unique[-1]['body']: unique.append(s)
        closest = min(observed, key=lambda s: distance(s['body'], target))
        segments = [{'before': a, 'after': b, 'jumpXZ': distance(a['body'], b['body']), 'nearestInterpolated': nearest_segment(a['body'], b['body'], target)} for a, b in zip(unique, unique[1:])]
        crossing = [s for s in segments if s['nearestInterpolated']['distance'] <= 1.8 and distance(s['before']['body'], target) > 1.8 and distance(s['after']['body'], target) > 1.8]
        down, up = key_events[index * 2:index * 2 + 2]
        pulses.append({'waypoint': index + 1, 'target': p['target'], 'assertionReached': p['reached'], 'reason': p['reason'], 'begin': p['begin'], 'end': p['end'], 'realHeldMilliseconds': up['at'] - down['at'], 'trustedKeyEvents': down['isTrusted'] and up['isTrusted'], 'observedSamples': len(observed), 'distinctBodies': len(unique), 'closestObserved': {'at': closest['at'], 'body': closest['body'], 'distanceXZ': distance(closest['body'], target)}, 'observedArrivalSamples': sum(distance(s['body'], target) <= 1.8 for s in observed), 'maximumObservedJumpXZ': max((s['jumpXZ'] for s in segments), default=0), 'segmentsCrossingArrivalCircleByInterpolation': crossing, 'distinctPositionTrace': unique})
    return {'scope': w['scope'], 'exit': w['exit'], 'netDisplacementMetres': w['distance'], 'observedPolylineXZMetres': sum(distance(a['body'], b['body']) for a, b in zip(all_unique, all_unique[1:])), 'samples': len(w['positions']), 'distinctBodies': len(all_unique), 'events': len(w['events']), 'allEventsTrusted': all(e['isTrusted'] for e in w['events']), 'pulses': pulses, 'limits': 'Interpolation diagnoses endpoints that straddle a waypoint. It is not an observed canonical intermediate body, new arrival PASS, collision proof, FPS or macOS claim.'}

started = datetime.datetime.now(datetime.timezone.utc).isoformat()
plan = load(GPU / 'PLAN.json')
original_paths = sorted(p for phase in ['baseline-gpu01', 'candidate-gpu01'] for p in (GPU / phase).rglob('*') if p.is_file())
original_paths += [GPU / 'capture.mjs', GPU / 'PLAN.json', GPU / 'run-phase.py', GPU / 'BASELINE-INPUTS-325.json', GPU / 'CANDIDATE02-INPUTS-327.json', GPU / 'bed-optics-generated-world.json', VISUAL / 'candidate02.patch', VISUAL / 'REPORT.md', VISUAL / 'CLOSURE-RECEIPT.json']
original_paths += sorted((REPO / '参考图').glob('参考图[1-5].png'))
before_records = [record(p) for p in original_paths]
write('ORIGINAL-INPUTS-BEFORE.json', before_records)
write('REQUIREMENTS-AS-READ.json', [record(REPO / f) for f in ['AGENTS.md', '提示词.md', '开发备忘录.md']])
summary, rows, source_before = {}, [], {}
for phase in ['baseline-gpu01', 'candidate-gpu01']:
    root = GPU / phase
    artifacts = root / 'artifacts'
    receipt, results = load(root / 'receipt.json'), load(artifacts / 'RESULTS.json')
    source = Path(results['source'])
    current = inputs(source)
    source_before[phase] = current
    assert current == load(artifacts / 'inputs-before.json') == load(artifacts / 'inputs-after.json')
    graph = sha(compact(current))
    assert graph == results['sourceGraph'] == results['expectedGraph']
    assert sha((GPU / 'PLAN.json').read_bytes()) == results['planSHA256']
    assert sha((GPU / 'capture.mjs').read_bytes()) == results['driverSHA256']
    assert sha((root / 'raw.log').read_bytes()) == receipt['rawSHA256']
    assert sha((source / 'dist' / results['buildEntry'].lstrip('/')).read_bytes()) == results['buildSHA256']
    assert sha((artifacts / 'world.original.json').read_bytes()) == results['worldSHA256'] == plan['comparison']['expected_exact_world_sha256']
    assert receipt['status'] == results['status'] == 'FAIL'
    assert receipt['timedOut'] is False and receipt['activeDescendants'] == []
    assert len(results['captures']) == 16
    all_diffs, shots = {}, []
    for c in results['captures']:
        n = c['name']
        assert load(artifacts / (n + '.json')) == c
        png = (artifacts / (n + '.png')).read_bytes()
        assert png[:8] == b'\x89PNG\r\n\x1a\n' and struct.unpack('>II', png[16:24]) == (1440, 900)
        assert sha(png) == c['png']['sha256'] and len(png) == c['png']['bytes']
        pre = (artifacts / (n + '.before.save.json')).read_bytes()
        post = (artifacts / (n + '.after.save.json')).read_bytes()
        assert sha(pre) == c['saveBeforeSHA256'] and sha(post) == c['saveAfterSHA256']
        assert (pre == post) == c['saveUnchanged']
        ds = difference(json.loads(pre), json.loads(post))
        all_diffs[n] = ds
        assert c['sourceGraph'] == graph and c['buildSHA256'] == results['buildSHA256'] and c['worldSHA256'] == results['worldSHA256']
        gl_failures = [s['gl']['errors'] for s in [c['before'], c['after']] if s['gl']['errors']]
        link_failures = [p for s in [c['before'], c['after']] for p in s['programs'] if p['linked'] is False or (p.get('diagnostics') or {}).get('runnable') is False]
        row = {'phase': phase, 'name': n, 'sourceGraph': graph, 'buildSHA256': results['buildSHA256'], 'worldSHA256': results['worldSHA256'], 'pngSHA256': sha(png), 'pngBytes': len(png), 'saveBeforeSHA256': sha(pre), 'saveAfterSHA256': sha(post), 'saveUnchanged': pre == post, 'jsonLeafDifferences': len(ds), 'beforeTick': c['before']['tick'], 'afterTick': c['after']['tick'], 'paused': c['before']['paused'], 'afterDrawCalls': c['after']['drawCalls'], 'afterTriangles': c['after']['triangles'], 'glOrLinkFailures': len(gl_failures) + len(link_failures), 'scope': c['scope']}
        shots.append(row); rows.append(row)
    write(phase + '-SAVE-DIFFS.json', all_diffs)
    wa = walk_audit(load(artifacts / 'native-walk.trace.json'))
    write(phase + '-WALK-AUDIT.json', wa)
    interior_diffs = all_diffs['controlled-original-interior']
    assert len(interior_diffs) == 284
    assert all(d['path'].startswith('/runtime/focus/') or d['path'].startswith('/state/citizens/') and d['path'].endswith('/tier') or d['path'].startswith('/state/districts/') and d['path'].endswith('/tier') for d in interior_diffs)
    summary[phase] = {'receipt': receipt, 'source': str(source), 'graph': graph, 'buildEntry': results['buildEntry'], 'buildSHA256': results['buildSHA256'], 'worldSHA256': results['worldSHA256'], 'errors': [{'scope': e['scope'], 'message': e['message']} for e in results['errors']], 'shots': shots, 'interiorDifferenceGroups': dict(collections.Counter('/'.join(d['path'].split('/')[:3]) for d in interior_diffs)), 'walk': {k: v for k, v in wa.items() if k != 'pulses'}, 'waypoint4': {k: v for k, v in wa['pulses'][3].items() if k != 'distinctPositionTrace'}}
after_records = [record(p) for p in original_paths]
assert before_records == after_records
for phase, expected in source_before.items(): assert inputs(Path(summary[phase]['source'])) == expected
write('ORIGINAL-INPUTS-AFTER.json', after_records)
with (OUT / 'SCREENSHOT-BINDING-32.csv').open('x', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
write('AUDIT-RESULTS.json', {'status': 'PASS_READONLY_RECONCILIATION_OLD_GPU_FAIL_PRESERVED', 'artStatus': 'FAIL_AFTER_VISUAL_INSPECTION', 'startedAt': started, 'endedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'simulationInstances': 0, 'simulationSteps': 0, 'newBrowserOrGPUExecutions': 0, 'originalFiles': len(original_paths), 'originalsUnchanged': True, 'sourceInputsUnchanged': True, 'phases': summary})
print(json.dumps({'auditStatus': 'PASS_READONLY_RECONCILIATION_OLD_GPU_FAIL_PRESERVED', 'originalsUnchanged': True, 'originalFiles': len(original_paths), 'screenshots': len(rows), 'phaseSummary': {k: {'graph': v['graph'], 'interiorDifferenceGroups': v['interiorDifferenceGroups'], 'nativeDisplacement': v['walk']['netDisplacementMetres'], 'waypoint4ClosestObserved': v['waypoint4']['closestObserved']['distanceXZ'], 'waypoint4MaxJump': v['waypoint4']['maximumObservedJumpXZ'], 'interpolatedCrossingCount': len(v['waypoint4']['segmentsCrossingArrivalCircleByInterpolation'])} for k, v in summary.items()}}, ensure_ascii=False))
