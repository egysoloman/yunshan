# ROOT16：权威日末229人食物链只读因果诊断

权威输入是ROOT15当前默认新城真正日末存档，3242191字节，SHA `db40c8410ed5cd45f308fb12c12a4ef6678c58add40e3122e595a6bdd99efe16`，tick720/day1/08:00/clock1920。源码322输入/80src，图 `4f1c39d4769b4172f9aed8477b666c480cb1b4be2d7a244d8144d7d1408c9927`。复用既有current-v6保存World，SHA `2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512`，原源码重算fingerprint仍为`b85fa6ec`。没有createWorld、Simulation constructor、step、命令、needs/cash/clock/body改写、build或GPU。唯一Native helper constructor服务独立纯路由缓存，不是Simulation构造。

## 当前终态的精确结论

原foodSnapshot的alive且hunger<30、food<1筛出229人：193moving、36riding，全部runtime.activity=eat；69hunger0；当前physicalWaiting0。所有229当前目标食店仍营业、库存≥1、个人钱包可支付，原寄售报价/供应方净额/经营账户容量及零售计数等非到场条件也静态通过。但229均不是shopping、无当前customer请求、无合法sale点身体，因此这里看到的是尚未到柜台，未观察到“已到柜台却因现金或缺粮失败”。这不证明未来购买必成。

193步行者当前剩余reference3D路线19.2976–2388.3215米，中位1418.1873米；按晴天原4.2米/游戏分钟，中位337.6636分钟、最大568.648分钟。154人的当前参考走完时间长于其hunger按.05/min降至零时间；0人的当前参考估计超过同日该店营业窗。路线时间不含未来天气、改路、乘车、实体拒绝、排队或未来库存变化，不是实际到达时间。

全674开放road/bridge节点为一个图component，156食店374地面sale点door→sale纯规划存在，native descriptor未见block；229当前下一腿全部legacy且whole-segment road/body守卫通过。这只是当前腿与图/柜台局部规划证据，不能扩展成整条街路未来clear。5个当前anchorless（4/92/180/224/312）全部在同一真实载具上去academy-station；车辆身体不能当行人出发点。全部36 rider的已具名stop clone都有可达图食品候选，末态2 rider.arrived=true，尚需未来people处理；没有在查询里让他们下车。

## 定时承诺与服务分布

当前mealRoutePolicy=nearby-food-v1，53人的原decisionAt已到期，所以原eat基础条件229成立并不等于229永久保留目的店：176当前仍受吃饭承诺，53待未来真实people重评。纯fresh choice有19与现目标不同（14moving/5riding），其中7已经到期：61/237/505/549步行和180/224/312乘车。后5纯fresh rest反映车辆位置缺行人anchor，不是永久不可达结论。

食店按World参数分布：river45、market38、west19、east19、workshop16、airport12、summit6、core1；academy/government/starport为0。这三区共有163位原饥饿居民（54/54/55），core另51。193moving的最近eligible图食店门距离中位1403.114米，只有4人<200米。因此本终态的长路不能全部归于19个尚未换的新目标，也不支持硬编码某城ID或改随机评分作为修复。

## 生产端独立链

详见[逐店生产报告](production-static/REPORT.md)、[210店CSV](production-static/SHOPS.csv)及[具名工人原件](production-static/PRODUCTION-STATIC.json)。31farm库存126–160全高于原target120；即使当前有合规劳动仍无目标余量。28farm及17dock工人全部hunger≥40、无sleeping，不能套用旧医疗fixture7/8工人断粮原因。farm当前2日1计划/3有效allowance工人、已credited28.60368；其余旧或无计划。dock16店全无day1 allowance且owner全不在workpoint；是当前日现场工资审批/到场限制。river-b19本人已在workpoint，nextReview1922而末态1920，旧计划不证明未来死锁。

原一天food正产125.522774全部归于dock（农场初末>120且无其他进货/返回路径的源码库存推导）；农场真实9649.4634359有薪到场分钟，不能称无人劳动。food正产事件附5590.8234127分钟，农场+dock实际funded attendance15250.2868486；其中剩余10 dock分钟的零批次处置原observer没有记录，仍NOT_OBSERVED。109market既有库存44–90，销售和有限货转移不能算生产。默认终档54workshop0当前日私营额度、owner全部未在workpoint，16/75工人h<40；与旧医疗fixture不同。

