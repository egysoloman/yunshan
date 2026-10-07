#!/usr/bin/env python3
"""Read existing evidence and write private delivery drafts only; no game execution."""
from pathlib import Path
import csv, hashlib, io, json
from datetime import datetime, timezone

REPO = Path('/workspace/yunshan')
R24 = Path('/workspace/yunshan-work/ROOT24-economy-next-day-20261007-01')
R25 = Path('/workspace/yunshan-work/ROOT25-reference-visual-20261007-01')
OUT = R25 / 'delivery-draft'
BASE = REPO / 'docs/validation/2026-10-07-city-life-root23/MATRIX-38.csv'
NOW = datetime.now(timezone.utc).isoformat()

def sha(data): return hashlib.sha256(data).hexdigest()
def read_json(path): return json.loads(path.read_text()) if path.exists() else None
def put(name, text): (OUT / name).write_text(text, encoding='utf-8')
def dump(name, data): put(name, json.dumps(data, ensure_ascii=False, indent=2) + '\n')

receipts = []
for root in (R24, R25):
    for path in sorted(root.glob('*/receipt.json')):
        d = read_json(path)
        raw = path.parent / 'raw.log'
        receipts.append({'path': str(path), 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes()),
                         'stage': root.name, 'gate': path.parent.name, 'status': d['status'],
                         'exitCode': d['exitCode'], 'inputCount': d['inputCount'],
                         'inputsStable': d['inputsStable'], 'activeDescendants': d['activeDescendants'],
                         'startedAt': d['startedAt'], 'endedAt': d['endedAt'],
                         'rawSHA256': d['rawSHA256'],
                         'rawReadbackExact': raw.exists() and sha(raw.read_bytes()) == d['rawSHA256']})

native03_receipt = read_json(R24 / 'native03/receipt.json')
native03_result_path = Path('/tmp/ROOT24-economy-next-day-20261007-01/native03/RESULT.json')
native03_failure_path = native03_result_path.with_name('FAILURE.json')
native03_result = read_json(native03_result_path) or read_json(native03_failure_path)
native03_ok = bool(native03_receipt and native03_receipt.get('status') == 'PASS' and native03_receipt.get('inputsStable')
    and native03_result and native03_result.get('status') == 'ACTUAL_COMPLETED'
    and native03_result.get('completedOrdinaryWindows') == 360
    and native03_result.get('actualClock') == 5340 and native03_result.get('actualTick') == 2070
    and native03_result.get('evidence') == 'COMPLETE_ORIGINALS' and not native03_result.get('missingOriginals'))
native03_status = 'PASS（仅原主档下一普通日有界审计）' if native03_ok else (f"{native03_receipt['status']} / {native03_result.get('status', 'NO_RESULT') if native03_result else 'NO_RESULT'}" if native03_receipt else 'RUNNING / PENDING_FINAL_RECEIPT')
native03_boundary = f"native03：{native03_status}。"
native03_failure_note = ''
if native03_result:
    native03_boundary += ' ' + json.dumps({k: native03_result.get(k) for k in ['attemptedOrdinaryCalls','nativeReturnedOrdinaryWindows','completedOrdinaryWindows','actualClock','actualTick','readers','evidence','maximumResidual']}, ensure_ascii=False)
    if native03_result.get('missingOriginals'):
        missing_rows = native03_result['missingOriginals']
        missing_where = [r.get('where') for r in missing_rows]
        native03_failure_note = '本次FAIL新增事实：首个缺失为' + str(missing_where[0]) + '，' + str(missing_rows[0].get('error','')).splitlines()[0] + f'；共{len(missing_rows)}个稳定phase捕获缺失：' + ','.join(str(v) for v in missing_where) + '。原native返回345次、前344窗审计完成，未达360目标；该失败窗完整fullsave/ALLbus仍保留，不能将它们说成全部十phase原件完整。'
        native03_boundary += ' ' + native03_failure_note
else:
    native03_boundary += ' 已有输入/逐帧原件不构成完成回执，不先计360步或下一日通过。'

prefix_receipt = read_json(R24 / 'prefix-recheck01/receipt.json')
prefix_result = None
if prefix_receipt:
    prefix_result = read_json(Path(prefix_receipt['argv'][-1]) / 'RESULT.json')
prefix_ok = bool(prefix_receipt and prefix_receipt.get('status') == 'PASS' and prefix_result and prefix_result.get('status') == 'PASS' and prefix_result.get('checkedWholeOriginalWindows') == 344)
native04_receipt = read_json(R24 / 'native04/receipt.json')
native04_result_path = Path('/tmp/ROOT24-economy-next-day-20261007-01/native04/RESULT.json')
native04_result = read_json(native04_result_path) or read_json(native04_result_path.with_name('FAILURE.json'))
native04_ok = bool(native04_receipt and native04_receipt.get('status') == 'PASS' and native04_receipt.get('inputsStable')
    and native04_result and native04_result.get('status') == 'ACTUAL_COMPLETED'
    and native04_result.get('completedOrdinaryWindows') == 16 and native04_result.get('actualClock') == 5340
    and native04_result.get('actualTick') == 2070 and native04_result.get('evidence') == 'COMPLETE_ORIGINALS')
replay_path = R24 / 'COLD-345-EXACT-REPLAY.json'
replay_result = read_json(replay_path)
replay_ok = bool(replay_result and replay_result.get('status') == 'PASS' and replay_result.get('wholeOriginal345SaveByteExactAcrossColdReplay') and replay_result.get('originalEventPayloadAndDescriptorsEntireOrderedBusEqual'))
continued_day_ok = prefix_ok and native04_ok and replay_ok
continuation_boundary = '新版有限续档：' + ('PREFIX344_PURE_RECHECK_PASS' if prefix_ok else 'PREFIX_RECHECK_PENDING') + '；native04：' + ('PASS16（新cold分支）' if native04_ok else (native04_receipt.get('status','PENDING') if native04_receipt else 'PENDING_FINAL_RECEIPT')) + '。'
continuation_boundary += (' 原完整prefix344与新suffix16覆盖360窗canonical timeline；native03原345return与native04新16共361physical calls，345被物理重放，不是单fresh360；native02历史3call另保。' if continued_day_ok else ' root仅授权原ordinary344完整save SHA f0ea97daef48d4e2357536a3d1ce4b9222dbcbaaa4d5205677bde9483c5a95b6、clock5276/tick2054/speed16，拟新cold import16步至5340/2070，不二次写speed notice；尚无最终补验结论。')
native04_detail = ''
if native04_ok:
    native04_detail = f"native04实际{native04_result['constructors']}fresh/{native04_result['imports']}cold import、16ordinary、{native04_result['readers']}reader，公开命令{native04_result['onlyPublicCommands']}、无focus/身体钱粮身份时间注入；结果前原件{native04_result['actualOriginalBytesBeforeResult']}B/COMPLETE_ORIGINALS。suffix有{native04_result['counts']['npcPaymentCount']}笔canonical full-settlement，gross{native04_result['counts']['npcPaid']}，public{native04_result['counts']['publicNpcPaid']}、private{native04_result['counts']['privateNpcPaid']}；最大残差" + json.dumps(native04_result['maximumResidual'],ensure_ascii=False) + '。'
    parts = native04_result.get('terminalParts',{})
    native04_detail += f"终档{len(parts.get('parts',[]))}真实物理parts逐件readback/assemble SHA {parts.get('assembledSHA256')}，缺真实part拒；extraSim/import/step均{parts.get('extraSimulations')}/{parts.get('extraImports')}/{parts.get('extraSteps')}，不冒额外未来恢复分支。"
if replay_ok:
    native04_detail += f" COLD-345-EXACT-REPLAY实际PASS：旧/新345完整fullsave字节exact SHA {replay_result.get('saveSHA256')}；全部{replay_result.get('events')}项ordered原event与typedOriginal descriptors exact。两个Sim/两个imports覆盖上述361物理步；原345四缺phase未回填。"

probe_attempts = []
for path in sorted(R25.glob('fresh-probe-gate*/receipt.json')):
    receipt = read_json(path)
    result_path = Path(receipt['argv'][-1]) / 'RESULT.json'
    result = read_json(result_path)
    file_checks = []
    for file in (result or {}).get('files', []):
        actual = result_path.parent / file['path']
        file_checks.append({'path':str(actual),'bytes':actual.stat().st_size if actual.exists() else None,
            'expectedSHA256':file['SHA256'],'readbackExact':actual.exists() and sha(actual.read_bytes()) == file['SHA256']})
    probe_attempts.append({'gate':path.parent.name,'receiptPath':str(path),'receipt':receipt,'resultPath':str(result_path),
        'resultSHA256':sha(result_path.read_bytes()) if result else None,'result':result,'referencedFilesReadback':file_checks})
