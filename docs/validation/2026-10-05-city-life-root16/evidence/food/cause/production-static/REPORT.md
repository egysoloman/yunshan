# ROOT16 当前终档食物生产端静态归因

对象为 ROOT15 最终默认新城一天终档，SHA256 `db40c8410ed5cd45f308fb12c12a4ef6678c58add40e3122e595a6bdd99efe16`，tick720/day1/hour8/extension.lastUpdate1920。World 原件 SHA256 `2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512`，本次用冻结源码 savedWorldFingerprint 纯重算得到 `b85fa6ec`，与终档匹配，layout=current-v6。源82文件逐SHA吻合原审计记录。

此处只读JSON及冻结源码，调用纯几何支持/权限 helper，没有构造 Simulation、导入模拟实例、step、world生成、GPU、build、commit或push。完整逐店/逐工人/业主审核字段在 [PRODUCTION-STATIC.json](PRODUCTION-STATIC.json)，全部210店的可筛选汇总在 [SHOPS.csv](SHOPS.csv)，汇总在 [SUMMARY.json](SUMMARY.json)，输入原件与哈希回执见 [RECEIPT.json](RECEIPT.json)。

## 已证实的主要归因

当前31农场全部库存126–160，高于生产目标120；源码每个批次 produced=min(max(0,120-stock),labor/30*energy/100*(1+tech*.12))，故即使有合规真实劳动也不会增加库存。28农场工人饥饿值最低48.4700、平均79.4583，疲劳最低95.8，0睡眠、0低于40饥饿。17农场在这一日累计有9649.463435900012分钟原canonical funded onsite attendance；不能称农场没人劳动，也不能以positive生产分钟替换这些工资劳动。

当前16码头库存84–101.5798，全部仍有生产空间；但10店只保留day0旧计划、6店无计划，全部没有day1有效工时额度。17码头工人饥饿最低52.0119、平均88.3066，疲劳最低95.94，0睡眠、0低于40饥饿。16码头业主现在都不在该店near/workPoint有效位置。此刻主要已知缺口是当前日现场工资计划及真实到场，不是17工人断粮。

当前109市集全部有44–90份现货、全部open。市集没有生产分支；其145工人的38283.56955302965分钟出勤服务于销售等经营活动，不能记作食物生产分钟。末档所有市集库存≥36，当前批次不进入paid local/cargo补货分支，≥4也不进入寄售补货。库存9055是既有有限现货，不是新生产。

| 分类 | 开店/总店 | 员工 | 无员工店 | current-day计划 | old-day计划 | 无计划 | 库存 | 低于40饥饿工人 | sleeping工人 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| farm | 31/31 | 28 | 14 | 2 | 15 | 14 | 4797.000000 | 0 | 0 |
| dock | 16/16 | 17 | 6 | 0 | 10 | 6 | 1522.522774 | 0 | 0 |
| market | 109/109 | 145 | 43 | 5 | 58 | 46 | 9055.000000 | 6 | 0 |
| workshop | 54/54 | 75 | 13 | 0 | 41 | 13 | 4720.993375 | 16 | 0 |

这些计数是终档时点状态，不能代替此前每个零产出批次的原因记录。全部210店open、能量服务门槛通过，未出现当前休店/断电原因；原审计 belowClosureThreshold=0。

## 当前日契约与现场审核

privateShiftAssignment只接受plan.day===floor(extension.lastUpdate/1440)。旧计划姓名可用于下一次排班，但旧工资分钟不能延续成新日额度。registerAttendance只记min(真正到场后分钟、480减attendance、当前私营剩余额度)。shop.open只表明当前营业条件，不能证明员工仍有新劳动契约。

私营业主审核每10分钟尝试一次，只在06:00–17:00；要求本人存在、alive、adult、health≥45、hunger≥40、fatigue≥35、nearBuilding及原实际workPoint权限。审核先于people移动。末档clock1920、nextReviewAt1922，因此1920静态到场不能倒算1912审核已经到场，更不能预报1922必成功。

有day1计划的农场仅两店：

- workshop-b19（farm）：citizen35，1882现场审批480分钟，当前worked0、remaining480；现shopping/eat，hunger98.4。库存137，targetHeadroom0。
- workshop-b22（farm）：1892审批两人合计960分钟；当前worked28.603680282743117、remaining931.3963197172568。citizen255当前shopping/eat、剩480；citizen585当前working/work、剩451.39631971725686、hunger56.8。库存129，targetHeadroom0。