## Root真实128续跑与livelock检查

本child没有执行Sim；这里只读root独占原件。root真实128原quartertick（256游戏分钟）PASS_DIAGNOSTIC：70/229不同原目标已取得119本人柜台收据、body拒绝0、实际新产food39.553405193、现金最大残差4.6566e-10/食物3.8938e-12，终档`ac47bc4c4e43f36e755fa6b9f3447107d6cc75506d90c2aebbe0ab63105b3cc8`。余159=158moving+1riding，全eat、114h0，剩路中位383.4072/最大1596.3485米。不能把70成餐写成229恢复。

对root994真实choose记录进行独立JSON分析：42目标/活动变化、37人；eat→eat换店28，含20 east-b50→east-b37、4 west-b54→west-b41、3 west-b22→west-b54、1 west-b22→west-b41。每人压缩连续同目标后，0 A→B→A回路；其余转work/review/rest均已shopping到场之后。该有限窗没有明显livelock；不证明未来永不循环。具名变化链和原件SHA在[BASELINE128-DECISION-ANALYSIS.json](BASELINE128-DECISION-ANALYSIS.json)。

最小真实续跑观察保持root实际流程：复用真实World、import exact原terminal、完整export立即等字节，原speed8/focus/mode/policy/钱粮身体不改，每步sim.step(.25)核十阶段、2游戏分钟、现金/食物守恒。transparent wrapper对原choose/guard/quote每次只调用原实现一次；保真实客户/售前售后/税/携粮消费事件。128窗后余route最大约380.083游戏分钟，root计划NEW256原tick/cap600有界覆盖这段并允许原decision/tier处理；达到全部229具名真实收据及恢复才可称目标完成，超界仍保terminal和剩余ID而不预填PASS。


## Root后续真实全部229恢复

root NEWall229-continuation01从真实ac47继续256原quarterticks（另512游戏分钟），实际PASS_ALL229_COUNTER_RECOVERY。该新scope的394本人target收据与上一段119原收据独立保留；两段累计原229每人都有真实柜台采购和恢复，末档`edf73ed2aa923b16248f3981092ea78dfe6375e5be1a4d4e3c6914ca84285754`、616alive、hungryWithoutCarriedFood0。新scope实际food50.796884544、counterMeals688、carriedMeals69、body拒绝0、最大现金残差1.6298e-9/食物4.2633e-12。最新clock2688/day1/20:48，farm/dock按原20:00规则已关、market109仍开。

这个有限实际结果证实原229通路恢复，说明初始无本地食店和长路产生延迟；它不把163人永久标为不可达，不证明将来新饥饿或长期供给/财政稳态。root的full/partition未来24由root独立运行，child没有用本纯查询替代续档验收。

## 可交付只读观察候选

独立candidate/source复制原322并逐SHA保留，仅新增`src/simulation/food-access-observations.ts`、`scripts/food-access-audit.ts`和5组纯测试；325输入/81src图`20507b18e01cef12288107b06769dd3baf8e8d8442436c725d5385a8a26b8e0b`。private patch SHA`efbf3c2e305af00d769c5688959b5c09dbd3bc988890c20ab18de22c2154ed70`，[patch](candidate/FOOD-ACCESS-OBSERVATIONS.patch)和[具名文件SHA/全部回执](candidate/CANDIDATE-RECEIPT.json)已交root审查安装；child没有应用到shared，也没有修改旧frozen source。

纯module只用World/state/runtime参数，不固定城市ID/229名单；同foodSnapshot精确hunger<30/food<1/alive切分，逐district食店与openStocked供给、h0、具名actor活动/decision/queue、3D余程、晴/雨4.2/3.1米每分钟参考、rider具名stop/NOT_ESTIMATED、原6–20或6–22营业窗。所有参考都显式排除未来天气、交通、replan、ACL、身体碰撞、队列/库存变化；routeReachability始终NOT_OBSERVED，queue请求与shopping不冒真实成交。