latest_probe = probe_attempts[-1] if probe_attempts else None
probe_receipt_path = Path(latest_probe['receiptPath']) if latest_probe else R25/'fresh-probe-gate01/receipt.json'
probe_receipt = latest_probe['receipt'] if latest_probe else None
probe_result_path = Path(latest_probe['resultPath']) if latest_probe else Path('/tmp/ROOT25-reference-fresh-probe/actual01/RESULT.json')
probe_result = latest_probe['result'] if latest_probe else None
probe_boundary = '新v8完整World factory/Controller/W-E购买退出/GPU最终回执PENDING。'
probe_ok = bool(probe_receipt and probe_result and probe_receipt.get('status')=='PASS' and probe_receipt.get('inputsStable')
    and probe_result.get('status')=='PASS_READ_ONLY_WORLD_AND_GEOMETRY_PROBE' and probe_result.get('simulationConstructions')==0
    and probe_result.get('ordinarySteps')==0 and all(file['readbackExact'] for file in latest_probe['referencedFilesReadback']))
if probe_receipt and probe_result:
    probe_boundary = '原fresh01/02 FAIL保留；' if len(probe_attempts)>=3 else ''
    probe_boundary += f"{latest_probe['gate']}实际{probe_receipt['status']}/{probe_result.get('status')}，0Sim/0step；"
    if probe_result.get('failure'):
        probe_boundary += str(probe_result['failure']).splitlines()[0] + '。本门未产出v8World/arrival/journey，不认出生成功。'
    if probe_ok:
        actual_world_sha = next((file['SHA256'] for file in probe_result['files'] if file['path']=='ACTUAL-SELECTOR-WORLD.json'),None)
        probe_boundary += f"两次production selector/explicit factory World{probe_result.get('worldGenerations')}生成、完整输出{actual_world_sha} byte-exact；原production walking journey存在，最大XZ偏离声明birth path {probe_result.get('maximumJourneyDeviationXZFromDeclaredBirthPath')}m。实际原生步行标志{probe_result.get('actualNativeWalkingEstablished')}，不是Controller实际走路。"
    probe_boundary += ' Controller真实W/E购买退出与完整GPU成功证据另门，不能由只读factory继承。'

frozen_path = R25 / 'FROZEN-415-03.json'
frozen = read_json(frozen_path)
current_diffs = [name for name, digest in frozen.items() if not (REPO / name).is_file() or sha((REPO / name).read_bytes()) != digest]
baseline404 = read_json(REPO / 'docs/validation/2026-10-07-city-life-root23/FINAL-FUNCTIONAL-SHA256.json')
if isinstance(baseline404, dict) and 'files' in baseline404: baseline404 = baseline404['files']
frozen_digest = sha(frozen_path.read_bytes())
current_frozen_path = sorted(R25.glob('FROZEN-*.json'))[-1]
current_frozen = read_json(current_frozen_path)
current_frozen_digest = sha(current_frozen_path.read_bytes())
current_frozen_diffs = [name for name,digest in current_frozen.items() if not (REPO/name).is_file() or sha((REPO/name).read_bytes()) != digest]
current_source_changes = [name for name in sorted(set(frozen)|set(current_frozen)) if frozen.get(name)!=current_frozen.get(name)]
custody02_receipt = read_json(R24 / 'pure02/receipt.json')
custody02_status = 'PASS10/10' if custody02_receipt and custody02_receipt.get('status') == 'PASS' else 'PENDING'
tsc05_receipt = read_json(R24 / 'tsc05/receipt.json')
new_tsc_status = tsc05_receipt.get('status') if tsc05_receipt else 'PENDING'
new_source_note = ''
custody_frozen_path = R25 / 'FROZEN-415-04.json'
custody_frozen = read_json(custody_frozen_path)
custody_source_changes = [name for name in sorted(set(frozen)|set(custody_frozen or {})) if frozen.get(name)!=(custody_frozen or {}).get(name)]
if custody_frozen:
    new_source_note = f'随后root仅修NEWcustody明确分类两类产权元数据，并增第10pure与NEWdriver有限cold continuation；native04绑定冻结41504仍415项，SHA `{sha(custody_frozen_path.read_bytes())}`，相对41503只变：' + ','.join(custody_source_changes) + f'。该版本tsc05实际{new_tsc_status}、custody pure02实际{custody02_status}；游戏业务/世界几何未因这三个NEW文件修补改变。'
if current_frozen_path not in (frozen_path,custody_frozen_path):
    new_source_note += f' ROOT25随后修实际道路箱体世界上表面（负Z微坡时local−Y可能才是朝上实面），再只为新v8声明streetGuardJoinRevision2并以实际同高deck/原body/angle切同edge bend护栏，renderer/checker/body共intervals，新fingerprint绑定revision/算法。最新冻结 `{current_frozen_path.name}` {len(current_frozen)}项，SHA `{current_frozen_digest}`；相对41504变：' + ','.join(name for name in sorted(set(custody_frozen)|set(current_frozen)) if custody_frozen.get(name)!=current_frozen.get(name)) + '。旧v6无新revision分支；不同高度大于原.26容差继续隔离。'
if len(current_frozen)>=417:
    new_source_note += ' 新增泛型reference-street-exit与测试，接入production journey/Controller，仅匹配实际声明v8 arrival/path/当前建筑；新self-edge开口clamp到参与真实segment沿程，旧cross-edge算法不改，算法版本纳fingerprint。最新总功能417＝404原基线＋13NEW＋11MOD−0DEL；原261tests路径继续保留。'
new_source_note += f' 最新冻结当前逐文件差异{len(current_frozen_diffs)}。全部旧门只绑定各原输入，不能冒最新冻结全图重跑。'

navigation_note = ''
if (R25/'pure05/receipt.json').exists():
    navigation_note = '新版production journey/泛型实际声明exit已接入；pure05原联合59项实际FAIL58PASS/1FAIL，其中旧Controller/journey33及exit7实际通过，唯一失败为NEWv6期待遗漏原graded centreline投影Y点。root先用私有V6-ORIGINAL-JOURNEY-COMPARE将原/current完整route逐项equal PASS（0Sim/step）后只改NEW期待，pure06 PASS19/19。随后只修新self-edge浅角cut限参与physicalsegments，pure07 PASS20/20，新增反例证明后续无关segment的rail保留；原cross-edge算法不改。不能改写pure05FAIL或冒最新417输入重新跑全部旧tests。'
build_receipt = read_json(R25/'build01/receipt.json')
build_note = '最新源码build最终回执PENDING。'
if build_receipt:
    build_note = f"build01实际{build_receipt['status']}、{build_receipt['inputCount']}输入stable={build_receipt['inputsStable']}、active={build_receipt['activeDescendants']}；{build_receipt['startedAt']}→{build_receipt['endedAt']}，原raw SHA {build_receipt['rawSHA256']}。实际tsc+vite；>700kB chunk告警保留，未抬限。build通过不代Controller/GPU/参考ART或Mac。"
build02_receipt=read_json(R25/'build02/receipt.json')
if (R25/'build02').exists():
    build_note+=(' 普通fresh默认变更后的build02最终回执PENDING；不由原build01继承。' if not build02_receipt else f" 新main默认变更后的build02实际{build02_receipt['status']}、{build02_receipt['inputCount']}输入stable={build02_receipt['inputsStable']}、active={build02_receipt['activeDescendants']}，{build02_receipt['startedAt']}→{build02_receipt['endedAt']}，rawSHA {build02_receipt['rawSHA256']}；>700kB告警保留。")
main_fresh_line=next((line for line in (REPO/'src/main.ts').read_text().splitlines() if line.startswith('const freshLayout = ')),None)
main_default_v8=main_fresh_line=="const freshLayout = 'current-v8' as const;"
default_fresh_note=('main源码普通新fresh现已选择current-v8；CURRENT/PRODUCT工厂API仍v6，已有存档继续原完整fingerprint选择。新默认build/普通URL限定出生smoke按独立实际门，尚未有smoke回执时PENDING。' if main_default_v8 else 'main源码仍只以?cityLayout=current-v8选择新fresh候选，普通新fresh/CURRENT/PRODUCT默认仍v6；已有存档按原完整fingerprint选择。')
normal_plan_path=R25/'ui-plan/BOUND-NORMAL01.json';normal_plan=read_json(normal_plan_path)
normal_receipt_path=R25/'normal-default01/receipt.json';normal_receipt=read_json(normal_receipt_path)
normal_result_path=Path(normal_receipt['argv'][-1] if normal_receipt else '/tmp/ROOT25-reference-browser-originals/normal-default01')/'RESULT.json'
normal_result=read_json(normal_result_path)
normal_file_checks=[]
for file in (normal_result or {}).get('files',[]):
    p=normal_result_path.parent/file['path'];b=p.read_bytes() if p.exists() else None
    normal_file_checks.append({'path':str(p),'expectedBytes':file['bytes'],'expectedSHA256':file['SHA256'],
        'encodedReadbackExact':b is not None and len(b)==file['bytes'] and sha(b)==file['SHA256']})
