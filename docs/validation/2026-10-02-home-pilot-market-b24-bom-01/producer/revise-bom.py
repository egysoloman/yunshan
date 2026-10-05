import csv, hashlib, json, shutil
from pathlib import Path

ROOT = Path('/tmp/yunshan-home-pilot-bom-01')
OUT = ROOT / 'revision-02'
OUT.mkdir(exist_ok=True)
PILOT = Path('/workspace/yunshan/artifacts/v4-coherent04-pilot-market-b24')
raw = json.loads((ROOT / 'raw-counts.json').read_text())
bom = json.loads((ROOT / 'bom.json').read_text())
refs = json.loads((ROOT / 'reference-interface.json').read_text())
if isinstance(refs, dict):
    refs = refs['rows']
rows = {r['资产ID']: r for r in bom['rows']}

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

# Surface provenance, not dimensions alone: lower-link shares a tread shape.
near = raw['nearParts']
def surface_parts(key):
    found = []
    for floor in raw['floorData']:
        for s in floor[key]:
            r = s['rect']
            position = ((r['x0'] + r['x1']) / 2, (s['bottom'] + s['top']) / 2, (r['z0'] + r['z1']) / 2)
            size = (r['x1'] - r['x0'], s['top'] - s['bottom'], r['z1'] - r['z0'])
            matches = [n for n in near if n['part']['purpose'] == 'stairs' and n['part']['floor'] == floor['floor']
                       and all(abs(n['part']['position'][a] - position[i]) < 1e-7 for i, a in enumerate('xyz'))
                       and all(abs(n['part']['size'][a] - size[i]) < 1e-7 for i, a in enumerate('xyz'))]
            assert len(matches) == 1, (key, floor['floor'], s, len(matches))
            found.append(matches[0])
    return found

for asset_id, key, expected in [('A11', 'stairTreads', 34), ('A12', 'stairLandings', 4)]:
    parts = surface_parts(key)
    assert len(parts) == expected
    row = rows[asset_id]
    row['原现实例数'] = row['计划实例数'] = row['现有挂点数'] = expected
    row['证据零件ID'] = [p['id'] for p in parts]
    row['实际尺寸或计划尺寸'] = sorted({tuple(round(p['part']['size'][a], 8) for a in 'xyz') for p in parts})
    row['现有证据'] += '；修订02按provider surface kind匹配，已上传草稿按尺寸误分36/2，真实34/4，总38不变'

for row in bom['rows']:
    row['验收要求'] = row['验收要求'].replace('本栋未做原生入住验收', '本栋controlled租住/服务点休息已实测；普通原生入住全流程/床位专用休息未验')

planned = {
    'A01': '概念方案1组；实体分块数TBD，地形/包络未批准',
    'A04': 'TBD：按真实boundary转角，当前未放置',
    'A05': 'TBD：新房间分区/隔断方案尚未批准',
    'A06': '目标覆盖15真实门洞；具体框件数TBD，当前32件/8组',
    'A07': '概念主门1组；独立门扇片数/铰轴方案TBD',
    'A08': 'TBD：主门/柜门具体叶片和五金方案待定',
    'A09': '54目标窗板；第54片须可信新几何版本修复，当前53',
    'A10': '目标覆盖54真实窗；细件数TBD，当前42组×9=378',
    'A13': '概念4跑双侧8段；洞口/平台连接件数量TBD',
    'A19': '9脊线目标；按脊长分块的独立实例数TBD',
    'A20': 'TBD：排水边缘/落点方案未定',
    'F05': '现3桌面升级；办公/茶几/餐桌可由现桌转型，总实例TBD',
    'F06': '现6桌架侧件升级；是否新桌/新增支撑TBD',
    'F10': '概念衣柜1+食品柜1；洗面台柜可选，柜体总实例TBD',
    'F21': '概念首批4窗帘；全54窗覆盖及最终挂点TBD',
}
for asset_id, value in planned.items():
    rows[asset_id]['计划实例数'] = value
for row in bom['rows']:
    if row['条目类型'] != '物理制作母版':
        continue
    row['计划数量状态'] = '粗件现数可核；目标扩展须新布局批准' if row['原现实例数'] else '概念计划，未放置/未批准'
    row['计划数量状态'] += '；不确定数量明确TBD' if 'TBD' in str(row['计划实例数']) else '；数字仅计划，不是已安放'
    if row['条目类型'] == '物理制作母版' and row['原现实例数']:
        row['计划数量状态'] = row['计划数量状态'].replace('数字仅计划，不是已安放', '现数与计划分列，旧粗件未达美术验收')

