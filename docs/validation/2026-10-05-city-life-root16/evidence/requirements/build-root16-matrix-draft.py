from pathlib import Path
import csv, hashlib, json, re

OUT = Path('/workspace/yunshan-work/ROOT16-requirements-20261005-01')
REPO = Path('/workspace/yunshan')
FINAL = REPO / 'docs/validation/2026-10-05-city-life-root16'
AUDIT = OUT / 'MATRIX-38-AUDIT.csv'
OLD = REPO / 'docs/validation/2026-10-04-city-life-root15/REQUIREMENTS-MATRIX.md'
FOOD = Path('/workspace/yunshan-work/ROOT16-food-integration-20261005-01')
CAUSE = Path('/workspace/yunshan-work/ROOT16-food-cause-20261005-01')
MED = Path('/workspace/yunshan-work/ROOT16-medical-cause-20261005-01')
rows = list(csv.DictReader(AUDIT.open(encoding='utf-8-sig')))
assert len(rows) == 38
old_ids = re.findall(r'^\| ([A-Z]+-\d+) ', OLD.read_text(), re.M)
assert old_ids == [r['id'] for r in rows]

food_actual = ('R16同一4f图从原tick720终档正常续演：baseline-observe01 PASS128原tick/cap600，70本人/119收据；'
               'all229-continuation01 PASS256原tick/cap600，累计229本人/513收据（119+394），'
               '均核本人报价/钱包/库存及hunger+52；最后首次恢复tick1015，距原720为295ticks/590游戏分钟。'
               '完整384tick/768游戏分钟观察结束于1104，存活616、hunger<30且携粮<1人数0；'
               '实际新产粮39.55340519300031+50.79688454369469=90.350289736695；'
               '最大现金残差1.6298145055770874e-9/粮食4.263256414560601e-12，229目标观测内身体拒绝0。[R16-FOOD]')
food_boundary = ('R16限定PASS：只证明原229人各自真实到柜台购买恢复，以及列明384tick内生产/守恒；'
                 '原最终食店库存15374.522774083653→14655.873063820345仍使用库存缓冲。'
                 '不是所有616人同时满饥饿/全需要或后续新饥饿、长期食供财政稳态、医药、完整suite/美术/Mac。'
                 'foodSnapshot的routeReachability仍标NOT_OBSERVED，逐人真实柜台收据另证该229到场；不把统计字段改写为永久全图可达。')
query_actual = ('R16 pure-query02 PASS：674开放road/bridge节点1图分量、156食店374地面sale点纯door→sale规划存在；'
                '原229为193moving/36riding，193剩余reference3D路程中位1418.1873m；'
                '154人的晴天4.2m/游戏分钟路线估计长于其hunger按.05/min降至0时间。'
                'academy/government/starport食店0、原饥饿163人（54/54/55），说明当前长距离服务分布；'
                '不是永久不可达。[R16-QUERY]')
query_boundary = ('R16纯查询只证明当前图连通、当前腿/局部door-sale规划和条件时间估计；'
                  '不含未来天气、排队、改路、库存和实体拒绝，不是实测到达时刻。'
                  '193/36为真实latest名单，不能混用旧scope189/37；'
                  '后续229实际收据已证明该有界群体成餐，不证明所有未来路径clear。'
                  '三文件food诊断候选尚未安装，不以候选模块存在升级统一诊断能力。')
save_actual = ('R16 full-partition24-01 PASS：从tick1104原terminal edf73ed2aa923b16248f3981092ea78dfe6375e5be1a4d4e3c6914ca84285754，'
               '全档与分块立即等字节、未来24原.25tick/speed8逐步exact；'
               '无World参数的generic分块实际787parts，future24 SHA208b44db8a19486b0564b66018e434b2fd49516e0d833c4bcb1f6a5be2b074e8。[R16-SAVE]')
save_boundary = ('R16保存PASS只属上述4f食物续演终档；787是genericparts，不是旧ROOT15的124个地理parts。'
                 '旧ROOT15地理124与其当时原件仍保原归属；不替古引擎独立oracle、长周期/满quota或当前医疗成功后的+24。')