normal_ok=bool(normal_receipt and normal_receipt['status']=='PASS' and normal_receipt['inputsStable'] and normal_receipt['activeDescendants']==[]
    and normal_result and normal_result['status']=='PASS_NATIVE_NORMAL_FRESH_DEFAULT_ONLY' and normal_result['actualLayout']=='current-v8'
    and normal_plan and normal_result['planSHA256']==sha(normal_plan_path.read_bytes()) and all(f['encodedReadbackExact'] for f in normal_file_checks))
if normal_ok:
    default_fresh_note=f"main普通新fresh默认v8已实施，并于独立normal-default01实际PASS/PASS_NATIVE_NORMAL_FRESH_DEFAULT_ONLY；{normal_receipt['startedAt']}→{normal_receipt['endedAt']}、41703stable/active[]、raw{normal_receipt['rawSHA256']}。新41703/BOUND-NORMAL01 graph{normal_plan['inputGraphSHA256']}，pagePath={normal_plan.get('pagePath')}无cityLayout override、fresh storedSave=null，无导入/清保存；原body=spawn(-279,80.4,408)、actualv8/FP8988bd85、ordinarytick，实际原生暂停/出生PNG/完整save，{len(normal_result.get('actions',[]))}actions/{len(normal_result.get('captures',[]))}captures，RESULT前{normal_result['evidenceBytesBeforeReceipt']}B、terminal decoded2186745B SHAe0039462c4c11de12b1325b924b8c7b32c496b461c10e98b8fc23f2634fb94e8。22件原件encoded回读及完整terminal decoded exact见[限定门回读]({OUT/'NORMAL-DEFAULT-CLOSED-READBACK.json'})/[解释]({OUT/'NORMAL-DEFAULT-CLOSED-READBACK.md'})。本限定门不执行走路/E/购买/退出/native保存流程，不继承41702为新main版本39交互重跑/UI reload。CURRENT/PRODUCT工厂API仍v6、原存档按原完整fingerprint选择；ART_FAIL/MacNOT_RUN保留。"
browser_attempts=[]
for plan_path in sorted((R25/'ui-plan').glob('BOUND-PLAN*.json')):
    if not plan_path.stem.removeprefix('BOUND-PLAN').isdigit(): continue
    index=int(plan_path.stem.removeprefix('BOUND-PLAN'))
    plan=read_json(plan_path)
    receipt_path=R25/f'browser{index:02d}'/'receipt.json'; receipt=read_json(receipt_path)
    result_path=Path(receipt['argv'][-1] if receipt else f'/tmp/ROOT25-reference-browser-originals/native{index:02d}')/'RESULT.json'
    result=read_json(result_path)
    abort_path=receipt_path.with_name('OPERATOR-ABORT-PARTIAL.json'); abort=read_json(abort_path)
    browser_attempts.append({'planPath':str(plan_path),'planSHA256':sha(plan_path.read_bytes()),'plan':plan,
        'receiptPath':str(receipt_path),'receipt':receipt,'resultPath':str(result_path),'resultSHA256':sha(result_path.read_bytes()) if result else None,
        'operatorAbortPath':str(abort_path),'operatorAbortSHA256':sha(abort_path.read_bytes()) if abort else None,'operatorAbort':abort,
        'resultSummary':{k:result.get(k) for k in ['status','startedAt','finishedAt','elapsedMs','evidenceBytesBeforeReceipt','failure','platform','macHardwareEvidence','artResult','artCompletionEstablished','actualLayout','planSHA256','driverSHA256','inputGraphSHA256','naturalPlayerTravel','injectedGameState','actualFirstPersonOnly','totalWSeconds','totalObservedWSeconds','wPulses','ordinaryTickObserved','finalizationError','observerFinalizationError']} if result else None,
        'actionSummary':[{'id':a['id'],'label':a['label'],'status':a['status']} for a in result.get('actions',[])] if result else [],
        'captureSummary':[{'label':c['label'],'imageFile':c.get('imageFile'),'completeSaveUnchanged':c.get('completeSaveUnchanged'),'cameraUnchanged':c.get('cameraUnchanged')} for c in result.get('captures',[])] if result else []})
latest_browser=browser_attempts[-1] if browser_attempts else None
browser_plan_path=Path(latest_browser['planPath']) if latest_browser else R25/'ui-plan/BOUND-PLAN01.json'
browser_plan=latest_browser['plan'] if latest_browser else None
browser_result_path=Path(latest_browser['resultPath']) if latest_browser else Path('/tmp/ROOT25-reference-browser-originals/native01/RESULT.json')
browser_result=read_json(browser_result_path)
closed_path=OUT/'BROWSER03-CLOSED-READBACK.json';closed=read_json(closed_path)
native_closed_ok=bool(closed and closed['receipt']['status']=='PASS' and closed['receipt']['inputsStable']
    and closed['resultSummary']['status']=='PASS_NATIVE_FUNCTION_AND_GRAPHICS' and closed['allActionStatusPass']
    and closed['allDeclaredOriginalEncodedSHAExact'] and closed['persistedAndTerminalWholeDecodedByteExact'])
browser_note='Controller/browser/GPU本轮实际门PENDING。'
if browser_plan:
    original=browser_attempts[0]; original_result=original['resultSummary']
    if original_result:
        browser_note=f"browser01实际{original_result['status']}，417输入stable/active[]，原件{original_result.get('evidenceBytesBeforeReceipt')}B；9actions中8PASS、首次W门FAIL，保原失败。只有1原出生PNG；RESULT artResult={original_result.get('artResult')}，root实际view仍ART_FAIL，曲檐/门/柜台/地铺/远高楼可见但悬空台基层、遮挡/光照层次不足。"
        browser_note+=' 原trusted KeyW timestamps313846.1→314052.1共206ms，body实际0.9888m/3nativeframes/tick+12；旧capture queueMicrotask先于原window bubble Controller，down accepted仍14744.6/up accepted读到down313846.1，错误造约299s预算消耗。只修私有v2晚注册window bubble after实际Controller同步读accepted，不改游戏/冻结build、不重写旧动作PASS。'
    else:browser_note='browser01最终RESULT尚未产出，PENDING。'
    browser_note+=f" 最新{browser_plan_path.name}计划SHA {sha(browser_plan_path.read_bytes())}、input graph {browser_plan.get('inputGraphSHA256')}；结果路径{browser_result_path}。"
    browser_note += (f"原RESULT实际{browser_result.get('status')}，须按其动作/原件范围，不从截图或计划推断全程PASS。" if browser_result else 'root新fresh运行中/最终RESULT未产出，PENDING；不得冒PASS_NATIVE或ART通过。')
    browser_note += ' '+default_fresh_note
    if (OUT/'BROWSER02-INPUT-SCHEDULING-PENDING.md').exists():
        browser_note += ' native02两原W局部action已PASS：requested各200ms而trusted/accepted真实held6054.4/3364.9ms，两次body各4.8044m，第二insideId原记录变market-b26（自然W入店、非EenterPASS）。private先awaitkeydown回执后host等待的排队导致延长。'
        second=next((attempt for attempt in browser_attempts if attempt['planPath'].endswith('BOUND-PLAN02.json')),None)
        if second and second['resultSummary']:
            browser_note+=f" native02最终实际FAIL：rootowned PID28302/startTicks1745280核定SIGTERM停止失效protocol，保OPERATOR_ABORT_PARTIAL；13完整actions/2原PNG/原件{second['resultSummary']['evidenceBytesBeforeReceipt']}B，未捕获任意中断frontier全save。最后完整body(-282.3922,80.4,400.0788)/market-b26；TargetClosed发生nativeE before(snapshot)，不是E使用失败，Epair/购买/保存均未验证。"
        else:browser_note+=' 原native02最终仍待。'
        browser_note += f" 新私有v3从keydown调用即排队host200ms realkeyup/awaitBoth，realtrusted输入/native时间/120s预算/阈值与原build/inputgraph保持，独立新门未有最终则PENDING，不回填native02。详见[原件输入调度/中止备注]({OUT/'BROWSER02-INPUT-SCHEDULING-PENDING.md'})。"

browser03_partial_path=OUT/'BROWSER03-PARTIAL-E-PURCHASE.json'
browser03_partial=read_json(browser03_partial_path)
if browser03_partial:
    action_status={a['id']:a['status'] for a in browser03_partial['actions']}
    p=browser03_partial['purchaseProof']['original']
    browser_note += f" native03已完成局部原件：00017真实E入店{action_status.get('00017-E-enter-actual-market')}，paused tick200→200、inside null→market-b26；00027实际店铺UI两份购买{action_status.get('00027-ACTUAL-SHOP-UI-PURCHASE-TWO')}，paused tick{p['tickBefore']}→{p['tickAfter']}、cash{p['buyerCashBefore']}→{p['buyerCashAfter']}、stock{p['stockBefore']}→{p['stockAfter']}、food{p['foodBefore']}→{p['foodAfter']}、hunger{p['hungerBefore']}→{p['hungerAfter']}、cost/revenue增{p['cost']}、customers+2。四件完整before/after save编码/解码SHA与5原PNG逐件回读exact，见[局部原件JSON]({browser03_partial_path})/[解释]({OUT/'BROWSER03-PARTIAL-E-PURCHASE.md'})。"
    browser_note += (' 该局部文件保留当时5PNG/PENDING快照，后续退出/保存另取实际闭门回执。' if browser_result else ' 出店/保存/整体最终门与普通URL验收仍PENDING；5原PNG及root实际查看不改ART_FAIL。')