rows['F01']['现有证据'] += '；本栋home-bed-close PNG真实为橙白大块，视觉FAIL'
rows['F02']['现有证据'] += '；本栋3床仅原粗件，不能把service休息等同bed使用'
rows['A10']['现有证据'] += '；本栋home-window-by-bed PNG内框细节不可辨，视觉FAIL'
rows['A11']['验收要求'] += '；原controlled 0→1两跑PASS，1→2首踏路点3FAIL；整栋楼梯不可称全可用'
rows['A12']['验收要求'] += '；完整上到2层/下楼待修后真实重验'
rows['D02']['现有证据'] = rows['D02']['现有证据'].replace('本轮未跑本栋GL验证', '本栋controlled GL已拍图，细部仍未达美术验收')
rows['G01']['现有证据'] += '；06:13..06:17原controlled到点：rent600→520/homeId market-b24；rest89.514→100/520无再扣'
rows['G02']['现有证据'] += '；本栋真实rest在table前service点成功，距bed约12.093m，并非bed专用休息'
for asset_id in ['R03', 'R04', 'R05']:
    rows[asset_id]['计划实例数'] = '概念1；可由现3通用桌转型，不先另加3桌，最终TBD'

# Actual dependencies; this column is no longer a redundant self ID.
deps = {
    'A02':['A01'], 'A03':['A02'], 'A04':['A03'], 'A05':['A02','A03'],
    'A06':['A03'], 'A07':['A06','A08'], 'A08':['A07','F10'],
    'A09':['A03','A10'], 'A10':['A03','A09'], 'A11':['A02'], 'A12':['A02','A11'],
    'A13':['A11','A12'], 'A14':['A03'], 'A15':['A03'], 'A16':['A14','A15'],
    'A17':['A14','A15'], 'A18':['A14','A17'], 'A19':['A14'], 'A20':['A14','A15'],
    'A21':['A03','A17'], 'A22':['A06','A10'], 'F01':['A02'], 'F02':['F01'],
    'F03':['F01','F02'], 'F04':['F01','F02'], 'F05':['F06'], 'F06':['A02'],
    'F07':['A02'], 'F08':['F07'], 'F09':['A02','F05'], 'F10':['A02','A07','A08'],
    'F11':['A02'], 'F12':['F11','F14'], 'F13':['F11'], 'F14':['F12'], 'F15':['A02'],
    'F16':['A02'], 'F17':['F16'], 'F18':['F05','F19'], 'F19':['F18'], 'F20':['A02','A03'],
    'F21':['A10'], 'D01':['A03','A06'], 'D02':['A03','A06'], 'D03':['A03'], 'D04':['A03','A01'],
}
for ref in refs:
    asset_id = ref['资产ID']
    ref['dependency_asset_ids'] = deps.get(asset_id, [])
    ref['dimensions'] = rows[asset_id]['实际尺寸或计划尺寸']
    ref['reference_status'] += '；Mac单对象分割方案60无纹理另列，尚未实测成套独立GLB/重组，不当已支持接口'
    if asset_id == 'D01':
        ref['independent_interface'] = 'actual entrance lanternPlacement：1外门灯笼装配/4子件；材质/光源预算与daylight，不能冒充6盏室内灯'
        ref['origin'] = '入口灯笼悬挂顶点；+Y上/+Z朝门外；挂链/发光面依原4子件布局'
    elif asset_id == 'D02':
        ref['independent_interface'] = 'architectureProgramSignPlacement：1门牌框5子件，文本来自building实际名称；已有本栋controlled图，精细可读性未合格'
        ref['origin'] = '靠墙安装面下缘中点；+Y上/+Z向外，文字不镜像'
    elif asset_id == 'F19':
        ref['origin'] = '显示面的下缘中心；+Z朝使用者，与F18屏幕平面配合；面内宽高TBD'
    elif asset_id == 'F20':
        ref['origin'] = '吊灯版本悬挂顶点/床灯版本底面中心，作为同母版参数派生分别声明；非共用任意pivot'
    elif asset_id == 'F21':
        ref['origin'] = '帘轨中点/顶部悬挂线，+Y上/+Z朝室内；窗洞净空仍provider权威'