med_plan = ('R16 NEW512有限医疗方案当前NOT_RUN：正常main帧512、每帧原delta≤1秒、speed16、内部原.25累积、'
            'wall cap900；有限18份真实购买食物/13次gift，从原240帧FAIL真终档续演；'
            '须当前日paid审批→工人真实生产→有限材料采购→本人真实到场20有效分钟→耗1料/健康结果/唯一卫生batch及+24。'
            '可能只完成1名真实玩家，原公共target6不改、不预填6/6。[R16-MED-PLAN]')
med_boundary = ('R16草稿冻结时医疗新实际运行NOT_RUN；仅窄类型检查PASS/有限计划，不是治疗或恢复PASS。'
                '旧240帧0/6 FAIL、HOST-only512暂停与旧gift conditional分别保留；'
                '主root将依新回执替换本NEW状态，不能覆盖旧失败。卫生batch产生不等清洁、运输或末端处置。')
food_next = ('缺少食店片区先按真实产权、居民意愿/身份、有限经营资金库存和劳动检查供料与需求可达性，'
             '不自动生成免费市场/道路或改速度/needs；继而独立冻结长期食供/现金财政验证；'
             '当前另推有限医药1名玩家正向链，默认城与断路医疗fixture分列。')

updates = {
'SYS-01': {'actual': 'R16同一4f数值图完成原229柜台恢复及终档未来24；本轮未新跑2D/3D宿主。[R16-FOOD][R16-SAVE]', 'boundary': 'R16 headless有界真业务续演不认证新2D完整产品或3D表现。'},
'MAP-01': {'actual': 'R16复用既存current-v6 World与原4f真终档；generic保存24 PASS，不是另一个城市。[R16-SAVE]', 'boundary': '本轮没有新地图创建、导入或迁移验收。'},
'MAP-02': {'actual': query_actual, 'boundary': query_boundary, 'remaining': '三文件候选未安装；统一报告、任意地图能力/容量诊断和长期服务分布优化仍欠。', 'next': '将已冻结纯查询/真实收据做公开诊断契约，逐次合法需求和有限供料验证；优先检查无食店片区长路，禁止免费增店或城ID特判。'},
'MAP-03': {'actual': 'R16原v6服务分布查询及229真购买续演发生；无新Renderer/GPU或美术验收。[R16-QUERY][R16-FOOD]', 'boundary': '当前三区食店缺口是服务距离问题，后续成餐不升级城市参考观感。'},
'MED-01': {'actual': med_plan, 'boundary': med_boundary, 'remaining': '新有限玩家治疗正向链尚未实际运行，医师当前日实薪与材料采购不得借教育/赠粮PASS外推。', 'next': '先完成NEW512已冻结有限1玩家真治疗链并保终档/+24，再单独验证原6目标及自然医患药械供需；不扩旧240界。'},
'MED-02': {'actual': med_plan, 'boundary': med_boundary, 'remaining': '当前NEW18food/13gift计划NOT_RUN；旧fixture还保另一个education service-3 awaitingSupply/cap40/target6，不只算health1份；医疗target6仍未完。', 'next': '在新回执范围内证当前日paid来源、有限食物→工人生产→真实采购→有效20分钟；若1玩家成功仅报1，并独立保存24，原target6继续开放。'},
'HYG-01': {'actual': 'R16新医疗有限方案NOT_RUN，当前没有可新增的真实医疗废物批次。[R16-MED-PLAN]', 'boundary': '即使未来产生唯一waste batch，也只证明产污，不自动证明消毒、运输或末端处理。'},
'EDU-02': {'remaining': 'R16医疗续演fixture另一个school service-3 awaitingSupply仍在；不得把ROOT15 compact6人PASS外推该新续演或默认自然学校。'},
'POL-02': {'actual': 'R16食物384tick持续核现金守恒，最大残差1.6298145055770874e-9；新医师当前日paid审批待实证。[R16-FOOD][R16-MED-PLAN]', 'boundary': '短窗现金守恒不证明国库持续、财政稳态或医师授权已发生。'},
'SHOP-01': {'remaining': '新food诊断未安装、229买粮不是倒闭后重开；无食店三区的有限经营供料仍未验。', 'next': '保原AND与本人意愿/身份/现场产权交易，先具名有限经营供料和无店片区服务距离检查；另有界自然多轮更替及终点，不造免费市场或困难。'},
'SHOP-02': {'remaining': 'R16食物成餐不证明土地/产权或tenant新状态；未来缺店供给必须沿实际买租、本人钱粮料工和权利账。'},
'FOOD-01': {'actual': food_actual, 'boundary': food_boundary, 'remaining': 'R16已补原latest229本人真实柜台恢复缺口，旧scope189/37仍只属原未验名单；当前前三无食店区问题是长距离而非永久不可达。长期生产/库存缓冲耗尽后的供给与财政稳态、具名物流、医疗fixture仍未完；三文件诊断候选未安装。[R16-QUERY]', 'next': food_next},
'LIFE-01': {'actual': 'R16原NPC229正常柜台购买/恢复；本轮玩家赠食医疗新方案NOT_RUN。[R16-FOOD][R16-MED-PLAN]', 'boundary': 'NPC真实成餐不等玩家完整家具厨卫日常、自然身份旅程或医疗。', 'remaining': '有限18food/13gift新方案还待实际结果；厨房/家具和完整玩家自然日常缺项保留。'},
'LIFE-03': {'actual': 'R16原229每人有本人报价/钱包库存收据及柜台hunger+52真实恢复；终点全616存活且hunger<30且携粮<1人数0。[R16-FOOD]', 'boundary': '原229人先后得到一餐不等所有616同时满needs、营养心理/疾病或后续不再饥饿。'},
'PER-01': {'actual': save_actual, 'boundary': 'R16 generic787只是保存分块；不是地理流式、统计个体卸载或吞吐证据。'+save_boundary},
'SAVE-01': {'actual': save_actual, 'boundary': save_boundary, 'remaining': 'R16食物终档保存24已补该scope；医疗成功与新tenant困境状态+24尚未发生，长日容量/非法档组合仍欠。'},
'VAL-01': {'actual': 'R16 baseline128/continuation256/终档24三组均PASS、322首尾稳定、ownedActive[]；原raw分别绑定新回执。[R16-FOOD][R16-SAVE]', 'boundary': '仅本轮列明三组运行PASS；原7e OOM FAIL、b5 full TIMEOUT_PARTIAL/79cancelled、最新完整npm/browser/Mac NOT_RUN均保留。'+med_boundary, 'remaining': '原229短窗真实恢复与食物终档24已完成，不消除38域全游戏缺项；候选三文件未安装/医疗NEW待实际、长期食供财政、美术/Mac和当前完整套仍未完。', 'next': '先整合有限医疗新回执与候选诊断实施，按冻结候选做必要相关检查；完整套先诊断未执行/超时原因，不盲跑1小时，不把窄结果拼成全套。'},
}

