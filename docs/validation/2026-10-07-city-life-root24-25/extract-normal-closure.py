#!/usr/bin/env python3
"""Read-only normal-URL originals and source-preservation hashes."""
from pathlib import Path
from datetime import datetime, timezone
import gzip, hashlib, json, subprocess
R=Path('/workspace/yunshan-work/ROOT25-reference-visual-20261007-01')
P=Path('/tmp/ROOT25-reference-browser-originals/normal-default01')
REPO=Path('/workspace/yunshan');OUT=R/'delivery-draft'
def sha(b): return hashlib.sha256(b).hexdigest()
def read(p): return json.loads(p.read_text())
receipt=read(R/'normal-default01/receipt.json');result=read(P/'RESULT.json');plan=read(R/'ui-plan/BOUND-NORMAL01.json')
checks=[]
for d in result['files']:
    p=P/d['path'];b=p.read_bytes()
    checks.append({'path':str(p),'bytes':len(b),'expectedBytes':d['bytes'],'SHA256':sha(b),'expectedSHA256':d['SHA256'],
        'encodedReadbackExact':len(b)==d['bytes'] and sha(b)==d['SHA256']})
d=result['terminalSave'];encoded=(P/d['path']).read_bytes();decoded=gzip.decompress(encoded);save=json.loads(decoded)
world=read(P/'actual-born-WORLD.json');storage=read(P/'fresh-context-storage.json')
preservation_path=R/'plan/FINAL-PRESERVATION.json';preservation=read(preservation_path)
baseline=read(REPO/'docs/validation/2026-10-07-city-life-root23/FINAL-FUNCTIONAL-SHA256.json')
if 'files' in baseline: baseline=baseline['files']
testpaths=[n for n in baseline if n.startswith('tests/')]
testchanges=[n for n in testpaths if not (REPO/n).is_file() or sha((REPO/n).read_bytes())!=baseline[n]]
protected={}
for name in ['AGENTS.md','提示词.md']:
    original=subprocess.run(['git','show','950348b:'+name],cwd=REPO,check=True,capture_output=True).stdout
    current=(REPO/name).read_bytes()
    protected[name]={'originalHEADSHA256':sha(original),'currentSHA256':sha(current),'entireByteExact':current==original}
memo=(REPO/'开发备忘录.md').read_bytes();prefix=memo[:preservation['originalMemoBytes']]
f02=read(R/'FROZEN-417-02.json');f03=read(R/'FROZEN-417-03.json')
changed=[n for n in sorted(set(f02)|set(f03)) if f02.get(n)!=f03.get(n)]
out={'capturedAtUTC':datetime.now(timezone.utc).isoformat(),'method':'Read-only captured originals, gzip and protected-source byte/hash comparison. 0 Sim, 0 step, 0 browser, 0 tests/build.',
    'receiptPath':str(R/'normal-default01/receipt.json'),'receiptSHA256':sha((R/'normal-default01/receipt.json').read_bytes()),'receipt':receipt,
    'resultPath':str(P/'RESULT.json'),'resultSHA256':sha((P/'RESULT.json').read_bytes()),
    'resultSummary':{k:result.get(k) for k in ['status','startedAt','finishedAt','elapsedMs','evidenceBytesBeforeReceipt','scope','actualLayout','worldFingerprint','ordinaryTickObserved','artResult','artCompletionEstablished','platform','macHardwareEvidence','injectedGameState','naturalPlayerTravel','actualFirstPersonOnly']},
    'planPath':str(R/'ui-plan/BOUND-NORMAL01.json'),'planSHA256':sha((R/'ui-plan/BOUND-NORMAL01.json').read_bytes()),
    'inputGraphSHA256':plan['inputGraphSHA256'],'pagePath':plan['pagePath'],'noCityLayoutURLOverride':'cityLayout' not in plan['pagePath'],
    'sourceChangedBetween41702And41703':changed,'actions':result['actions'],'captures':[{k:c.get(k) for k in ['label','imageFile','completeSaveUnchanged','cameraUnchanged']} for c in result['captures']],
    'originalEncodedChecks':checks,'allDeclaredOriginalEncodedSHAExact':all(c['encodedReadbackExact'] for c in checks),
    'storage':storage,'worldSpawn':world['spawn'],'terminalPlayerPosition':save['state']['player']['position'],
    'terminalBodyEntirePointEqualsDeclaredSpawn':save['state']['player']['position']==world['spawn'],
    'terminalSave':{'path':str(P/d['path']),**d,'encodedReadbackExact':len(encoded)==d['bytes'] and sha(encoded)==d['SHA256'],
        'actualDecodedBytes':len(decoded),'actualDecodedSHA256':sha(decoded),'decodedReadbackExact':len(decoded)==d['decodedBytes'] and sha(decoded)==d['decodedSHA256']},
    'preservation':{'producerReceiptPath':str(preservation_path),'producerReceiptSHA256':sha(preservation_path.read_bytes()),'producerReceipt':preservation,
        'originalTestsReadOnlyRecomputed':{'paths':len(testpaths),'changed':testchanges,'allExact':not testchanges},'protectedHeadFiles':protected,
        'memoPrefixReadback':{'originalBytes':len(prefix),'actualPrefixSHA256':sha(prefix),'expectedSHA256':preservation['originalMemoSHA256'],'prefixExact':sha(prefix)==preservation['originalMemoSHA256']},
        'simulationSourceByteHashExactVsBaseline':sha((REPO/'src/simulation.ts').read_bytes())==baseline['src/simulation.ts']},
    'bounds':'Only actual fresh normal URL, native pause, birth PNG and complete terminal save on new 41703 build. 41702 query-v8 closed 39-action route remains separate. No movement/purchase/save-flow repeat, UI reload/future24, Mac performance, art completion or long-term economics claimed.'}