result = json.loads((PILOT / 'pilot-results.json').read_text())
run = json.loads((PILOT / 'run-manifest.json').read_text())
rent = json.loads((PILOT / 'actual-rent.json').read_text())
rest = json.loads((PILOT / 'actual-rest.json').read_text())
npcs = json.loads((PILOT / 'npc-after-rent-rest.json').read_text())
evidence = {
    'status':'PARTIAL_FUNCTIONAL_PASS_WITH_STAIRS_AND_ART_FAILURE',
    'scope':result['scope'], 'controlledRouteScope':result['routes'][0]['scope'],
    'sourceManifestSHA256':run['sourceManifestSHA256Start'], 'sourceInputCount':run['fileCount'],
    'entry':run['entry'], 'entrySHA256':run['entrySHA256Start'],
    'allInputsUnchanged':run['allInputsUnchanged'], 'allProvenanceUnchanged':run['allProvenanceUnchanged'],
    'exitCode':run['exitCode'], 'startedAt':run['startedAt'], 'completedAt':run['completedAt'],
    'rent':{'walletBefore':rent['before']['money'],'walletAfter':rent['after']['money'],'homeId':rent['after']['homeId']},
    'rest':{'fatigueBefore':rest['before']['needs']['fatigue'],'fatigueAfter':rest['after']['needs']['fatigue'],
            'walletBefore':rest['before']['money'],'walletAfter':rest['after']['money'],'servicePosition':rest['after']['position']},
    'routes':[{'label':r['label'],'status':r['status'],'steps':r['steps'],'end':r['end'],'failure':r.get('failure')} for r in result['routes']],
    'pngCount':len(list(PILOT.glob('*.png'))), 'actualCurrentV4Residents':npcs['residents'],
    'npcSnapshotScope':npcs['scope'], 'naturalNPCDoorEntry':result['naturalNPCDoorEntry'],
    'naturalNPCBedUse':result['naturalNPCBedUse'], 'kitchenBathUse':result['kitchenBathUse'],
    'bedServiceDistanceMetres':result['bedServiceDistanceMetres'], 'missingFixtureKinds':result['missingFixtureKinds'],
    'errors':result['errors'], 'warnings':result['warnings'], 'artReview':'FAIL: original bed remains orange/white block; interior window detail not discernible.',
    'reviewScope':'Parent reviewed pilot images; producer additionally viewed original home-bed-close.png and home-window-by-bed.png. No new render or GPU run.',
    'notRun':['complete 1→2 ascent','complete descent','additional natural20s NPC observation','bed-target rest','ordinary elapsed-frame home journey'],
    'originalFiles':[{'path':str(p),'relative':'evidence/pilot/'+p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(PILOT.iterdir()) if p.is_file()],
}
assert evidence['sourceInputCount'] == 99 and evidence['allInputsUnchanged'] and evidence['exitCode'] == 1
bom['evidenceLimitations'] = [
    'V3 bindings remain historical only. New actual current-v4 pilot read-only snapshots show citizen-67/276/485 homeId market-b24; this does not prove frame-by-frame door or bed use.',
    '06:13..06:17 controlled pilot GL/production-controller route and rent/rest evidence exists: source99/entry fee4 exact, 12PNG. Entire runner exit1: stairs1→2 blocked at waypoint3.',
    'Routes use actual DOM KeyW listener and explicit unchanged production controller.step(dt<=.015) at4.8m/s. This is not an ordinary native elapsed-frame player journey.',
    'Service-point rest passed; bed-target rest is not implemented. Full descent and additional natural20s NPC observation were not run after failure.',
    'Original bed and window interior PNGs remain visual FAIL; no external models integrated; new furniture layouts/quantities not approved.',
]
bom['status'] = 'BOM_REVISION_02_COUNTS_AND_PLANS_WITH_ACTUAL_PILOT_PARTIAL_FAILURE'
bom['actualPilotEvidence'] = evidence
bom['tripo']['separateMacQuote'] = {
    'source':'Parent latest Mac read-only report, not this producer tool call',
    'scheme':'single-object segmentation', 'generationCredits':60, 'texture':'none; texture options mutually exclusive',
    'independentComponentSetSupported':'NOT_VERIFIED', 'independentGLBExportsAndReassembly':'NOT_VERIFIED',
    'exportExtraCost':'UNKNOWN', 'authorization':'PENDING; no generation called',
    'relationshipTo45CreditQuote':'Different reported configuration; does not overwrite earlier independent-component45 ordinary2K quote or N0/N1/N3 comparison.'
}
bom['revisionCorrections'] = [
    'Uploaded draft SHA8bb5e8... remains byte-exact. A11/A1236/2 misclassified same-shaped lower-link; revision uses actual provider semantics34/4.',
    'The draft no-pilot-evidence statement predates completed06:17 pilot; replaced with genuine partial evidence and failure.',
    'Reference dependency_asset_ids changed from self ID placeholders to declared dependencies; D01 copied indoor-light text corrected.',
    'Undetermined leaf/counterpart/layout quantities now explicitly TBD; logical household objects and render subparts are separate units.'
]
header = bom['columnContract'] + ['计划数量状态']
bom['columnContract'] = header
for row in bom['rows']:
    row.setdefault('计划数量状态','装配/材质/接口计划，不能与物理实例相加')

def write_csv(path, subset, columns):
    with path.open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,columns); w.writeheader()
        for r in subset:
            w.writerow({k:json.dumps(r.get(k,''),ensure_ascii=False) if isinstance(r.get(k), (list,dict)) else r.get(k,'') for k in columns})