if native_closed_ok:
    c=closed['resultSummary'];r=closed['receipt']
    browser_note+=f" browser03实际闭门PASS/PASS_NATIVE_FUNCTION_AND_GRAPHICS，{r['startedAt']}→{r['endedAt']}，417stable/active[]，raw{r['rawSHA256']}；39actions全部PASS、6原PNG、18 W pulses requested{c['totalWSeconds']}s/observed{c['totalObservedWSeconds']}s，真实单fresh、第一人称/native travel、无注入，RESULT前{c['evidenceBytesBeforeReceipt']}B。全部173 declared原件编码SHA/长度回读exact；原native持久保存与终档decoded3007186B全字节equal SHAe06e87e0877032031a6897cc0ae10a5491512f209a2924b3080d1909e52d6917。真实E退出body(-281.2121614028417,80.61522580545692,402.8382900600361)脚在真curb，未改y；原E入店/有限购买/W返门/E退出/nativeUI保存闭门成立，不冒UI重载/future24。闭门原RESULT SHA{closed['resultSHA256']}，见[173原件回读]({closed_path})/[解释]({OUT/'BROWSER03-CLOSED-READBACK.md'})。Linux SwiftShader非Mac；RESULT art NOT_REVIEWED/root实际view ART_FAIL仍保持。此门仅41702原queryv8，不代新默认build/普通URL门。"

archive_summaries=[]
archive_paths=sorted((REPO/'docs/validation/2026-10-07-city-life-root24-25').glob('*.manifest.json'))
archive_paths+=sorted(Path('/tmp/ROOT24-25-DELIVERY-20261007').glob('*.manifest.json'))
for path in archive_paths:
    d=read_json(path)
    summary={k:v for k,v in d.items() if not isinstance(v,(list,dict))}
    archive=Path(d.get('archive',str(path).removesuffix('.manifest.json')+'.zip'))
    archive_summaries.append({'manifestPath':str(path),'manifestSHA256':sha(path.read_bytes()),
        'producerManifestSummary':summary,'archivePath':str(archive),'actualArchiveBytes':archive.stat().st_size if archive.exists() else None,
        'reviewMethod':'Read-only producer manifest and archive stat. Producer decoded ZIP readback receipt retained; no archive creation or upload by draft author.'})
archive_note=''
if archive_summaries:
    archive_note='root生产者已封存既有闭门原件，私有草稿只读manifest及stat：ROOT24 SELECTED 52850074B/412files/67526037原字节、SHA767e2ca3f67f663f0b694751d9a22bac8f0eaef7fae317ab948b73b82cd0daee，wholePrefixIncluded=false，未纳余341个prefix完整窗，不能称全prefix已包含；完整ALL另置/tmp/ROOT24-25-DELIVERY-20261007/ROOT24-ALL-ECONOMY-ORIGINALS.zip，694912550B/2129files/693781385原字节、SHA73e23e666f21e248e6d5f68f1a6f5d0f95e7ecc919609c58ec30a458531d3fbc。browser01/02封存各run实际原件/driver/plan/回执，缺失或中断观察继续缺失；browser03/normal-default01依各实际manifest封存，不能合称新默认单fresh39交互。生产者manifest记录逐源与ZIP decoded SHA verified；本作者未重新制作ZIP。归档完成不等Library送达。\n\n| 生产者归档 | 实际ZIP字节 | manifest文件数 | manifest SHA256 |\n| --- | --- | --- | --- |'
    for a in archive_summaries:
        d=a['producerManifestSummary']
        archive_note+=f"\n| {Path(a['archivePath']).name} | {a['actualArchiveBytes']} | {d.get('originalFiles',d.get('file_count','见manifest'))} | {d.get('archiveSHA256',d.get('archive_SHA256','见manifest'))} |"
preservation_path=R25/'plan/FINAL-PRESERVATION.json';preservation=read_json(preservation_path)
preservation_note=''
if preservation:
    preservation_note=f"最终保护回执FINAL-PRESERVATION SHA{sha(preservation_path.read_bytes())}：404→417、13NEW/11MOD/0DEL，原261tests全hash exact、AGENTS/提示词与原HEAD全字节exact、原备忘录587709B prefix SHAe52fcb18c2675765207993c59c368506032a258755d5db228f2cf17efbf8deae exact、src/simulation.ts原基线exact。41702→41703仅src/main.ts；本作者另以静态hash/gzip复核上述261/protected/prefix/terminal，无tests执行，见[普通URL只读原件/保护复核]({OUT/'NORMAL-DEFAULT-CLOSED-READBACK.json'})。JS绑定finalInputGraphSHA256为{preservation['finalInputGraphSHA256']}；Python compact map hash另标，不能把不同JSON序列化摘要混为一值。"

metrics_path = OUT/'NATIVE04-ENDPOINT-STATISTICS.json'
metrics = read_json(metrics_path)
metrics_note = ''
if metrics:
    before=metrics['snapshots']['originalMain3900']; after=metrics['snapshots']['terminal5340']; delta=metrics['comparisons']['wholeCanonicalDay']
    metrics_note = f"只读完整端点统计（0Sim/step）3900→5340：616居民钱包总額{before['residentCash']['preciseSum']}→{after['residentCash']['preciseSum']}，{delta['residentCashIncreased']}增/{delta['residentCashDecreased']}减/{delta['residentCashUnchanged']}平；饱足hunger均{before['hunger']['mean']}→{after['hunger']['mean']}，低30人数{before['hunger']['below30']}→{after['hunger']['below30']}；食品商铺库存{before['foodAccess']['shopFoodUnits']}→{after['foodAccess']['shopFoodUnits']}、随身{before['foodAccess']['residentCarriedFoodUnits']}→{after['foodAccess']['residentCarriedFoodUnits']}；公司{before['companyCapital']['count']}→{after['companyCapital']['count']}，资本{before['companyCapital']['preciseSum']}→{after['companyCapital']['preciseSum']}；保存shopemployees均265、保存district就业率按552成人加权{before['employment']['savedDistrictEmploymentWeightedByEndpointAdultCount']}→{after['employment']['savedDistrictEmploymentWeightedByEndpointAdultCount']}。"
    metrics_note += f"来源与每个原件解压/压缩SHA、字段匹配见[统计JSON]({metrics_path})/[解释]({OUT/'NATIVE04-ENDPOINT-STATISTICS.md'})。就业率未重建isEmployed，钱差不独归工资、公司资本不重复计shopFunds、最终115人买得起报价不等路径可达；无长期稳态/补钱论断。"
hunger_path=OUT/'LOW-HUNGER-115-ORIGINAL-ANALYSIS.json'
hunger=read_json(hunger_path)
hunger_note=''
if hunger:
    h=hunger['snapshots']['terminal5340'];hc=hunger['comparison']
    hunger_note=f"低饱足115原件分析：原14只有1人两端仍低30/13恢复、114人新低；终点全部eat/food0、103moving/10riding/2shopping，savedroute余程中位{h['remainingSavedRoutePolylineMetres']['median']}m；钱包最低{h['money']['min']}。5目标店全部open、112目标stock≥1/3人targeteast-b37stock0；457/489原5280有customer后suffix无sale/meal、末people/commerce保持饱足5.5/food0/stock0、pending60与过deadline。79statistical/36regional；欧氏近门不等原walking-tree合法可达。"
    hunger_note+=f" 原件SHA、逐居民/任务/位置/owner资金与suffix ALLbus见[JSON]({hunger_path})；原nearby-food同分/needs/真到达销售guard与最低下一门建议见[诊断]({OUT/'LOW-HUNGER-115-NEXT-STAGE.md'})。只读0Sim/step，不归因普遍没钱/没粮、不替代isEmployed或长期稳态，不擅自执行建议门。"
helper_before = read_json(R24 / 'pure01/inputs-before.json')
joined_before = read_json(R25 / 'pure01/inputs-before.json')
generation_before = read_json(R25 / 'new-generation-gate01/inputs-before.json')
native03_before = read_json(R24 / 'native03/inputs-before.json')
pure_continuity = {
    'custodyHelperAndItsTests': {name: helper_before.get(name) == frozen.get(name)
        for name in ['scripts/economy-resume-custody.ts','tests/economy-resume-custody.test.ts']},
    'jointPure01DifferentInputsVs41503': [name for name in sorted(set(joined_before) | set(frozen)) if joined_before.get(name) != frozen.get(name)],
    'oldGenerationGateInputsEntireFrozen41503Exact': generation_before == frozen,
    'native03StartedOnEntireFrozen41503Exact': native03_before == frozen,
    'meaning': 'A file or full-input byte comparison only; no new test execution or pass inherited for modified files.'}

