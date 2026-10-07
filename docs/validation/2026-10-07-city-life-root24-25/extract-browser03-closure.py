#!/usr/bin/env python3
"""Read-only native03 terminal receipts and captured original files."""
from pathlib import Path
from datetime import datetime, timezone
import gzip, hashlib, json
P=Path('/tmp/ROOT25-reference-browser-originals/native03')
R=Path('/workspace/yunshan-work/ROOT25-reference-visual-20261007-01')
OUT=R/'delivery-draft'
def sha(b): return hashlib.sha256(b).hexdigest()
def read(p): return json.loads(p.read_text())
result=read(P/'RESULT.json');receipt=read(R/'browser03/receipt.json')
checks=[]
for d in result['files']:
    p=P/d['path'];b=p.read_bytes()
    checks.append({'path':str(p),'bytes':len(b),'expectedBytes':d['bytes'],'SHA256':sha(b),'expectedSHA256':d['SHA256'],
        'encodedReadbackExact':len(b)==d['bytes'] and sha(b)==d['SHA256']})
terminal=[];payload=[]
for key in ['persistedTerminalSave','terminalSave']:
    d=result[key];b=(P/d['path']).read_bytes();decoded=gzip.decompress(b);payload.append(decoded)
    terminal.append({'kind':key,'path':str(P/d['path']),**d,'encodedReadbackExact':len(b)==d['bytes'] and sha(b)==d['SHA256'],
        'actualDecodedBytes':len(decoded),'actualDecodedSHA256':sha(decoded),
        'decodedReadbackExact':len(decoded)==d['decodedBytes'] and sha(decoded)==d['decodedSHA256']})
exit_path=P/'00035-E-exit-actual-market.action.json';e=read(exit_path)
final=read(P/'00039-ACTUAL-NATIVE-SAVE.action.json')
out={'capturedAtUTC':datetime.now(timezone.utc).isoformat(),'method':'Read-only receipt/RESULT/original SHA checks; 0 Sim, 0 step, 0 browser, no archive creation.',
    'receiptPath':str(R/'browser03/receipt.json'),'receiptSHA256':sha((R/'browser03/receipt.json').read_bytes()),'receipt':receipt,
    'resultPath':str(P/'RESULT.json'),'resultSHA256':sha((P/'RESULT.json').read_bytes()),
    'resultSummary':{k:result.get(k) for k in ['status','startedAt','finishedAt','elapsedMs','evidenceBytesBeforeReceipt','platform','macHardwareEvidence','artResult','artCompletionEstablished','actualLayout','planSHA256','driverSHA256','referenceViewport','naturalPlayerTravel','actualFirstPersonOnly','injectedGameState','wPulses','totalWSeconds','totalObservedWSeconds','ordinaryTickObserved','worldFingerprint','marketBuildingId','shopId']},
    'actions':result['actions'],'actionCount':len(result['actions']),'allActionStatusPass':all(a['status']=='PASS' for a in result['actions']),
    'captures':[{'label':c['label'],'imageFile':c['imageFile'],'completeSaveUnchanged':c['completeSaveUnchanged'],'cameraUnchanged':c['cameraUnchanged']} for c in result['captures']],
    'originalEncodedChecks':checks,'allDeclaredOriginalEncodedSHAExact':all(c['encodedReadbackExact'] for c in checks),
    'terminalSaves':terminal,'persistedAndTerminalWholeDecodedByteExact':payload[0]==payload[1],
    'actualEExit':{'path':str(exit_path),'SHA256':sha(exit_path.read_bytes()),'status':e['status'],
        'before':{k:e['startedBefore'].get(k) for k in ['tick','body','insideId','paused']},
        'after':{k:e['completedAfter'].get(k) for k in ['tick','body','insideId','paused']},'beforeFile':e['beforeFile'],'afterFile':e['afterFile']},
    'nativeSaveAction':{'id':final['id'],'status':final['status'],'tickDelta':final['tickDelta'],'bodyMetres':final['bodyMetres']},
    'artActualReview':'ART_FAIL retained from root actual visual review, distinct from RESULT NOT_REVIEWED.',
    'bounds':'This closed native03 actual fresh v8 route covers lawful first-person W/E entry, finite UI purchase, W return/E exit, native save and terminal whole-byte equality on Linux software GPU. It does not establish new normal-URL default acceptance, UI reload/future24, full-city clearance, reference art completion, Mac hardware performance or long-term economy.'}