因此两店有真实当前工资契约，并已有28.603680282743117分钟day1工资劳动，食物增产仍被库存目标压为零。

river-b19是重要时间边界：员工/业主citizen33已在真实workPoint、reviewingBusiness/businessReview；hunger56.5000、fatigue96.78、health97.32、现金75.44769406119048，已赚工资债2.5748634074074075，扣运营保留后的审核现金66.2061639871164。旧day0计划worked474，无day1额度；下次审核尚未到期，当前缺day1计划不证明死锁。该店库存155也仍高于目标。

剩余28农场业主静态near/workPoint均未通过；所有16码头业主静态near/workPoint均未通过。码头core-dock-building无员工，其fallback业主citizen17在别处、hunger10.208381703728826，需求与现场均不合格；这不是17码头工人断粮。空店业主是初始化选出的资产/经营负责人，不能误计为该店worker。

市集day1共5店，只有4店有正工时额度：west-b22、summit-b5、east-b5、airport-b8；summit-b8虽有day1计划但employees0/assignments[]/reviews[]，不能算成已授正工资。合计20市集工人有当前正额度，day1实际55.710220456594826分钟，剩5916.2897795434055分钟。west-b22的已承诺148分钟/人中citizen333h8.1201、citizen553h0，均moving/eat；已有契约不证明这些人已到岗。

## 产量观察的准确口径

原审计positive food production=125.52277408365093、附着positive事件分钟=5590.823412700992；农场＋码头canonical funded attendance=15250.286848601004，差9659.463435900012。原observer明确zeroOutputBatchDisposition=NOT_OBSERVED，只在produced>0收到production事件；不能把差值直接称为停产/睡眠/断粮分钟。

在冻结源码的有限库存路径中，农场初始160，production最多增至120；本次trade.stats.suppliedUnits/returnedUnits均0，农场没有其他进货分支，终档全部仍>120。因此从初末库存及源码可推导本原一天农场没有positive增产，全部125.52277408365093食物positive产量归于码头。这是库存路径推导，不是逐个零产出批次观察。码头实际劳动5600.823412700992与positive分钟5590.823412700992尚差10分钟；原证据没有记录这10分钟的批次处置，本次不捏造其停产原因。

原一天食物库16210→15374.522774083653，零售961；库存差精确符合16210＋125.52277408365093−961。农场4960→4797（−163），码头1440→1522.522774083651（增产125.522774减净流出43），市集9810→9055（−755）。初始存货仍高，短期粮食125.5增产不足理论852.923每日需求不能单独证明长期供需稳态，也不能解释229人的具体可达性；餐路/实体移动由主查询独立追踪。

## 工坊交叉诊断（同级医疗复用）

54workshop全部open、存材81–87.84，共4720.993375383235；41旧day0计划＋13无计划，全部无day1私营额度。75工人中16饥饿<40、5h0，0sleeping，疲劳均≥44.5521。54业主当前near/workPoint均不通过，12业主饥饿<40。库存现货与当前劳动再生产应分开；此终档没有“所有工人断粮且材料零库存”的事实，不可复用旧医疗fixture SHA74b488…的7/8工人h0及day6/day4旧档归因。

## 源码定位

- [工资额度与实际出勤](/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/simulation.ts:308)。
- [现真实账户与工资债](/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/simulation.ts:347)。
- [当前日计划失效与私营审核](/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/simulation.ts:357)。
- [业主需求/现场/权限硬门槛](/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/simulation.ts:381)。
- [reviewingBusiness选择](/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/simulation.ts:1419)。
- [需求衰减/携粮自动吃](/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/simulation.ts:1660)。
- [睡眠时段与已承诺工作条件](/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/simulation.ts:1711)。
- [真实工作点到场与工作/休息状态](/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/simulation.ts:1750)。
- [open/能量与批次消费labor](/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/simulation.ts:1859)。
- [库存120生产目标及只发positive事件](/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/simulation.ts:1884)。
- [near及floorSupport纯几何规则](/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/simulation.ts:2096)。
- [实际工作点与楼层ACL](/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/simulation.ts:2132)。
- [原observer不是每个零产出批次](/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/scripts/economy-observations.ts:22)。
- [寄售归还唯一可能农场进货路径](/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/simulation/trade.ts:217)。

## 全部农场及码头逐店表

H是业主饥饿值；“未现场”指当前纯几何near/workPoint失败，不推断原因是门/墙/道路。工人状态及全部原计划assignment、review时间、cash/debt/remaining见JSON。