HEAD = '''# ROOT16 完整需求—实现—实际运行—验证—剩余矩阵（供主root整合的草稿）

本表保留ROOT13原38领域ID、原完整需求，并继承ROOT15完整扩展需求与全部未完项；38领域逐序一致。最新用户要求的环境/建筑/卫生/病毒、停业后居民自愿买租开店、拆迁铺路、火灾地震、意愿与身份约束，以及同一数值核独立2D/3D并支持未来任意地图，仍在整表目标中。当前先推进子系统，不因食物窄结果、候选代码或本次阶段缩减完整游戏目标。

旧事实分别沿[ROOT13原38项CSV](../2026-10-04-city-life-root13/SYSTEM-MATRIX-asof1439.csv)、[ROOT14原报告](../2026-10-04-city-life-root14/REPORT.md)、[ROOT14原矩阵](../2026-10-04-city-life-root14/REQUIREMENTS-MATRIX.md)、[ROOT15原报告](../2026-10-04-city-life-root15/REPORT.md)与[ROOT15原矩阵](../2026-10-04-city-life-root15/REQUIREMENTS-MATRIX.md)追溯。所有R13/H14/D14/F14/C14/T14/R15窄运行仍归原scope；旧引用不指向ROOT16 REPORT。旧缺项原文保留作阶段冻结记录，R16确已补充的范围在同格另行明确，不把旧NOT_OBSERVED改造成旧时已经PASS。

新运行以[ROOT16新报告](REPORT.md)及本表新原件引用为准。当前已核食品原件：4f1c39d4769b4172f9aed8477b666c480cb1b4be2d7a244d8144d7d1408c9927、322输入/80src/119测试模块；新食物scope复用原World与真tick720终档，原speed8/.25tick/focus/mode/mealpolicy/钱粮/身体/需求不改，真实128+256tick续演，另终档未来24。这里列出的新增食品PASS属于未改生产代码的baseline图；三文件food诊断候选未安装、其最终图和必要回归由主root整合后另列，不能用4f结果认证后来候选。

医疗草稿冻结状态：NEW512正常main帧/speed16/cap900、有限18份食物/13次gift目前NOT_RUN，仅有限方案与窄type可执行；主root将追加实际回执。原240帧FAIL/0服务保留。最多先验证1名真实玩家，原公共6目标不变，未运行不预填疗效或成功后保存。全38完整游戏、当前全套、长期财政食供、ART、Mac仍未完成。

| ID / 领域 | 原完整需求与继承扩展 | 已实现能力 | 实际运行（旧scope与R16分列） | 已验证状态与边界 | 剩余或阻碍（保留阶段原记录） | 下一具体验收规划 |
| --- | --- | --- | --- | --- | --- | --- |
'''