CLI读实际World和native save，核seed/fingerprint，routePool只在JSON解析副本解码，source inputs及两原文件SHA前后不变；不createWorld/Simulation/step/command，不改原clock/body/money/food。`--out`必须NEW目录，复制原bytes并用wx写报告/输入SHA/回执；既有out实际拒绝，原5份输出文件逐SHA不变。

实际type01 11.0556秒PASS；pure-tests01 .6671秒5/5PASS；cli-original01 6.5990秒PASS（原db40再现229/69h0/193moving36riding）；cli-recovered01 5.8507秒PASS（真edf hungry0）；cli-nooverwrite01 .3511秒PASS_EXPECTED_REJECTION。全部scope预设cap120、325首尾稳定、ownedActive[]、0Sim/GPU/build。NaN、3D路线、乘车NOT_ESTIMATED、两个不同参数世界、阈值与foodSnapshot同state、深冻结输入及输出不回写都已纯测试。不同参数可接收不代表任意地图/真实路径全面适配。

例：在已安装源码根运行`node --import tsx scripts/food-access-audit.ts --world /path/WORLD.json --save /path/terminal.save.json --out /path/NEW-observation-directory`；原CLI没有npm脚本或产品UI新增入口，不改变日常模拟。


## Root审查后的NEWcandidate02（最新待安装原件）

root发现原observer对找不到building的shop仅忽略，可能把坏引用隐藏成无food设施；原实际db40/edf没有这种坏引用，本缺口由新参数纯测试覆盖。原candidate325源码、patch与各phase逐SHA保持不变，修正只在NEWcandidate02：全部shop具名输出`unresolvedShopBuildingReferences`与`shopBuildingDistrictMismatches`，仍按原shop.districtId分桶并注明source；affected district优先INCOMPLETE/INCONSISTENT标签，不能以已知foodShopCount0认证无设施。没有自动修World、推断未知kind或改业务/缺字段默认。任意state计数用null-prototype对象，避免constructor/__proto__等计数冲突。

最新[candidate02 patch](candidate02/FOOD-ACCESS-OBSERVATIONS.patch)35194字节/SHA`329e6deb35d4b60e1153e33b2a5c4f3ca19c1eb921687a4190f3853d2782681f`；325/81图`0c7aea22807f69ac83450ecd201d5ee6e933dff816e937cf18b0728e97d7a0da`。[最新receipt](candidate02/CANDIDATE-RECEIPT.json)含3fileSHA/全部实际回执与两真CLI读数；旧5tests完整前缀保留，新增引用/分区完整性和任意state计数2case，共7/7纯PASS（.7176秒），types10.1352秒PASS。CLI字节仍`3e4a18a8d3ef4a7c16156509c157e6c45018e9526599f9599ea67c9d1af65a28`；最新两真实CLI3.1653/3.5297秒PASS，db40仍229、edf仍0，全部shop缺引用/跨区不一致均0，原3无食店分区保持真实参数结果。每scope原cap120/325stable/ownedActive[]、0Sim/GPU/build。git apply --check shared仅检查PASS；child未apply。最新patch已交root自行审查安装，旧candidate不是最新推荐安装对象。

## 只读query实际回执与边界

pure-query02实际00:05:48.810368→00:06:06.151566 UTC，17.341秒/cap120、exit0/PASS、322首尾稳定、ownedActive[]，rawSHA`fded56534fbe57062f4f89fc6381f4d36637a7c13a38541a7a2cbb5661788517`。解析后的state/runtime、World JSON及原save/world字节全部未变；routePool只在解析副本解码。[229具名JSON](pure-query02/artifacts/RESIDENTS-229.json)、[居民CSV](pure-query02/artifacts/RESIDENTS-229.csv)、[35724逐人逐店offer CSV](pure-query02/artifacts/OFFERS-ALL.csv)、[QUERY-SUMMARY](pure-query02/artifacts/QUERY-SUMMARY.json)、[receipt](pure-query02/run/receipt.json)可审查。

pure-query01因外部.mts绝对extensionless Simulation导入被Node当目录拒绝，0Simulation/0step；显式.ts修正留NEWquery-v2/scope02，原FAIL/raw未覆盖。生产端纯helper只有独立缓存/几何查询。read-only观测完成不代替全38域、长期财政/产能、自然医疗、美术或Mac验收。本child未commit/push。