| shop（去shop前缀） | 类别 | 库存/目标余量 | 员工 | 计划（年龄天） | 现剩分钟 | 原一天出勤分钟 | 业主H | 业主状态/意图 | 现审核失败项 |
|---|---|---:|---:|---|---:|---:|---:|---|---|
| river-b0 | dock | 99.1599/20.8401 | 3 | day0（1） | 0.0000 | 678.0000 | 57.1000 | moving/eat | near,workPoint |
| river-b3 | farm | 160.0000/0.0000 | 0 | 无 | 0.0000 | 0.0000 | 98.7000 | moving/businessReview | near,workPoint |
| river-b6 | farm | 160.0000/0.0000 | 0 | 无 | 0.0000 | 0.0000 | 98.7000 | moving/businessReview | near,workPoint |
| river-b7 | dock | 90.0000/30.0000 | 0 | 无 | 0.0000 | 0.0000 | 98.7000 | moving/businessReview | near,workPoint |
| river-b9 | farm | 156.0000/0.0000 | 2 | day0（1） | 0.0000 | 508.0000 | 98.7000 | moving/businessReview | near,workPoint |
| river-b10 | dock | 90.0000/30.0000 | 0 | 无 | 0.0000 | 0.0000 | 98.7000 | moving/businessReview | near,workPoint |
| river-b12 | farm | 154.0000/0.0000 | 3 | day0（1） | 0.0000 | 648.0000 | 99.1000 | shopping/eat | near,workPoint |
| river-b13 | dock | 98.1202/21.8798 | 1 | day0（1） | 0.0000 | 450.0000 | 99.8000 | shopping/eat | near,workPoint |
| river-b16 | dock | 84.0000/36.0000 | 0 | 无 | 0.0000 | 0.0000 | 98.7000 | moving/businessReview | near,workPoint |
| river-b19 | farm | 155.0000/0.0000 | 1 | day0（1） | 0.0000 | 474.0000 | 56.5000 | reviewingBusiness/businessReview | 全通过 |
| river-b22 | farm | 160.0000/0.0000 | 0 | 无 | 0.0000 | 0.0000 | 98.7000 | moving/businessReview | near,workPoint |
| river-b23 | dock | 98.3479/21.6521 | 2 | day0（1） | 0.0000 | 772.4150 | 52.0119 | moving/businessReview | near,workPoint |
| river-b25 | farm | 160.0000/0.0000 | 0 | 无 | 0.0000 | 0.0000 | 98.7000 | moving/businessReview | near,workPoint |
| river-b26 | dock | 101.5798/18.4202 | 2 | day0（1） | 0.0000 | 652.0000 | 58.5000 | moving/businessReview | near,workPoint |
| river-b28 | farm | 153.0000/0.0000 | 4 | day0（1） | 0.0000 | 845.0000 | 98.4000 | moving/businessReview | near,workPoint |
| river-b29 | dock | 98.3775/21.6225 | 2 | day0（1） | 0.0000 | 512.0000 | 98.4000 | moving/businessReview | near,workPoint |
| river-b32 | dock | 90.0000/30.0000 | 0 | 无 | 0.0000 | 0.0000 | 98.7000 | moving/businessReview | near,workPoint |
| river-b35 | farm | 158.0000/0.0000 | 1 | day0（1） | 0.0000 | 430.0000 | 56.5000 | moving/businessReview | near,workPoint |
| river-b38 | farm | 158.0000/0.0000 | 1 | day0（1） | 0.0000 | 446.0000 | 99.1000 | shopping/eat | near,workPoint |
| river-b39 | dock | 98.7663/21.2337 | 1 | day0（1） | 0.0000 | 480.0000 | 99.0000 | shopping/eat | near,workPoint |
| river-b41 | farm | 158.0000/0.0000 | 1 | day0（1） | 0.0000 | 436.0000 | 48.4700 | moving/businessReview | near,workPoint |
| river-b42 | dock | 90.0000/30.0000 | 0 | 无 | 0.0000 | 0.0000 | 98.7000 | moving/businessReview | near,workPoint |
| river-b44 | farm | 156.0000/0.0000 | 2 | day0（1） | 0.0000 | 426.0000 | 57.6000 | moving/businessReview | near,workPoint |
| river-b45 | dock | 98.1202/21.8798 | 1 | day0（1） | 0.0000 | 450.0000 | 97.9000 | shopping/eat | near,workPoint |
| river-b48 | dock | 98.0867/21.9133 | 2 | day0（1） | 0.0000 | 546.0000 | 98.6000 | shopping/eat | near,workPoint |
| river-b51 | farm | 160.0000/0.0000 | 0 | 无 | 0.0000 | 0.0000 | 98.7000 | moving/businessReview | near,workPoint |
| river-b54 | farm | 157.0000/0.0000 | 2 | day0（1） | 0.0000 | 750.0208 | 99.2000 | shopping/eat | near,workPoint |
| river-b55 | dock | 100.9738/19.0262 | 2 | day0（1） | 0.0000 | 662.4084 | 98.8000 | shopping/eat | near,workPoint |
| river-b57 | farm | 160.0000/0.0000 | 0 | 无 | 0.0000 | 0.0000 | 98.7000 | moving/businessReview | near,workPoint |
| river-b58 | dock | 96.9904/23.0096 | 1 | day0（1） | 0.0000 | 398.0000 | 98.8000 | shopping/eat | near,workPoint |
| workshop-b3 | farm | 158.0000/0.0000 | 1 | day0（1） | 0.0000 | 464.0000 | 98.8000 | moving/businessReview | near,workPoint |
| workshop-b6 | farm | 158.0000/0.0000 | 1 | day0（1） | 0.0000 | 424.0000 | 100.0000 | shopping/eat | near,workPoint |
| workshop-b9 | farm | 126.0000/0.0000 | 1 | day0（1） | 0.0000 | 456.0000 | 55.1927 | moving/eat | near,workPoint |
| workshop-b12 | farm | 130.0000/0.0000 | 2 | day0（1） | 0.0000 | 792.8667 | 56.8000 | moving/eat | near,workPoint |
| workshop-b19 | farm | 137.0000/0.0000 | 1 | day1（0） | 480.0000 | 480.0000 | 98.4000 | shopping/eat | 全通过 |
| workshop-b22 | farm | 129.0000/0.0000 | 2 | day1（0） | 931.3963 | 876.4507 | 98.8000 | shopping/eat | 全通过 |
| workshop-b25 | farm | 160.0000/0.0000 | 0 | 无 | 0.0000 | 0.0000 | 55.1927 | moving/eat | near,workPoint |
| workshop-b28 | farm | 160.0000/0.0000 | 0 | 无 | 0.0000 | 0.0000 | 55.1927 | moving/eat | near,workPoint |
| workshop-b35 | farm | 156.0000/0.0000 | 2 | day0（1） | 0.0000 | 793.1252 | 98.0000 | shopping/eat | near,workPoint |
| workshop-b38 | farm | 160.0000/0.0000 | 0 | 无 | 0.0000 | 0.0000 | 55.1927 | moving/eat | near,workPoint |
| workshop-b41 | farm | 160.0000/0.0000 | 0 | 无 | 0.0000 | 0.0000 | 55.1927 | moving/eat | near,workPoint |
| workshop-b44 | farm | 158.0000/0.0000 | 1 | day0（1） | 0.0000 | 400.0000 | 56.8000 | moving/businessReview | near,workPoint |
| workshop-b51 | farm | 160.0000/0.0000 | 0 | 无 | 0.0000 | 0.0000 | 55.1927 | moving/eat | near,workPoint |
| workshop-b54 | farm | 160.0000/0.0000 | 0 | 无 | 0.0000 | 0.0000 | 55.1927 | moving/eat | near,workPoint |
| workshop-b57 | farm | 160.0000/0.0000 | 0 | 无 | 0.0000 | 0.0000 | 55.1927 | moving/eat | near,workPoint |
| workshop-b60 | farm | 160.0000/0.0000 | 0 | 无 | 0.0000 | 0.0000 | 55.1927 | moving/eat | near,workPoint |
| core-dock-building | dock | 90.0000/30.0000 | 0 | 无 | 0.0000 | 0.0000 | 10.2084 | moving/eat | hunger,near,workPoint |

109市集逐店的库存、员工、计划日龄、工人需求、真实状态、现场支持、业主审核、历史出勤与完整cash/debt见SHOPS.csv及PRODUCTION-STATIC.json；市集统一没有production分支，因此不套farm/dock的120生产目标。

尚未执行任何终档续演；下一时段审核、229饥饿者实际餐路和各零输出批次历史原因均不由此静态报告冒充观察。没有剩余工具/输入阻碍，本子诊断在只读范围内完成。