extra = ['ROOT24计划','ROOT24实现','ROOT24运行','ROOT24验证','ROOT24剩余',
         'ROOT25计划','ROOT25实现','ROOT25运行','ROOT25验证','ROOT25剩余']
raw_base = BASE.read_bytes()
rows = list(csv.reader(io.StringIO(raw_base.decode('utf-8-sig'))))
assert len(rows) == 39 and len(rows[0]) == 37 and all(len(r) == 37 for r in rows)
headers = rows[0]
extensions = []

for row in rows[1:]:
    item = dict(zip(headers,row)); ident = row[0]
    p24 = '保持原完整目标；本轮只审默认World291/原主档4610下一普通日，不以其他城或短窗代验本域。'
    i24 = '本域业务无新增；NEW续档driver/custody仅观察原业务权威，不赋予身份、钱料、时间或劳动。'
    r24 = '本域独立端到端NOT_RUN；helper pure01九组PASS不等本域目标完成。'
    v24 = 'PARTIAL：原38域要求与旧证据边界保留，本域没有新增完整验收结论。'
    rem24 = item['ROOT23剩余'] + '；本轮默认下一日审计不替代该完整闭环。'
    p25 = '保留本域原完整目标；新v8曲檐/公共店前出生切片不缩减城市系统要求。'
    i25 = '本域业务无新增；表现读取权威数据，模型不成为业务状态权威。'
    r25 = '本域独立端到端NOT_RUN；六曲檐/十一出生有限pure不能代验本域。'
    v25 = 'PARTIAL：本轮未给本域新增完整通过结论。'
    rem25 = item['ROOT23剩余'] + '；所有原欠项继续保留。'
    if ident in {'SYS-01','FOOD-01','SHOP-01','POL-02','TRA-01','SAVE-01','VAL-01'}:
        p24 = '原World291/4610完整fresh import，公开speed16、拟360 ordinary(.25)至clock5340/tick2070；逐帧原fullsave/ALLbus/十阶段custody。'
        i24 = 'IMPLEMENTED：纯custody账户/食品/债来源helper与NEW实际续档driver；正常劳动保到岗，公雇出警按原canonical/dispatch/attendance/claim独立核；不改游戏钱粮身份时间。'
        r24 = 'helper pure01 PASS9/9；native01 FAIL0步（speed notice遗漏）；native02 FAIL3returned/2审计complete（误拒巡警38min×.092=3.496）；' + native03_boundary + ' ' + (f'41504 tsc05 {new_tsc_status}/custody pure02 {custody02_status}；' if current_frozen_path != frozen_path else '') + continuation_boundary
        v24 = 'PARTIAL：旧FAIL原件完整保留；原near-site误拒和漏earned只修审计，不补钱或改游戏。下一日范围以原native03FAIL、prefix344重核、新native04suffix16与345exactreplay各最终回执为准，不冒单fresh360或14日稳态。'
        rem24 = item['ROOT23剩余'] + '；' + ('本次下一日有界canonical timeline已覆盖，原FAIL/四缺phase不改、不是单fresh360且非长期稳态。' if continued_day_ok or native03_ok else ('本次下一日原审计FAIL，344complete/345returned，四稳定phase缺失；保原件后新版明确分类/有限cold补验PENDING，14日稳态/持续现金供粮财政未完。' if native03_receipt else '默认下一日最终结果PENDING；14日稳态/持续现金供粮财政未完。'))
    if ident == 'PER-01':
        i24 = 'IMPLEMENTED审计原件资源边界：实验2GiB/下一步预留256MiB；reader原live8M UTF16/archive16MiB/full24777216B/2Mvisited/depth24不放宽。'
        r24 = native03_boundary + ' 性能benchmark NOT_RUN。'
        v24 = 'PARTIAL：原件存储cap/资源停止策略不等任意非法frontier数学保全保证，不等统计化/流式数据库或CPU性能证明。'
    if ident == 'FOOD-01' and hunger:
        r24 += ' 只读端点低30人数14→115（原14仅1仍低/13恢复、114新低）；终点115全eat/food0、103moving10riding2shopping，5目标中3人east-b37stock0、其余112targetstock≥1，cash最低141.2。全115在suffix64min无sale/storedmeal，其他居民真实58餐。'
        rem24 += '；须核115真实到达/局部断货重新处理/可达候选、五目标真实补货与支付，不靠全城库存量或单下一日钱增宣称供粮稳态。'
    if ident in {'SYS-01','MAP-01','MAP-03','TRA-03','LIFE-01','ART-01','SAVE-01','VAL-01'}:
        p25 = '显式新fresh current-v8从保留v6派生；共享曲檐mesh/连续碰撞与有限真店前出生。真实W/E入店购买退出及GPU验收另门。'
        i25 = 'IMPLEMENTED：9knots/8段曲檐闭合68tri，同support/解析swept-cylinder；b26提案(-279,80.4,408)直约7.6m至真door(-282,80.4,401)，整脚圆/真实curb≤.22m；' + ('main普通新fresh默认v8及独立普通URL限定出生PASS，CURRENT/PRODUCT兼容工厂API仍v6，原save完整fingerprint保持。' if normal_ok else ('main普通新fresh代码已v8，普通URL限定门PENDING；CURRENT/PRODUCT兼容API仍v6，旧save fingerprint保持。' if main_default_v8 else '仅新fresh查询候选，默认CURRENT/PRODUCT v6。'))
        r25 = 'pure01整体FAIL23/24（出警7/曲檐6 PASS、出生10/11）；只修NEW出生测试Three独立producer预期后pure02 PASS11/11；tsc03 PASS41503；new-generation-gate01 PASS24旧World/body/roof/FNV逐字；随后actualtop pure03 PASS13、bend/cache pure04 PASS14；pure05整体FAIL58/59但旧33/exit7PASS、原/current v6全routeequal后pure06 PASS19、新segmentclamp pure07 PASS20。' + probe_boundary + ' ' + build_note + ' ' + browser_note
        v25 = 'PARTIAL：24是8旧layouts×3seeds完整生成几何精确比较，0Sim/step，不是24原save load；有限pure不等真实整城出生/合法身体旅程或参考美术通过。'
        rem25 = item['ROOT23剩余'] + ('；41702原query单fresh W/E购买退出/native保存闭门；41703普通URL限定出生另门通过，不冒新版本39交互重跑。全network实体同源、日暮夜全景/街面/内景和参考图质量仍待实际验收。' if native_closed_ok and normal_ok else ('；新v8真实W/E购买退出/native保存已在41702原query单fresh闭门；新普通URL限定门、全network实体同源、日暮夜全景/街面/内景和参考图质量仍待各自实际验收。' if native_closed_ok else '；新v8真实W/E购买退出、全network实体同源、日暮夜全景/街面/内景和参考图质量验收仍待实际结果。'))
    if ident == 'MAP-02':
        i25 = 'IMPLEMENTED有限出生绑定/checker，显式proposal失败拒绝；完整非共享桥/站/rail/lift附近域保守排除，不把通用设施诊断当完成。'
        r25 = '有限出生pure02 PASS11、pure03 PASS13、pure04 PASS14、pure06 PASS19、pure07 PASS20；完整任意地图规划/审批/迁移诊断NOT_RUN。'
    if ident == 'TRA-02':
        p25 = '继续第一人称城市生活；无人机/军机是城内合法获取、登机、驾驶、返航落地退出载具，不另开独立模式入口。'
        i25 = '本轮未新增航空许可或天然身份路径；曲檐/出生不授予驾驶钱源或许可。'
    if ident == 'ART-01':
        v25 = 'PARTIAL / ART_FAIL：曲檐六pure和旧World24精确不是参考图审美验收；' + ('browser03功能/原软件GPU闭门通过，root实际看图仍ART_FAIL。' if native_closed_ok else '真实GPU新图尚无最终结果。')
        r25 += ' ' + browser_note
    if ident == 'MAC-01':
        r25 = 'Mac Safari/Chrome/Firefox实机、FPS/CPU/GPU/内存/长帧NOT_RUN；本轮Linux native耗时或软件GPU不能外推Mac性能。'
        v25 = 'PARTIAL / NOT_RUN：实机证据缺失。'
    extensions.append([p24,i24,r24,v24,rem24,p25,i25,r25,v25,rem25])

matrix_path = OUT / 'MATRIX-38-ROOT24-25-DRAFT.csv'
with matrix_path.open('w',encoding='utf-8-sig',newline='') as f:
    writer=csv.writer(f); writer.writerow(headers+extra)
    for row, ext in zip(rows[1:],extensions): writer.writerow(row+ext)