assert receipt['status']=='PASS' and receipt['inputsStable'] and receipt['activeDescendants']==[]
assert result['status']=='PASS_NATIVE_NORMAL_FRESH_DEFAULT_ONLY' and out['allDeclaredOriginalEncodedSHAExact']
assert out['terminalSave']['encodedReadbackExact'] and out['terminalSave']['decodedReadbackExact']
assert out['terminalBodyEntirePointEqualsDeclaredSpawn'] and storage['storedSave'] is None and out['noCityLayoutURLOverride']
assert changed==['src/main.ts'] and len(testpaths)==261 and not testchanges
assert all(d['entireByteExact'] for d in protected.values()) and out['preservation']['memoPrefixReadback']['prefixExact']
(OUT/'NORMAL-DEFAULT-CLOSED-READBACK.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
text=f'''# 普通 URL 新 fresh 默认 v8 限定闭门

outer {receipt['startedAt']}→{receipt['endedAt']} PASS，41703 inputsStable=true/activeDescendants=[]，raw `{receipt['rawSHA256']}`。RESULT实际 PASS_NATIVE_NORMAL_FRESH_DEFAULT_ONLY、SHA `{out['resultSHA256']}`；BOUND-NORMAL01 SHA `{out['planSHA256']}`，input graph `{out['inputGraphSHA256']}`。

实际 production browser pagePath `/?debug=1`，没有 cityLayout override；独立不持久上下文，storedSave=null、noStorageStateSupplied=true，没有存档导入或清除。World实际v8、fingerprint8988bd85；原身体与原spawn完整点相等 (-279,80.4,408)，实际 ordinary tick 后以真实UI暂停。1个原pause动作PASS/1张出生PNG、图前后完整save和camera unchanged。root已实际view原图；ART_FAIL保留。

RESULT前9269999B原件。只读核 {len(checks)} 件 declared originals 编码长度/SHA exact；完整terminal decoded2186745B，SHA `{out['terminalSave']['actualDecodedSHA256']}` exact。原PNG SHA d00658fb45eb01b94a09f8acc5ee2a1b93d16a4612b41735f415da3ffc53ec65。这里只验新默认出生、暂停、原图和save，不把41702原query的39个交互移植为41703全链重跑，不冒UI reload/future24、Mac硬件或参考美术通过。

源41702→41703逐hash仅src/main.ts变化；新普通fresh主入口v8，CURRENT/PRODUCT兼容/无头工厂API保持v6，已有存档依原完整fingerprint选择。只读复核原261 test路径全hash exact、AGENTS/提示词与原HEAD全字节exact、原备忘录587709B prefix SHAe52fcb18c2675765207993c59c368506032a258755d5db228f2cf17efbf8deae exact、原src/simulation.ts exact；producer FINAL-PRESERVATION记录13NEW/11MOD/0DEL。没有运行任何tests、build、Sim、step或browser。

全部逐件路径、原回执和静态复核见 [闭门JSON]({OUT/'NORMAL-DEFAULT-CLOSED-READBACK.json'})。Library保存/新开发分支提交推送尚待root真实外部回执，不能由本地归档或本私有草稿称已送达。
'''
(OUT/'NORMAL-DEFAULT-CLOSED-READBACK.md').write_text(text)
print(json.dumps({'path':str(OUT/'NORMAL-DEFAULT-CLOSED-READBACK.json'),'SHA256':sha((OUT/'NORMAL-DEFAULT-CLOSED-READBACK.json').read_bytes()),'originalFiles':len(checks),'originalTestsExact':len(testpaths),'changedSource':changed,'status':result['status']}))
