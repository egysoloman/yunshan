from pathlib import Path
import csv, hashlib, json, re, subprocess
from datetime import datetime, timezone
base=Path('/workspace/yunshan')
out=Path('/workspace/yunshan-work/ROOT16-requirements-20261005-01')
out.mkdir(parents=True,exist_ok=True)
def sha(data):return hashlib.sha256(data).hexdigest()
def info(rel):
    data=(base/rel).read_bytes()
    return {'path':str(base/rel),'bytes':len(data),'lines':data.count(b'\n'),'sha256':sha(data)}
paths=['AGENTS.md','提示词.md','开发备忘录.md','docs/需求实现验证矩阵.md','docs/validation/2026-10-04-city-life-root13/SYSTEM-MATRIX-asof1439.csv','docs/validation/2026-10-04-city-life-root15/REQUIREMENTS-MATRIX.md','docs/validation/2026-10-04-city-life-root15/REPORT.md']
source=[info(p) for p in paths]
old=list(csv.DictReader((base/paths[4]).open(encoding='utf-8-sig')))
new=[]
for line in (base/paths[5]).read_text().splitlines():
    if re.match(r'^\| [A-Z]+-\d\d ',line):
        c=[x.strip() for x in line.strip('|').split('|')]
        assert len(c)==7,(len(c),line)
        ident,_,domain=c[0].partition(' ')
        new.append({'id':ident,'domain':domain,'complete_requirement':c[1],'implemented':c[2],'actual_run':c[3],'verified_boundary':c[4],'remaining':c[5],'next_acceptance':c[6]})
assert len(old)==len(new)==38
assert [r['id'] for r in old]==[r['id'] for r in new]
with (out/'MATRIX-38-AUDIT.csv').open('w',encoding='utf-8-sig',newline='') as f:
    fields=['id','domain','original_requirement','original_asof1439_validation','original_missing_or_blocked','latest_complete_requirement','latest_implemented','latest_actual_run','latest_verified_boundary','latest_remaining','latest_next_acceptance']
    w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
    for a,b in zip(old,new):
        w.writerow({'id':a['id'],'domain':a['domain'],'original_requirement':a['user_requirement'],'original_asof1439_validation':a['validation_scope'],'original_missing_or_blocked':a['missing_or_blocked'],'latest_complete_requirement':b['complete_requirement'],'latest_implemented':b['implemented'],'latest_actual_run':b['actual_run'],'latest_verified_boundary':b['verified_boundary'],'latest_remaining':b['remaining'],'latest_next_acceptance':b['next_acceptance']})
# Exact read ranges correspond to full source output inspected in this task tree.
early=[(1,32),(33,62),(63,90),(91,124),(125,155),(156,187),(188,219),(220,247),(248,275),(276,299),(300,337),(338,371),(372,399),(400,424),(425,455),(456,482),(483,513),(514,542),(543,580),(581,619),(620,649),(650,675),(676,700)]
late=[(701,780),(781,860),(861,940),(941,1000),(1001,1060),(1061,1140),(1141,1220),(1221,1280),(1281,1380),(1381,1460),(1461,1546)]
ml=(base/'开发备忘录.md').read_bytes().splitlines(keepends=True)
coverage=[]
for who,ranges in [('memo_early_read',early),('root16_requirements_read',late)]:
    for first,last in ranges:
        d=b''.join(ml[first-1:last]);coverage.append({'reader':who,'firstLine':first,'lastLine':last,'bytes':len(d),'sha256':sha(d),'sourceOutputTruncated':False})
assert [x for first,last in early+late for x in range(first,last+1)]==list(range(1,1547))
assert sum(x['bytes'] for x in coverage)==448219
checks=[]
e=base/'docs/validation/2026-10-04-city-life-root15/evidence'
for scope in ['build01','ui01','education-actual01','city-life-default-day01']:
    r=e/'gift-final-integration'/scope/'receipt.json';j=json.loads(r.read_text());raw=r.with_name('raw.log');actual=sha(raw.read_bytes())
    checks.append({'scope':scope,'receiptPath':str(r),'receiptSHA256':sha(r.read_bytes()),'status':j['status'],'exitCode':j['exitCode'],'timedOut':j['timedOut'],'inputCount':j['inputCount'],'inputsStable':j['inputsStable'],'activeDescendants':j['activeDescendants'],'rawActualSHA256':actual,'rawDeclaredSHA256':j['rawSHA256'],'rawMatchesReceipt':actual==j['rawSHA256']})
