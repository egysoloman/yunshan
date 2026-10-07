#!/usr/bin/env python3
"""Read existing native03 originals only; no browser or simulation execution."""
from pathlib import Path
import gzip, hashlib, json
from datetime import datetime, timezone

ROOT = Path('/tmp/ROOT25-reference-browser-originals/native03')
OUT = Path('/workspace/yunshan-work/ROOT25-reference-visual-20261007-01/delivery-draft')
def sha(b): return hashlib.sha256(b).hexdigest()
def read(p): return json.loads(p.read_text())
def descriptor(d):
    p = ROOT / d['path']; b = p.read_bytes()
    v = {'absolutePath':str(p), **d, 'actualSHA256':sha(b), 'actualBytes':len(b)}
    v['encodedReadbackExact'] = v['actualSHA256'] == d['SHA256'] and len(b) == d['bytes']
    if d.get('encoding') == 'gzip':
        decoded = gzip.decompress(b)
        v.update(actualDecodedSHA256=sha(decoded), actualDecodedBytes=len(decoded),
            decodedReadbackExact=sha(decoded)==d['decodedSHA256'] and len(decoded)==d['decodedBytes'])
    return v
actions = []
for name in ['00017-E-enter-actual-market.action.json','00027-ACTUAL-SHOP-UI-PURCHASE-TWO.action.json']:
    p=ROOT/name
    if not p.exists(): continue
    d=read(p)
    actions.append({'path':str(p),'bytes':p.stat().st_size,'SHA256':sha(p.read_bytes()),
        'id':d['id'],'label':d['label'],'status':d['status'],'requestedInput':d['requestedInput'],
        'tickDelta':d['tickDelta'],'bodyMetres':d['bodyMetres'],'realFrameCount':d['realFrameCount'],
        'before':{k:d['startedBefore'].get(k) for k in ['tick','body','insideId','paused']},
        'after':{k:d['completedAfter'].get(k) for k in ['tick','body','insideId','paused']},
        'beforeFile':descriptor(d['beforeFile']),'afterFile':descriptor(d['afterFile']),
        'failure':d['failure']})
proof_path=ROOT/'ACTUAL-SHOP-PURCHASE-PROOF.json'
proof={'path':str(proof_path),'bytes':proof_path.stat().st_size,'SHA256':sha(proof_path.read_bytes()),'original':read(proof_path)} if proof_path.exists() else None
captures=[]
for p in sorted(ROOT.glob('capture-*.capture.json')):
    d=read(p)
    captures.append({'path':str(p),'SHA256':sha(p.read_bytes()),'label':d['label'],
        'imageFile':descriptor(d['imageFile']),'completeSaveUnchanged':d.get('completeSaveUnchanged'),
        'cameraUnchanged':d.get('cameraUnchanged')})
result_path=ROOT/'RESULT.json'
data={'capturedAtUTC':datetime.now(timezone.utc).isoformat(),'method':'Read-only originals, gzip/hash checks; 0 Sim, 0 step, 0 browser execution.',
    'nativeOutputRoot':str(ROOT),'resultExistsAtRead':result_path.exists(),
    'completedActionFilesAtRead':len(list(ROOT.glob('*.action.json'))),
    'meaning':'Only the two completed local action receipts and existing capture originals below. Overall gate, exit, save and normal URL remain PENDING until their actual originals and terminal receipts.',
    'artStatus':'ART_FAIL retained from root actual image review; no art PASS inferred.',
    'actions':actions,'purchaseProof':proof,'captures':captures}
assert all(a['beforeFile']['encodedReadbackExact'] and a['beforeFile']['decodedReadbackExact'] and a['afterFile']['encodedReadbackExact'] and a['afterFile']['decodedReadbackExact'] for a in actions)
assert all(c['imageFile']['encodedReadbackExact'] for c in captures)
(OUT/'BROWSER03-PARTIAL-E-PURCHASE.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
text=f'''# native03 原生 E 入店与有限购买局部原件

只读提取时间：{data['capturedAtUTC']}。本文件没有执行 Sim、step 或 browser；完整压缩/解压 save 与 PNG 逐件 SHA/长度回读 exact。原件根目录：`{ROOT}`。本次读取时 RESULT 存在：{data['resultExistsAtRead']}；完整 action 文件 {data['completedActionFilesAtRead']} 件。该计数随运行增长，不是最终回执。

原动作 `00017-E-enter-actual-market` 局部 PASS：原生暂停 tick200→200，身体从 (-281.6119685714569,80.4,401.9054066665991)、insideId null，通过真实 E 到 (-282,80.4,399)、insideId market-b26；身体位移 2.931203897352714m、4 个真实帧。前后完整 save 原件保留并 exact 回读。它与 native02 自然 W 入店、以及中断前 E 尚未执行的失败分别记录。

原动作 `00027-ACTUAL-SHOP-UI-PURCHASE-TWO` 局部 PASS：实际店铺 UI 买 2 份，原生暂停 tick360→360、身体与 insideId 不变、7 个真实帧。钱包 600→577.0541691571732、店库存 90→88，cost=22.945830842826787；shop revenue 0→同 cost、customers 0→2、profit 0→13.110164375400643、shop cash 52.480365440715104→73.59052981611575。1 份实际吃掉、1 份携带，food0→1、饱足81.84999999999775→100。完整 before/after exportSave 保留有限钱包、库存、结算/寄售/税效果；不把 revenue 与 shop cash 当作相同净入账。

`ACTUAL-SHOP-PURCHASE-PROOF.json` SHA `{proof['SHA256'] if proof else None}`。两动作原 JSON、四件完整 save 的编码及解码 SHA 与所有已存在 capture 的 PNG SHA 见 [局部统计 JSON]({OUT/'BROWSER03-PARTIAL-E-PURCHASE.json'})。

capture01..05 原 PNG 均已生成，涵盖出生、真门、E 后室内、柜台和购买 UI；每件 completeSaveUnchanged/cameraUnchanged 为 true。root 已实际查看门/室内/柜台，**ART_FAIL 保留**。这些局部证据不替代退出、完整保存恢复、整体 browser RESULT 或普通 URL 验收；上述项目尚无完成原件/回执时均保持 PENDING。旧 browser01 FAIL 与 browser02 FAIL/OPERATOR_ABORT_PARTIAL 不回填。
'''
(OUT/'BROWSER03-PARTIAL-E-PURCHASE.md').write_text(text)
print(json.dumps({'jsonSHA256':sha((OUT/'BROWSER03-PARTIAL-E-PURCHASE.json').read_bytes()),'noteSHA256':sha((OUT/'BROWSER03-PARTIAL-E-PURCHASE.md').read_bytes()),'resultExists':data['resultExistsAtRead'],'actions':len(actions),'captures':len(captures)}))