with (OUT/'MATRIX-ROOT24-25-APPEND-ONLY.csv').open('w',encoding='utf-8-sig',newline='') as f:
    writer=csv.writer(f); writer.writerow(['id']+extra)
    for row, ext in zip(rows[1:],extensions): writer.writerow([row[0]]+ext)
new_rows=list(csv.reader(io.StringIO(matrix_path.read_text(encoding='utf-8-sig'))))
assert [r[:37] for r in new_rows] == rows
assert all('PARTIAL' in r[40] and 'PARTIAL' in r[45] for r in new_rows[1:])
dump('MATRIX-PRESERVATION-DRAFT.json', {'status':'PASS_ORIGINAL_1406_DATA_CELLS_EXACT',
    'privateDraftOnly':True,'baseline':str(BASE),'baselineSHA256':sha(raw_base),
    'baselineRows':38,'baselineColumns':37,'preservedOriginalDataCells':1406,'preservedOriginalHeaders':37,
    'draftRows':38,'draftColumns':47,'addedColumns':extra,'all38DomainsRemainPartial':True,
    'draftSHA256':sha(matrix_path.read_bytes()),
    'historicalCells': 'All original ROOT23 RUNNING/NOT_RUN values are preserved verbatim; final ROOT23 HANDOFF governs its completed stage, and append columns state current scope.'})

gate_rows=[]
labels={('ROOT24','pure01'):'custody 9/9；0 Sim',('ROOT24','pure02'):'新版custody10/10；两类产权元数据明确校验，未知零库存仍拒',('ROOT24','prefix-recheck01'):'现helper重核原完整prefix；不回填345缺phase/0Sim',('ROOT24','native04'):'新cold分支suffix16；按独立RESULT范围',('ROOT25','fresh-probe-gate01'):'FAIL0Sim/step：v8 factory road-top高度图拒；无arrival/journey',('ROOT25','fresh-probe-gate02'):'FAIL0Sim/step：修实际上面后self-bend护栏拒；8mcurb>.22',('ROOT25','fresh-probe-gate03'):'PASS0Sim/step：两完整World/原journey只读几何；非Controller真实步行',('ROOT25','pure01'):'联合23/24；整组FAIL，earned7/roof6通过',('ROOT25','pure02'):'birth11/11；仅修NEW测试独立Three预期',('ROOT25','pure03'):'birth13/13；负Z微坡实际朝上面/真实脚圈',('ROOT25','pure04'):'birth14/14；新同edgebend切口/远端/cache旧值',('ROOT24','native01'):'0ordinary；调速notice预期遗漏',('ROOT24','native02'):'3returned/2审计complete；出警earned误拒',('ROOT24','native03'):'345returned/344complete；businesses未分类，四stable phase缺失/EVIDENCE_INCOMPLETE',('ROOT25','old-generation-gate'):'CJS top-level-await拒；无World',('ROOT25','old-generation-gate02'):'原404：24旧World/body/roof采集',('ROOT25','new-generation-gate01'):'41503：24旧World/body/roof/FNV字节exact；0Sim/step'}
labels.update({('ROOT25','pure05'):'59共58PASS/1NEW预期FAIL；旧33+exit7已PASS',('ROOT25','pure06'):'19/19；只修NEWv6期待原gradedY投影',('ROOT25','pure07'):'20/20；新self浅角cut限参与segment，后段rail仍在',('ROOT25','v6-journey-compare01'):'原/current v6完整routeequal；0Sim/step',('ROOT25','build01'):'实际tsc+vite；chunk>700kB原warning保留'})
labels[('ROOT25','browser01')]='原8/9actions；首次W observer accepted capture先于Controller误计预算FAIL；1出生PNG/ART_FAIL'
labels[('ROOT25','browser02')]='FAIL/OPERATOR_ABORT_PARTIAL：13actions/2PNG；before(snapshot)TargetClosed；无任意frontier终档'
labels[('ROOT25','browser03')]='41702原query单fresh：39PASS/6PNG/18W真实3.6034s；E购买/退出/native保存全字节exact；ART_FAIL/MacNOT_RUN'
labels[('ROOT25','build02')]='41703新main默认v8实际tsc+vite；chunk>700kB原warning保留，不重复旧query流程'
labels[('ROOT25','normal-default01')]='41703普通URLfresh限定出生/原pause/PNG/fullsave；不重复W/E购买保存流程'
for d in receipts:
    stage='ROOT24' if d['stage'].startswith('ROOT24') else 'ROOT25'
    gate_rows.append(f"| {stage}/{d['gate']} | {d['status']} | {d['inputCount']} | {labels.get((stage,d['gate']), '类型检查；原FAIL保留' if d['gate'].startswith('tsc') else '见原回执')} | [{d['gate']} receipt]({d['path']}) |")