for rec,rawname in [('isolated-full-rules01-receipt.json','isolated-full-rules01-raw.log'),('original-full-heap-failure-receipt.json','original-full-heap-failure-raw.log')]:
    r=e/rec;j=json.loads(r.read_text());actual=sha((e/rawname).read_bytes())
    checks.append({'scope':rec,'receiptPath':str(r),'receiptSHA256':sha(r.read_bytes()),'status':j['status'],'exitCode':j['exitCode'],'timedOut':j['timedOut'],'inputCount':j['inputCount'],'inputsStable':j['inputsStable'],'activeDescendants':j['activeDescendants'],'rawActualSHA256':actual,'rawDeclaredSHA256':j['rawSHA256'],'rawMatchesReceipt':actual==j['rawSHA256']})
r=e/'public-health-player/actual03/receipt.json';j=json.loads(r.read_text());actual=sha(r.with_name('raw.log').read_bytes())
checks.append({'scope':'public-health-actual03','receiptPath':str(r),'receiptSHA256':sha(r.read_bytes()),'status':j['status'],'exitCode':j['exitCode'],'timedOut':j['timedOut'],'inputCount':j['inputCount'],'inputsStable':j['inputsStable'],'activeDescendants':j['activeDescendants'],'rawActualSHA256':actual,'rawDeclaredSHA256':j['rawSHA256'],'rawMatchesReceipt':actual==j['rawSHA256']})
for rec,rawname in [('actual-command01/receipt.json','raw.log'),('pure03/rules-run/receipt.json','raw.log'),('pure03/types-run/receipt.json','raw.log')]:
    r=e/'gift-contact-candidate'/rec;j=json.loads(r.read_text());actual=sha(r.with_name(rawname).read_bytes())
    checks.append({'scope':'gift-'+rec,'receiptPath':str(r),'receiptSHA256':sha(r.read_bytes()),'status':j['status'],'exitCode':j['exitCode'],'timedOut':j['timedOut'],'inputCount':j['inputCount'],'inputsStable':j['inputsStable'],'activeDescendants':j['activeDescendants'],'rawActualSHA256':actual,'rawDeclaredSHA256':j['rawSHA256'],'rawMatchesReceipt':actual==j['rawSHA256']})