assert receipt['status']=='PASS' and receipt['inputsStable'] and receipt['activeDescendants']==[]
assert result['status']=='PASS_NATIVE_FUNCTION_AND_GRAPHICS' and out['actionCount']==39 and out['allActionStatusPass']
assert out['allDeclaredOriginalEncodedSHAExact'] and out['persistedAndTerminalWholeDecodedByteExact']
assert all(t['encodedReadbackExact'] and t['decodedReadbackExact'] for t in terminal)
(OUT/'BROWSER03-CLOSED-READBACK.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
text=f'''# browser03 已闭门原件只读回读

实际 outer receipt：{receipt['startedAt']}→{receipt['endedAt']}，PASS、417 inputsStable=true、activeDescendants=[]；raw SHA `{receipt['rawSHA256']}`。driver RESULT 实际 PASS_NATIVE_FUNCTION_AND_GRAPHICS，SHA `{out['resultSHA256']}`。该结论仅归原41702冻结/BOUND03及其完整单fresh运行，不回填 browser01/02 失败。

39 个动作原状态均 PASS；6 张原 PNG；18 个真实 W pulses，共 requested3.6s/observed3.6033999999910593s；真实第一人称、naturalPlayerTravel=true、injectedGameState=false，并实际观察 ordinary tick。RESULT前原件82230839B。只读核全部 {len(checks)} 个 declared original 的编码长度/SHA exact；没有运行任何游戏、browser或重门。前期 E/两份购买的四件完整 save 解码 exact 另见 [局部提取]({OUT/'BROWSER03-PARTIAL-E-PURCHASE.json'})，保留当时 PENDING 快照。

原 E 退出动作00035 PASS：market-b26内 (-281.99713022924965,80.4,398.0188791495811)→真实街外 (-281.2121614028417,80.61522580545692,402.8382900600361)、insideId=null，tick760→780。脚在原真curb高度，不抹平y；之后原native暂停至tick792，再以实际保存UI完成00039 PASS。

原持久保存文件与实际终档各decoded3007186B，SHA `{terminal[0]['actualDecodedSHA256']}`，逐完整解码字节相等（编码也相同SHA27a1636e533c6feb99fbc1a9a5e4c6b450464740e1ac18d43e002a4b525ae9d4）。这证明本次真实UI保存与当前完整终档一致，没有另称已经运行UI重载或future24。

实际平台 Linux Chromium/ANGLE SwiftShader software GPU；不是Mac硬件性能结果。driver artResult=NOT_REVIEWED/artCompletionEstablished=false；root已实际看图仍 **ART_FAIL**。普通URL新fresh默认v8变更/独立限定smoke，全612城市净空、参考美术、Mac与长期稳态仍待各自实际门；38域仍PARTIAL。

逐原路径、SHA、动作和保存字段见 [闭门回读JSON]({OUT/'BROWSER03-CLOSED-READBACK.json'})。
'''
(OUT/'BROWSER03-CLOSED-READBACK.md').write_text(text)
print(json.dumps({'path':str(OUT/'BROWSER03-CLOSED-READBACK.json'),'SHA256':sha((OUT/'BROWSER03-CLOSED-READBACK.json').read_bytes()),'originalFiles':len(checks),'status':result['status'],'terminalByteExact':out['persistedAndTerminalWholeDecodedByteExact']}))