def clean(s):
    return s.replace('\n', '；').replace('|', '\\|')

def old_link_fix(s):
    return s.replace('(evidence/suite-extension-diagnosis/REPORT.md)', '(../2026-10-04-city-life-root15/evidence/suite-extension-diagnosis/REPORT.md)')

updated = []
lines = [HEAD]
for r in rows:
    u = updates.get(r['id'], {})
    requirement = '原需求：' + r['original_requirement'] + ' 扩展完整目标：' + r['latest_complete_requirement']
    actual = '继承原记录：' + old_link_fix(r['latest_actual_run'])
    if u.get('actual'): actual += ' R16新增：' + u['actual']
    boundary = '继承原边界：' + r['latest_verified_boundary']
    if u.get('boundary'): boundary += ' R16边界：' + u['boundary']
    remaining = 'ROOT15冻结时原记录：' + r['latest_remaining']
    if u.get('remaining'): remaining += ' R16当前：' + u['remaining']
    next_step = u.get('next', r['latest_next_acceptance'])
    fields = [r['id']+' '+r['domain'], requirement, r['latest_implemented'], actual, boundary, remaining, next_step]
    lines.append('| ' + ' | '.join(clean(v) for v in fields) + ' |\n')
    d = dict(r)
    d.update({'root16_new_actual': u.get('actual','本项无新增实际运行'), 'root16_new_boundary': u.get('boundary','原scope限定边界保留，未升级完整目标'), 'root16_new_remaining': u.get('remaining','原完整未完项保留'), 'root16_next_acceptance': next_step})
    updated.append(d)