(OUT/'bom.json').write_text(json.dumps(bom,ensure_ascii=False,indent=2)+'\n')
write_csv(OUT/'bom-full.csv',bom['rows'],header)
write_csv(OUT/'component-masters.csv',bom['rows'][:47],header)
write_csv(OUT/'assemblies.csv',bom['rows'][47:58],header)
write_csv(OUT/'materials-and-semantics.csv',bom['rows'][58:],header)
(OUT/'reference-interface.json').write_text(json.dumps(refs,ensure_ascii=False,indent=2)+'\n')
write_csv(OUT/'reference-interface.csv',refs,list(refs[0]))
(OUT/'pilot-evidence-summary.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
lines=['# market-b24 单栋组件种类清单（修订02）','',
       '47物理母版＝45必需＋2可选；21现有粗件升级＋26新件。11装配配方、6材质包、3生活接口另计。模型0READY。',
       '', '计划数字是待布置概念；TBD须真实layout和共享实体批准。现有数量是渲染子件或声明组数，见计数口径，不直接等于家具件数。',
       '', '| ID | 母版种类 | 现有渲染子件 | 计划/目标实例 | 状态 |', '|---|---|---:|---|---|']
for row in bom['rows'][:47]:
    lines.append('| '+ ' | '.join(str(row[k]).replace('|','/') for k in ['资产ID','中文名称','原现实例数','计划实例数','已有复用或新制'])+' |')
lines += ['', '实测：租住/服务点休息及0→1楼梯两跑通过；1→2第三级路点受阻，整批exit1。3床原粗块/窗内框视觉FAIL；完整下楼、自然NPC跨门/bed-use未完成。']
(OUT/'component-list.md').write_text('\n'.join(lines)+'\n')
physical = bom['rows'][:47]
ids=[x for row in physical for x in row['证据零件ID']]
all_ids=[p['id'] for p in raw['nearParts']+raw['uniqueDetailParts']]
checks={
    'physicalRows':len(physical),'idsUnique':len({r['资产ID'] for r in physical})==47,
    'referenceRows':len(refs),'referenceIdsMatch':{r['资产ID'] for r in physical}=={r['资产ID'] for r in refs},
    'existingKindCount':sum(bool(r['原现实例数']) for r in physical),'newKindCount':sum(not r['原现实例数'] for r in physical),
    'actualListedPartCount':len(ids),'actualListedUniqueParts':len(set(ids)), 'actualEmitterPartCount':len(all_ids),
    'partsCoverExact':len(ids)==len(set(ids)) and set(ids)==set(all_ids),
    'stairTreadParts':rows['A11']['原现实例数'],'stairLandingParts':rows['A12']['原现实例数'],
    'sourceHashesUnchanged':raw['provenance']['sourceHashesUnchanged'], 'generatedMeshesReady':0,'newPaidCalls':0,
    'draftUploadSHA256StillSame':sha(ROOT/'bom-full.csv')=='8bb5e81a9a1dead50d0730fdf4f6d931380181994fb4e72337920e2a91da7d3f',
}
assert checks['partsCoverExact'] and checks['referenceIdsMatch'] and checks['existingKindCount']==21 and checks['newKindCount']==26
(OUT/'bom-consistency.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(checks,ensure_ascii=False,indent=2))