report=f'''# ROOT24–25 阶段报告（私有交付草稿）

快照：{NOW}。本文件仅在私有 `delivery-draft` 写入，未上传、未打包、未提交、未修改冻结仓库源码。阶段目标未全部完成：**38域全部PARTIAL，ART_FAIL，Mac实机NOT_RUN**。

## 当前结论与来源

从 `takeover-city-life` 的原HEAD `950348b27d9b4dac558f5508121ff1394faffcc8` 接续。native03与旧几何兼容门绑定41503：415功能文件＝404原基线＋11NEW＋9MOD−0DEL；原261 test路径保持。封存清单SHA256：`{frozen_digest}`，当前源相对该冻结的差异数：{len(current_diffs)}。{new_source_note} 既有运行结果只绑定各回执的实际输入，不外推新版本。

{preservation_note}

用户修订继续有效：玩家以第一人称参与城市生活；无人机、军机属于城内实际获取、接近登机、驾驶、返航落地退出的载具，不是独立模式入口。模型与3D/2D/文字只是表现；地图、设施能力和业务状态须通用，渲染不授予资金、身份、劳动或保存能力。固定十阶段、原资金食品与时间来源、权限与完整保存契约保持。

## ROOT24 原默认城下一普通日

计划从完整World291与原主档4610逐字fresh import，仅公开speed16，目标360 ordinary(.25)至clock5340/tick2070。不得换地图、搬身体、补钱粮、改变需要或身份、跳时钟。NEWdriver捕获完整原fullsave、ALLbus和十阶段custody；616身体/岗位before-after仅在people/commerce/finance/security/politics五业务phase完整保存，其余该字段null，不能写成10×全身体。

custody pure01实际9/9通过；tsc01/02失败和随后tsc03/04通过均保留。native01真实FAIL：1构造/1import/2reader、0ordinary，公开speed实际成功，但新driver遗漏原notice/eventId/FIFO变化。只修完整预期，未改游戏事件。native02真实FAIL：3ordinary returned、前2审计complete、6reader，clock3912/tick1713，结果前原件9605443B/COMPLETE_ORIGINALS。原巡警citizen-335响应crime-5合法累计38min，沿原路线真实159.6m，earned38×.092＝3.496；旧审计错误套用雇主门口near-site条件，漏记earned后形成同额债残差。现金最大残差3.4924596548080444e-10、食品0、财政6.988720713252405e-11。新审计区分普通到岗、合法出警在途/案发点/原许可physical-wait；等待不冒实际行程。游戏工资/财政/身体未补改；observer失败仍latch并整步后停，原canonical债先计账，防二次遗漏残差。

**{native03_boundary}** 无论最终本窗结果如何，360普通步不等14日稳态、默认能源已合法启用或所有子系统完成。实验原件2GiB、下步预留256MiB；原reader live8M UTF16/archive16MiB/full24777216B/2Mvisited/depth24不变。任意非法frontier/IO/ALLbus不具普遍保全数学保证，缺件须明确EVIDENCE_INCOMPLETE，不能提高预算、删旧原件或以摘要冒原件。

{continuation_boundary} 原零值业务元数据与真实产权writer对应的只读证据见[失败分类补充]({OUT/'NATIVE03-FAIL-STATIC-CUSTODY-UPDATE.md'})；其未运行任何新门。严格分类与新suffix不能回填原345的四缺phase，也不能把原FAIL改为PASS。

{native04_detail}

{metrics_note}

{hunger_note}

## ROOT25 曲檐与真实店前出生

已实现显式新fresh current-v8，从保留v6派生；共享9knots/8段曲檐、闭合68tri mesh、整脚圆support和解析连续swept-cylinder碰撞。旧gable/0.1m分支、入口/楼层/footprint/院洞/权限保持；landmark/pavilion与五现代高楼原crown保持。原v7的3875身体负接触和28rail重叠失败保留，不因绕开v7升级为通过。

b26有限提案在原公共道路约10m处选`(-279,80.4,408)`，直接约7.6m到真实door`(-282,80.4,401)`；整.35m脚圆／1.72m身体、共享墙/fixtures/屋顶、地形、路栏及完整非共享network附近域均按有限checker检查。真实curb顶面参与脚高，跨路缘抬脚≤原.22m，离开恢复路面。这个实现与有限fixture pure不能冒完整612楼World实际接受或Controller真实W/E入店购买退出。

pure01联合实际FAIL23/24：earned审计7、曲檐6均通过，出生10通过/1失败。新测试把gradedX真实旋转顶面预期误设为低于80.3；root用原Three Quaternion/Matrix4独立producer核角点/plane后仅修NEW测试，pure02出生11/11通过；不能将pure01整体改为PASS。tsc03于41503通过。

new-generation-gate01实际通过：**8旧layouts×3seeds(20261001/7/2024)共24完整World、每建筑完整body/roof JSON与FNV字节exact；0Sim/step**。旧默认WorldSHA2912839…、FNV b85fa6ec、bodyRoofSHA ffd82e96…保持。这是旧生成几何兼容，不是24次原存档load或新v8实际旅程。{default_fresh_note} 不清保存，不把原旧几何门当新默认的浏览器验收。

新v8实际结果：**{probe_boundary}** 原有限fixture十一pure不代该完整World factory。实际参考图目标仍ART_FAIL；软件GPU不替代Mac实机性能。当前仍需网络桥站基座/地形肩部的renderer与physics同源实体、CBD公共街墙与密度、可用生活内景家具、真实人流与日暮夜层次，不能只凭屋檐或出生切片结案。

新增实际上表面pure03 PASS13/13与仅新v8同edgebend pure04 PASS14/14，原factory01/02失败不改。护栏revision2的只读源核与不同高/远端限制见[静态审阅]({OUT/'TRANSPORT-41506-STATIC-REVIEW.md'})：超原.26容差的高差不切；41506浅角half含1/sin未设普遍半长界的发现保留为历史，随后41702只给新selfedge开口限参与segment、pure07新增浅角后段rail反例通过，旧cross-edge算法保持。更多高差边界/复杂自交与新冻结全旧guards实际验收尚缺。

{navigation_note}

{build_note}

{browser_note}

## 已实际运行的门

| 阶段/门 | 原status | 实际输入数 | 结果边界 | 原回执 |
| --- | --- | --- | --- | --- |
{chr(10).join(gate_rows)}

以上均只读取既有回执；本草稿作者未执行Sim、step、tests、tsc、build、browser、GPU或性能测量。最终receipt/RESULT尚缺的门继续PENDING，不由原件目录或计划推断PASS。

## 原矩阵与剩余

原ROOT23矩阵38×37的**1406数据cell＋37headers全部逐cell保留**，本草稿仅追加ROOT24/25各5列为38×47；[追加完整CSV]({matrix_path})与[只含追加列CSV]({OUT/'MATRIX-ROOT24-25-APPEND-ONLY.csv'})。原历史若干ROOT23 cell仍RUNNING，保留当时事实；ROOT23最终HANDOFF/receipt已完成的stage以其自身来源为准，不能覆盖历史cell。

真实未完成的子系统仍包括：默认城持续现金/供粮/财政与14日稳态；能源合法设备购建、自然磨损、补水/电价和持续有限完整账；医疗卫生材料—出勤—治疗—废物处置闭环与虚构病毒；教育教材预算/自然学业、科研真实资源与产业采用、公职意愿/选举任期/预算consumer；真实商业产权买租与困难退出重开、居民意愿/审批/补偿驱动拆迁迁居建路、灾害空间破坏救援重建；家庭完整世代、文化信息娱乐和健康心理；真统计区/跨区任务、流式区块数据库与原子恢复；正式2D/文字产品及异步Worker/GUI换代；参考图城市美术与Mac实机可玩性能。每个域的原细目继续在矩阵保留，不能用该聚合清单替代原要求。

独立只读代理已完整分段读原备忘录1–2126行/598476B及原提示词/AGENTS；按原15章与用户修订的具体剩余/历史边界见[完整读审]({OUT/'MEMO-FULL-READ-AUDIT.md'})。现有医患真实20分钟/1料、教育真教材/实薪课时、卫生本人运输/接收、病原护理与商租复工均有旧阶段部分通过，不能写成零实现；这些局部证据也不代默认612自然全流程。[三项具体闭环缺项]({OUT/'NEXT-SUBSYSTEM-GAPS.md'})按能源生命周期、科研设备/企业采用、灾害结构损伤/迁居CityPatch逐源行列明已有互动/NPC自动/财政/保存/反馈及未验门。

## 交付与阻碍

{archive_note}

本私有草稿作者未制作ZIP、未上传Library。ROOT23真实15项首次wholebatch因prepare前网络错误失败，0新LibraryID、0memo替换；旧失败不重试、不切direct fallback、不伪造附件。root将统一本次新阶段工件首次newstage batch保存Library，与ROOT23失败batch区分；本草稿作者不自行上传，尚无该新batch成功回执则不宣称送达。已提交/推送的ROOT23基线与本轮未收尾交付分开；本草稿不宣称新源码已提交/推送。最终封存、实际原件readback、Library写入和用户已授权正常开发分支交付由root生产者执行并补真实回执。main/PR/merge/deploy/付费/凭据/安全共享设置无新授权。
'''
put('ROOT24-25阶段报告.md', report)

handoff=f'''# ROOT24–25 接续交接（私有草稿）

快照 `{NOW}`；原HEAD `950348b27d9b4dac558f5508121ff1394faffcc8`，开发分支 `takeover-city-life`。只读源核与私有文档生成；0Sim/step/tests/tsc/build/browser/GPU/性能，无ZIP/上传/提交。

## 冻结与权限

- 根代理唯一重gate；本草稿作者不得修改 `/workspace/yunshan`。native03及旧几何门绑定[FROZEN-415-03.json]({frozen_path})，415项，SHA256 `{frozen_digest}`；当前源相对41503实际差异{len(current_diffs)}。{new_source_note} 41503/41504与此前407门各运行按自身回执绑定，不冒新全图重跑。
- 全部38域PARTIAL；ART_FAIL、MacNOT_RUN不改判。原矩阵38×37/1406cells完整保留，只在私有副本追加10列。
- 第一人称城市生活继续是主体验；无人机/军机是城内合法载具。模型只是3D/2D/文字表现，地图与系统权威须通用。

{preservation_note}

## 已有实际证据

ROOT24 helper pure01 PASS9/9。native01 FAIL0步：public speed成功notice预期遗漏；native02 FAIL3returned/2complete：真实出警38min×.092=3.496误拒且漏earned造成债残差，cash约3.49e-10/food0。两个FAIL与完整原件永保，新审计修driver，不改游戏钱粮身体时间。earned七组pure已在ROOT25联合pure01全部通过。

ROOT25 roof六pure通过；联合pure01整体FAIL23/24。仅NEW出生测试按独立原Three producer修预期后pure02 PASS11/11；41503 tsc03 PASS。24旧layouts×seed完整World/body/roof/FNV byte-exact PASS，0Sim/step，不是24原save loads。后续实际上表面pure03 PASS13/13、新v8同edgebend/cache pure04 PASS14/14，仍限其各自冻结。共享曲檐68tri与v8真店前完整factory由实际探针按下述边界验证；{'41702原query单fresh的真实W/E购买退出/nativeUI保存/软件GPU已闭门PASS，ART_FAIL保留。' if native_closed_ok else 'Controller/W-E购买退出/GPU仍PENDING。'} {default_fresh_note}

## 当前結果与未通过门

{native03_boundary}

{continuation_boundary}

{native04_detail}

{metrics_note}

{hunger_note}

ROOT25：{probe_boundary}

{navigation_note}

{build_note}

{browser_note}

native03目录：`{R24/'native03'}`；真实原件目录：`/tmp/ROOT24-economy-next-day-20261007-01/native03`。最终wrapper `receipt.json`与driver `RESULT.json`或`FAILURE.json`按实际来源读取，核输入stable/active[]、完整原件、最终窗口/reader/残差/预算。原失败与缺件不得改写或猜补；任何修正/继续需新的冻结输入和独立实际门。{'新v8 factory与41702原query/GPU已经按上述回执收束；后续普通URL限定门与新source依其自身回执，不冒全链重跑。' if native_closed_ok else '新World/GPU仍须等待root实际最终回执。'} 不得据本草稿启动并行重门。

## 下一阶段必须继续的目标

默认下一日有界通过也仍需长时现金供粮财政；能源购建设备/劳动/补水/电价/磨损；医疗卫生病毒、教育科研公职财政合法完整consumer；真实商业产权与NPC困难退出再开、居民意愿审批补偿拆迁新路与灾害救援重建；家庭文化健康、统计区与流式保存、正式2D/文字/Worker及参考美术/Mac。全38行原剩余不删。本轮仅有限店前出生与曲檐，不等全世界network身体净空、可用厨房家具或全景ART通过。

## 私有交付文件

- [阶段报告]({OUT/'ROOT24-25阶段报告.md'})
- [完整追加矩阵]({matrix_path})
- [追加列单独CSV]({OUT/'MATRIX-ROOT24-25-APPEND-ONLY.csv'})
- [矩阵保留回执]({OUT/'MATRIX-PRESERVATION-DRAFT.json'})
- [只读证据快照]({OUT/'EVIDENCE-SNAPSHOT.json'})
- [原目标完整读审]({OUT/'MEMO-FULL-READ-AUDIT.md'})
- [三项具体闭环缺项]({OUT/'NEXT-SUBSYSTEM-GAPS.md'})
- [native03分类失败只读补充]({OUT/'NATIVE03-FAIL-STATIC-CUSTODY-UPDATE.md'})
- [native04端点统计JSON]({metrics_path})与[口径解释]({OUT/'NATIVE04-ENDPOINT-STATISTICS.md'})
- [41506护栏分支静态审阅]({OUT/'TRANSPORT-41506-STATIC-REVIEW.md'})
- [低饱足115原件JSON]({hunger_path})与[最低接续建议]({OUT/'LOW-HUNGER-115-NEXT-STAGE.md'})
- [browser01原失败与观察器备注]({OUT/'BROWSER01-OBSERVER-FAIL-NOTE.md'})
- [native02实际W与输入排队待核]({OUT/'BROWSER02-INPUT-SCHEDULING-PENDING.md'})
- [native03原E/两份购买局部原件]({browser03_partial_path})与[解释]({OUT/'BROWSER03-PARTIAL-E-PURCHASE.md'})
- [native03闭门173原件回读]({closed_path})与[解释]({OUT/'BROWSER03-CLOSED-READBACK.md'})
- [普通URL限定门22原件/261测试静态保护回读]({OUT/'NORMAL-DEFAULT-CLOSED-READBACK.json'})与[解释]({OUT/'NORMAL-DEFAULT-CLOSED-READBACK.md'})
- [root端点统计图PNG]({OUT/'ROOT24-ECONOMY-ENDPOINTS.png'})/[SVG]({OUT/'ROOT24-ECONOMY-ENDPOINTS.svg'})与[图来源]({OUT/'ROOT24-ECONOMY-ENDPOINTS.provenance.json'})
- [文件SHA清单]({OUT/'DRAFT-SHA256.json'})

ROOT23 Library首15项wholebatch网络FAIL发生prepare前；0新ID/0memo替换，不自动重试、不direct fallback、不称附件送达。本轮无Library写入。最终封存/上传/正常开发分支提交推送由root生产者完成并写真实结果，不能沿用旧ZIP摘要声称新封存。

{archive_note}
'''
put('HANDOFF.md', handoff)