TAIL = '''
本轮食品范围已经填补的是：原tick720筛出的229人，每人实际柜台购买和hunger+52恢复。最后一人的首次成餐在tick1015，即从原起点295ticks/590游戏分钟；完整观察结束tick1104，不能写成“1015之后再295ticks”。三份新食品执行回执PASS，322前后稳定、ownedActive[]；回执保留观察到的Z子进程身份，不把active[]误写成所有历史进程消失。分块787是无World参数generic路径；旧ROOT15带World的地理124parts仅属其原scope。

服务距离的纯查询范围仍必须分开：academy/government/starport无食店涉及原163人，674节点为一个路网分量、193步行者余路中位1418.1873m、154人的条件参考时间超过饥饿降零时间，这些不是永久不可达或动态到达时刻。229后续真实成餐说明该有界群体可以到柜台，长距离服务布局与长期生产需求/财政缺口依然开放。下一步以真实产权/意愿和有限经营供料优化需求可达性，不免费造市场、不调速度/needs或硬编码某城ID。

完整未完目标仍包括物理电网/燃料产业，全医疗药械/自然公校/科研产业，卫生末端/自然游戏疫情，长期政治续任和法律治理，环境生态管网，火震结构救援重建，多轮自然商业更替/整栋土地产权破产，拆迁补偿安置/原子CityPatch新路，具名有限物流/实体接地上下车，家庭自然一代和文化心理完整日常，公用设施运营迁移，真统计卸载/异步流式恢复，任意地图能力诊断，新受信2D/Worker发行物与合法宿主完整接线，参考美术和Mac实机。原38项无删除，已通过的模块窄范围不自动完成所属完整领域。

原FAIL/超界/未安装仍是既存事实：7e完整none suite heap OOM exit134；b5 process/concurrency1完整cap3600 TIMEOUT_PARTIAL，Node权威359tests/280pass/0fail/79cancelled/0skip、78文件未执行；medical原240帧0/6FAIL；tenant私有CLOSED未安装/第三轮NOT_OBSERVED/default120超时；T14未启用/C14消费者未接；ART总体FAIL，最新完整npm、新browser与Mac NOT_RUN。34历史scope缺失的原sourcefacts/path+SHA、旧/tmp丢失原件不通过新源码重建。本矩阵起草没有执行Simulation、build、规则/UI/browser/GPU、提交或发布。

归档合同也保持原边界：完整议政办理记录及其全部引用来源保存；未关联申请/投票/任期的旧日proof按既有资格过期规则退休，只留retiredProofCount，不复造旧原文。原默认一天创建45条、退休28条、保留hot4+cold13=17条；17不是永久全工作历史。

新证据引用的路径为主root预定公开归档目标。此独占草稿不创建共享证据；原件到目标的完整路径/SHA映射保存在MATRIX-LINK-MAP.json，主root复制并复核后可使用本表。

[R16-FOOD]: evidence/food/outputs/all229-continuation01/SUMMARY.json
[R16-QUERY]: evidence/food/cause/pure-query02/artifacts/QUERY-SUMMARY.json
[R16-SAVE]: evidence/food/outputs/full-partition24-01/SUMMARY.json
[R16-MED-PLAN]: evidence/medical/REPORT.md

食品原始执行回执：[baseline128](evidence/food/baseline-observe01/receipt.json)、[all229续演256](evidence/food/all229-continuation01/receipt.json)、[full/partition未来24](evidence/food/full-partition24-01/receipt.json)。原食品名单/全部真实柜台收据/实际生产/具名终点沿该目录outputs各组原件追溯。旧最新证据仍指[ROOT15 build](../2026-10-04-city-life-root15/evidence/gift-final-integration/build01/receipt.json)、[ROOT15 UI35](../2026-10-04-city-life-root15/evidence/gift-final-integration/ui01/original-artifacts/ui-results.json)、[ROOT15教育6人](../2026-10-04-city-life-root15/evidence/gift-final-integration/education-actual01/original-artifacts/PASS-summary.json)、[ROOT15原默认一天](../2026-10-04-city-life-root15/evidence/gift-final-integration/city-life-default-day01/receipt.json)，不把这些原scope指向新ROOT16报告。
'''
lines.append(TAIL)
lines.append('\n原ROOT13欠项原文追溯附表：下表完整保留原CSV中的38条missing_or_blocked，仅是该旧阶段冻结时的记录。须按主表后续R14/R15/R16实际scope判读：例如app64归档及列明V2教育已在后续窄范围补足，不反写成原阶段已发生，也不把它们再算成当前一律未实现；未有后续实际补证的目标仍开放。此处只抄录已存在文本，不重建或补造旧sourcefacts/源码/原始证据。\n\n| 原领域ID | ROOT13冻结时欠项原文 |\n| --- | --- |\n')
for r in rows:
    lines.append('| ROOT13 '+r['id']+' | '+clean(r['original_missing_or_blocked'])+' |\n')