assert all(x['rawMatchesReceipt'] for x in checks)
receipt={'task':'ROOT16 requirements/evidence read-only audit','at':datetime.now(timezone.utc).isoformat(),'repository':str(base),'baselineHEAD':'a1888cd764cabe250e78f2f4460a7b103dff302a','observedHEAD':subprocess.check_output(['git','rev-parse','HEAD'],cwd=base,text=True).strip(),'observedBranch':subprocess.check_output(['git','branch','--show-current'],cwd=base,text=True).strip(),'observedStatus':subprocess.check_output(['git','status','--porcelain'],cwd=base,text=True).splitlines(),'sourceDocuments':source,'allRequestedDocumentsFullyRead':True,'fullMemoReadByTaskTeam':True,'fullMemoSingleReaderClaim':False,'memoCoverage':coverage,'memoCoverageContiguous1To1546':True,'memoCoverageBytes':sum(x['bytes'] for x in coverage),'otherCompleteReadCoverage':{'AGENTS.md':[[1,11]],'提示词.md':[[1,184]],'docs/需求实现验证矩阵.md':[[1,100],[101,180],[181,260],[261,340],[341,440]],'ROOT13_originalCSV':{'header':True,'rows':[[1,10],[11,20],[21,30],[31,38]]},'ROOT15_matrix':[[1,22],[23,42],[43,56]],'ROOT15_REPORT':[[1,24],[25,44],[45,64],[65,83]]},'truncatedSupplementaryAttempts':{'description':'Two initial supplementary matrix/report combined outputs were truncated. They were not used to claim complete coverage; all affected files were subsequently re-read in the smaller complete ranges above. No requested memo source chunk was truncated.'},'instructionLocations':{'/workspace/.agents':{'exists':True,'entries':[]},'/workspace/yunshan/.agents':{'exists':False},'/workspace/AGENTS.md':{'exists':False}},'matrixAudit':{'originalIDCount':len(old),'latestIDCount':len(new),'orderedIDsExactMatch':True,'missingIDs':[],'addedIDs':[],'latestIDs':[r['id'] for r in new]},'existingReceiptsAndRawChecks':checks,'newExecution':{'Simulation':0,'GPU':0,'build':0,'test':0,'networkOrExternalWrites':0,'sharedFileEdits':0,'publication':0},'scopeNote':'Existing receipts/raw are read and hashed only. Prior PASS is retained for its immutable input graph, parameters, caps, and assertions; no fresh runtime result is claimed.'}
(out/'READ-RECEIPT.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
report='''# ROOT16 只读需求与证据审计

完整游戏目标保持开放。原 ROOT13 的 38 个领域 ID 与 ROOT15 最新 38 项逐项、逐序一致，缺失和新增 ID 均为 0；逐项原需求、旧验证边界与最新欠项已保存到 `MATRIX-38-AUDIT.csv`。旧 `docs/需求实现验证矩阵.md` 的 440 行保留历史，其首行明确指向 ROOT15；下方旧“零商业高楼”等结论不可覆盖当前 v6 五座商业高楼、137 实体商业层的事实，也不可据此宣称参考美术通过。

完整阅读回执：AGENTS 11 行/1726B；提示词 184 行/25038B；开发备忘录 1546 行/448219B。备忘录由此任务树连续阅读 1–700（23 段）和 701–1546（11 段），无覆盖间隙，无原备忘录输出截断。各段原字节 SHA 和源文件 SHA、行数在 `READ-RECEIPT.json`。这是一项团队完整阅读，未声称每个阅读者单独阅读全文。`/workspace/.agents` 存在但空；仓库 `.agents` 不存在，未找到上级 AGENTS。

## 必须保留的合同

- 最新用户动态城市要求覆盖 ENV/HYG/VIR、SHOP、BLD/DIS/INF：环境建筑卫生病毒；停业后居民自愿购买或租赁开新店；拆迁安置与新路；火灾地震。触发由真实意愿、身份和权限驱动，钱、料、时间、劳动、审批、通行与健康后果都属于数值权威。既有经营权买租/旧 edge 修复不能冒整栋土地登记、CityPatch 新拓扑或火震空间破坏。
- 固定十阶段顺序、0.25 秒 Tick、真实单调 businessMinutes、原默认速度/分频预算、身体半径 0.35m/高度 1.72m、0.2m 体素和现场 ACL 均保持。远近降频不改变速度，显示调钟不产生工时。机会是需求倾向，不把日程硬写为固定职业脚本。
- 同一 Simulation/WorldDefinition 服务 3D、2D、文字；表现读取业务状态。未来任意地图和缺建筑/道路/电网诊断仍在 MAP/ADP 全范围，但当前先做子系统。`setFocus` 会写玩家位置，不能作合法移动证明；宿主 tile、相机、直接 body 写入不能冒真实到场。
- 新 factory/ruleset/native/history/reference/meal/service 须显式声明；旧档不能暗升。受信旧配方与原 fingerprint、原完整坏档拒绝、全档/分块逐字和未来 24 原 Tick 的范围必须保持。报价唤醒/权限 helper、type/pure PASS 不替代消费者实际采购和服务。
- 每个结论绑定完整输入图、原 raw、断言、cap、时间和自有 PID 身份。原 FAIL、TIMEOUT_PARTIAL、cancelled、SKIP、INVALID、未安装和 NOT_OBSERVED 保留。不得用重跑或新源补称旧证据存在；34 历史 scope 缺 25 种 path+SHA、旧 `/tmp` 丢失的源码/PNG/raw 都是既有证据缺口。

## 上一阶段可保留的 PASS

当前最新业务图为 `4f1c39d4769b4172f9aed8477b666c480cb1b4be2d7a244d8144d7d1408c9927`，322 输入/80 生产源/119 测试模块。原回执与对应 raw 的 SHA 已直接核对，全同；这次审计没有新运行。

| 范围 | 已发生的结果 | 允许的结论 |
| --- | --- | --- |
| gift 同图候选 | type、22 pure、9 command/14 受控场景 PASS | 2m 接触/支撑/ACL/墙及体素原子守卫和有限扣粮；非自然赠礼、真实医疗或十分钟到期再赠实测 |
| 最新 build01 | PASS，25.40 秒/cap180，322 stable/active[] | 新构建成功；不等新 GPU、Mac 或完整测试 |
| 最新 ui01 | 原35 PASS/errors[]，343.257803 秒/cap900 | 受控 DOM+Simulation 功能；不等普通出生全旅程/Renderer 美术 |
| 最新 education-actual01 | 108step/6人/6料 PASS；原40加唯一 V2 cap11 实付9.870811616545707；全档分块未来24 exact | 声明 compact-world 与既存真实资格来源续演；不等自然全校，旧5a金额10.040936508675475分图保留 |
| 最新 default-day01 | 720step/1440min/speed8 PASS，976.119341 秒/cap1800；616人与玩家活、实际科研本人200；whole/124parts未来24 exact | 一天原守恒/工资/存活/科研及保存合同；steadyState=false，非14日供需财政/全城吃饭/性能 |
| 原312/76购粮 | 14人169/512tick真实消费恢复；23新即时收据与2继承原收据分列 | 原图14人窄结果，不覆盖最新229/其余189移动和37乘车 |
| 原318/78的5a图 | 37组合、build、教育6和原browser11 PASS | 仅该图旧 GPU/规则；不认证后续7e、b5或4f的新 dist |

## 不能升级为 PASS 的状态

- 最新322完整 npm、新 browser、Mac 是 NOT_RUN。原7e完整 none suite 4GB堆 OOM、exit134是真 FAIL；原b5 process隔离仍 cap3600 TIMEOUT_PARTIAL/exit-15，Node权威汇总359 tests/280 pass/0 fail/79 cancelled。零断言失败不抵消取消和未执行78文件；未看到OOM不证明资源问题全部解决。extensions内部35名称没有结果，不能断言某个回调是已确认卡点。
- FOOD-01 当前一天粮产125.52277408365093、零售961=574柜台餐+48携粮后消费+339末携粮；库存16210→15374.522774083653，仍消耗开局粮缓冲。229位 hunger<30 且携粮<1者能负担某个全城现货 offer；`routeReachability=NOT_OBSERVED`，不能称对应路线可达。国库80000→72470.2121876365（-9.412234765454375%），未到期已赚工资与到期欠薪区别保留，steadyStateEstablished=false。
- MED-02 原5a fixture actual03 240正常 main 帧/speed16 FAIL：service-2 target6/20min，spent/received/consumed/servedIds/卫生batch全0；成功后全档分块未来24未运行。虽保616人，该图只有一工坊/11个道路分量，不是默认v6。39次材料35.0515243495被教育6+运维29.0515243495全部消耗；8工人7饥饿0、旧day4工班不能冒day6当前工资。HOST512 PAUSED_NOT_RUN、gift补给方案 CONDITIONAL_NOT_RUN；教育成功不能外推医疗成功。
- SHOP-01/02 tenant私有候选 CLOSED 未安装；pure10/compact4窄PASS不改变 default121.495777秒超cap120 的 TIMED_OUT_PARTIAL。两个连续256步只有 integrity PASS，第三轮困难/choice/job/reopening/ended全 NOT_OBSERVED。原利润、空库存、freeFunds三条件 AND保持，不能调门槛造困难或据未触发认定意愿/路线 bug。
- TRA-03 v7 body、v8 exit/rail等真实 FAIL保持；T14 descriptor/factory/dyadic投影纯PASS与泊位214m走廊只是未启用方案；C14具名物流 consumer未接。投影不证明身体接地或上/下车、hold、fee、FIFO消费者闭环。
- ART-01参考总体 FAIL；Linux SwiftShader功能、旧Worker heartbeat/32完整save等价不证明当前图本机 MZ、Mac、FPS或流畅。原独立rpg2d-v1空间与存档不与旧3D直通。Library当前连接失败/newID0；旧成功版本不能冒当前附件已送达。

## 完整38领域的主要欠项和下一步

38项无删除。未完成仍包括：ENG物理电网/燃料产业，MED完整自然医师患者供料治疗，HYG末端/生活垃圾污水，VIR自然游戏病原来源传播，TEC设备耗材协作知识产业，EDU课程考试/自然多年通学，POL长期自然续任与完整法律治理，ENV生态管网，DIS火震结构救援重建，SHOP自然多轮更替/法定产权破产，BLD土地住户补偿迁居/原子CityPatch新路，TRA具名有限物流与实体上下车，FAM自然一代/照护经济，LIFE厨卫家具及文化心理广度，INF全设施运营迁移，PER真统计卸载/流式恢复，MAP任意地图能力诊断，ADP新受信Worker发行物和完整合法宿主接线，ART参考质量，MAC实机性能。SAVE只对列明scope PASS，长周期容量与任意地图迁移未完；SYS的同核成立不等完整2D产品完成；VAL完整当前全套仍欠。

本轮执行优先保持父任务指示：从 true latest4f终档和229名单，逐人查真实目标/道路和室内路径、等待原因、站点下车、营业窗口、有限钱粮、柜台请求和实际消费恢复；同时记录真实 outflow 与农场/工坊实际付薪生产，不用库存或钱包存在代替成功。先用有界诊断找因果，再独立冻结最窄修复和必要相关检查/保存24；不用一小时完整套件盲跑替代原因调查。随后从合法有限食物补给→工人真实生产材料→真实采购资金→当前日医师/患者20有效分钟→健康结果/耗料/产污→全档分块未来24，建立新的有限医疗组。默认城与断路fixture分列，原240失败组不扩界、不造材料/钱/身份/到场或工时。

本审计只在独占目录写回执，未修改共享文件、运行Simulation/GPU/build/test、外发或发布。
'''
(out/'AUDIT.md').write_text(report)
print(json.dumps({'output':str(out),'matrixCount':len(new),'memoCoverage':len(coverage),'memoBytes':sum(x['bytes'] for x in coverage),'checksAllMatch':all(x['rawMatchesReceipt'] for x in checks),'files':[p.name for p in out.iterdir()]},ensure_ascii=False))