dump('EVIDENCE-SNAPSHOT.json', {'capturedAt':NOW,'readOnlyRepository':True,
    'forbiddenExecutionsPerformed':[],'privateDraftOnly':True,
    'frozen':{'path':str(frozen_path),'sha256':frozen_digest,'inputCount':len(frozen),'currentDifferentFiles':current_diffs},
    'currentFrozen':{'path':str(current_frozen_path),'sha256':current_frozen_digest,'inputCount':len(current_frozen),'currentDifferentFiles':current_frozen_diffs,'changedVsNative03Frozen':current_source_changes},
    'pureEvidenceContinuity':pure_continuity,
    'receipts':receipts,'native03':{'status':native03_status,'finalReceiptPresent':bool(native03_receipt),
       'resultPath':str(native03_result_path if native03_result_path.exists() else native03_failure_path),
       'finalResultPresent':bool(native03_result),
       'originalResultSHA256':sha((native03_result_path if native03_result_path.exists() else native03_failure_path).read_bytes()) if native03_result else None,
       'resultSummary':{k:native03_result.get(k) for k in ['status','evidence','failure','missingOriginals','constructors','imports','attemptedOrdinaryCalls','nativeReturnedOrdinaryWindows','completedOrdinaryWindows','targetClock','targetTick','actualClock','actualTick','readers','actualOriginalBytesBeforeResult','physicalEvidenceByteCap','elapsedSeconds','onlyPublicCommands','focusPlacements','injectedBodiesMoneyNeedsStockRolesTime','counts','maximumResidual','observerViolations','scope']} if native03_result else None},
    'continuedTimeline':{'status':'PASS_BOUNDED_344_PLUS_16_CANONICAL_WINDOWS' if continued_day_ok else 'PENDING',
        'prefixReceipt':prefix_receipt,'prefixResultSummary':{k:prefix_result.get(k) for k in ['status','constructors','imports','steps','nativeReaderCalls','scope','checkedWholeOriginalWindows','failed345OriginalRetained']} if prefix_result else None,
        'native04Receipt':native04_receipt,'native04ResultSummary':{k:native04_result.get(k) for k in ['status','evidence','constructors','imports','attemptedOrdinaryCalls','nativeReturnedOrdinaryWindows','completedOrdinaryWindows','targetClock','targetTick','actualClock','actualTick','readers','counts','maximumResidual','scope','missingOriginals']} if native04_result else None,
        'interpretation':continuation_boundary},
    'cold345Replay':{'path':str(replay_path),'sha256':sha(replay_path.read_bytes()) if replay_result else None,'result':replay_result},
    'freshV8Probe':{'receiptPath':str(probe_receipt_path),'receipt':probe_receipt,'resultPath':str(probe_result_path),'result':probe_result,'interpretation':probe_boundary,'allOriginalAttempts':probe_attempts},
    'native04EndpointStatistics':{'path':str(metrics_path),'sha256':sha(metrics_path.read_bytes()) if metrics else None,'interpretation':metrics_note},
    'navigationAndExit':{'interpretation':navigation_note,'originalV6RouteComparisonPath':str(R25/'plan/V6-ORIGINAL-JOURNEY-COMPARE.json')},
    'build01':{'receipt':build_receipt,'interpretation':build_note},
    'build02':{'receipt':build02_receipt,'interpretation':build_note},
    'mainFreshDefault':{'sourceExpression':main_fresh_line,'sourceMainSHA256':sha((REPO/'src/main.ts').read_bytes()),'mainOrdinaryFreshV8Implemented':main_default_v8,'interpretation':default_fresh_note},
    'finalPreservation':{'path':str(preservation_path),'sha256':sha(preservation_path.read_bytes()) if preservation else None,'receipt':preservation,'interpretation':preservation_note},
    'normalURLDefaultGate':{'planPath':str(normal_plan_path),'planSHA256':sha(normal_plan_path.read_bytes()) if normal_plan else None,'plan':normal_plan,
        'receiptPath':str(normal_receipt_path),'receipt':normal_receipt,'resultPath':str(normal_result_path),'resultSHA256':sha(normal_result_path.read_bytes()) if normal_result else None,
        'resultSummary':{k:normal_result.get(k) for k in ['status','startedAt','finishedAt','elapsedMs','evidenceBytesBeforeReceipt','platform','macHardwareEvidence','artResult','artCompletionEstablished','actualLayout','planSHA256','driverSHA256','scope','naturalPlayerTravel','injectedGameState','actualFirstPersonOnly','wPulses','totalWSeconds','totalObservedWSeconds','ordinaryTickObserved']} if normal_result else None,
        'actionSummary':normal_result.get('actions',[]) if normal_result else [],'captures':normal_result.get('captures',[]) if normal_result else [],
        'declaredOriginalEncodedChecks':normal_file_checks,'closedLimitedPass':normal_ok,'interpretation':default_fresh_note},
    'browserAttempts':{'allOriginalAttempts':browser_attempts,'interpretation':browser_note},
    'browser03LocalEPurchase':{'path':str(browser03_partial_path),'sha256':sha(browser03_partial_path.read_bytes()) if browser03_partial else None,'interpretation':'Completed local E and purchase only; no overall gate PASS inferred.'},
    'browser03ClosedReadback':{'path':str(closed_path),'sha256':sha(closed_path.read_bytes()) if closed else None,'closedActualPass':native_closed_ok},
    'producerArchives':{'manifests':archive_summaries,'interpretation':archive_note,'libraryDelivered':False},
    'lowHungerCohort':{'path':str(hunger_path),'sha256':sha(hunger_path.read_bytes()) if hunger else None,'interpretation':hunger_note},
    'inputWorldSHA256':'2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512',
    'inputFullSaveSHA256':'4610ab1059b52cfd4bbfa17badf209a7a33ab986735d83b8a5da8c8a9e5ddf6a',
    'oldGenerationResultPath':'/tmp/ROOT25-reference-visual-20261007-01/new-generation01/RESULT.json',
    'all38Domains':'PARTIAL','ART':'FAIL','Mac':'NOT_RUN','thisStageLibraryNewIDs':0,'thisStageLibraryWrites':0})

hashes={p.name:{'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in sorted(OUT.iterdir()) if p.is_file() and p.name!='DRAFT-SHA256.json'}
dump('DRAFT-SHA256.json', {'capturedAt':NOW,'privateDraftOnly':True,'files':hashes})
print(json.dumps({'directory':str(OUT),'files':hashes,'native03':native03_status,'originalCellsPreserved':1406,'originalHeadersPreserved':37,'domains':'38_PARTIAL'},ensure_ascii=False,indent=2))