text = ''.join(lines)
draft = OUT / 'REQUIREMENTS-MATRIX.md'
draft.write_text(text)
new_csv = OUT / 'ROOT16-MATRIX-38-DRAFT.csv'
with new_csv.open('w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=list(updated[0]))
    writer.writeheader(); writer.writerows(updated)

links = [
 ('evidence/food/outputs/all229-continuation01/SUMMARY.json',FOOD/'outputs/all229-continuation01/SUMMARY.json'),
 ('evidence/food/outputs/full-partition24-01/SUMMARY.json',FOOD/'outputs/full-partition24-01/SUMMARY.json'),
 ('evidence/food/cause/pure-query02/artifacts/QUERY-SUMMARY.json',CAUSE/'pure-query02/artifacts/QUERY-SUMMARY.json'),
 ('evidence/medical/REPORT.md',MED/'REPORT.md'),
 ('evidence/food/baseline-observe01/receipt.json',FOOD/'baseline-observe01/receipt.json'),
 ('evidence/food/all229-continuation01/receipt.json',FOOD/'all229-continuation01/receipt.json'),
 ('evidence/food/full-partition24-01/receipt.json',FOOD/'full-partition24-01/receipt.json'),
]
link_records = []
for target, source in links:
    data = source.read_bytes()
    link_records.append({'targetRelativeToFinalROOT16':target,'source':str(source),'sourceBytes':len(data),'sourceSHA256':hashlib.sha256(data).hexdigest(),'currentlyExistsAtTarget':(FINAL/target).exists()})
(OUT/'MATRIX-LINK-MAP.json').write_text(json.dumps({'plannedFinalDirectory':str(FINAL),'draftOnly':True,'copyActionPerformed':False,'linkTargets':link_records,'reportTarget':'REPORT.md','reportCurrentlyExists':(FINAL/'REPORT.md').exists()},ensure_ascii=False,indent=2)+'\n')

ids = re.findall(r'^\| ([A-Z]+-\d+) ', text, re.M)
assert ids == old_ids and len(ids)==38
assert all(r['original_requirement'] in text for r in rows)
assert all(r['latest_complete_requirement'] in text for r in rows)
assert all(r['latest_remaining'] in text for r in rows)
assert all(r['original_missing_or_blocked'] in text for r in rows)
assert '(evidence/suite-extension-diagnosis/REPORT.md)' not in text
assert '最后首次恢复tick1015，距原720为295ticks/590游戏分钟' in text
assert '无World参数的generic分块实际787parts' in text
old_links = re.findall(r'\]\((\.\./[^)]+)\)',text)
old_links_resolved = [{'target':p,'exists':(FINAL/p).resolve().exists()} for p in sorted(set(old_links))]
assert all(d['exists'] for d in old_links_resolved)
proof = {'idCount':len(ids),'sameOrderAndIdsAsROOT15':ids==old_ids,'everyROOT13OriginalRequirementPreserved':True,'everyROOT15CompleteRequirementPreserved':True,'everyROOT15RemainingVerbatimPreservedAsHistoricalRecord':True,'everyROOT13MissingVerbatimPreservedAsHistoricalRecord':True,'medicalAtDraftFreeze':'NEW512_NOT_RUN','newSimulationRunsByThisTask':0,'sharedWritesByThisTask':0,'publicationByThisTask':0,'legacyLinksResolvedAtPlannedFinalLocation':old_links_resolved,'files':[]}
for p in [draft,new_csv,OUT/'MATRIX-LINK-MAP.json']:
    data=p.read_bytes(); proof['files'].append({'path':str(p),'bytes':len(data),'lines':len(data.splitlines()),'sha256':hashlib.sha256(data).hexdigest()})
(OUT/'MATRIX-DRAFT-CHECK.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(proof,ensure_ascii=False,indent=2))
