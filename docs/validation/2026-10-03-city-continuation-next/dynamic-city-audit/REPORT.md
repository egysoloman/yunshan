# 动态城市范围只读审计 · 2026-10-04

本次按实际 `/workspace/yunshan` 脏工作树抓取90个源/测试/配置/需求原件，Git HEAD为 `3ca77b861bc8a2c33820b49396ad788e7d94e137`。原件、字节数与SHA见 `source-manifest.before.json`；完整319460字节备忘录及其逐段原文索引一并保留。AGENTS要求保全部目标和失败；未找到适用的本地 `.agents/SKILL.md`。最新用户补充优先于旧提示词和旧阶段文本。本报告只核查源码生产路径，不运行模拟/测试/构建/GPU，不改共享源码、需求文档或用户数据，不新增钱、库存、身份或位置。STATIC_PRESENT表示实际源码链路存在，不是本轮运行PASS，也不代表全城自然长期服务覆盖。

已经有真实的有限“会变化”路径：居民受封路阻断可提交具名维修申请；合资格居民能走普通路线接手停业店铺、真实买/租、本人筹资及修缮；诊疗消费确实产生用品废物，新卫生链能由认证工资医生自主提出消毒需求并经有限双官审批、采购与劳动封存；供电设备有山洪损失和有限维修。建筑/土地拆迁与新路拓扑、火灾和地震空间损毁疏散仍没有生产闭环，不能用店铺经营权、方块拆除、公司等级或山洪消息替代。

| 领域 | 实际生产路径（静态核实） | 状态 | 仍缺 | 验收因果边界 | 原源入口 |
| --- | --- | --- | --- | --- | --- |
| 居民需求与身份 | core.people机会评分→普通路线→实际到场，culture居民health/education请愿；road canonical阻路；hygiene医生实薪观察 | STATIC_PRESENT | 不是所有领域的通用居民提案制度；道路需求只捕获关闭瞬间的原成年moving行程，教育/卫生还受原服务资源约束 | 不给身份/钱/位置；原普通行程到場后产生具名请求；无资格/未到场拒绝；资源不足等待并保原档 | src/simulation.ts:1205；src/simulation.ts:1443；src/simulation/culture.ts:107；src/simulation/road-demands.ts:119；src/simulation/hygiene-public.ts:40 |
| 商店停业与居民意愿 | shopLifecycleOpportunities→shop-lifecycle-arrived→suspend/list；profit≤-600+无货+未保护经营金不足才economic-distress | STATIC_PRESENT | 公司排除；夜间/断电关门不是永久倒闭；不是法定公司破产清算 | 原持有人现场同意；无同意挂牌/夜闭不得夺权；旧库存工资债和寄售货权保留 | src/simulation/shop_lifecycle.ts:135；src/simulation/shop_lifecycle.ts:299；src/simulation/shop_lifecycle.ts:335 |
| 居民买租重开 | 同一acquire入口：买价/首租给原卖方，50备案费进公库，≥200本人资本进原店，100生活储备，押金托管；restart有限材料+食物+员工原授权工资60分钟 | STATIC_PRESENT | 仅private market且非facility/非company、同址经营资产；供应结算无新物流实体，不冒实际材料运送；不改变商品类别/建筑kind/外墙店招 | 普通NPC路线/现场成交；供料/工资/余额不足原子拒绝；租金/押金/垫款/旧债守恒；立即+24/分块 | src/simulation/shop_lifecycle.ts:164；src/simulation/shop_lifecycle.ts:191；src/simulation/shop_lifecycle.ts:318；src/simulation.ts:395 |
| 产权与住宅占用 | 现shop title明确existing-business-and-site-use；player rent80公共首期/homeId；family容量/通勤/双方现场搬家与经营遗产买卖 | PARTIAL | 没有房屋土地登记簿、独立房东建筑租约、租户拆迁同意/补偿/临迁/安置，不能把经营资产或homeId当楼地所有权 | 逐权利人、租户与占用人保留真实债权和住所；施工前实际安置，不传送、不裸改owner | src/simulation/shop_lifecycle.ts:27；src/simulation.ts:1909；src/simulation/family.ts:219；src/simulation/family.ts:309 |
| 体素建造与楼体拆迁 | build/demolish只增删player自己放置的0.2m voxels，权限/4m/材料/4096限制 | PARTIAL | 不删除既有墙/楼/地形，不移Building/NPC住所/租约/订单；没有承载/许可/拆迁实薪工程 | 原墙楼拆除应先权利/占用/订单校验，材料回收与实际劳动；失败原子拒绝；旧图旧档不改写 | src/simulation.ts:2032 |
| 真实封路与改道 | extensions雨天山洪canonical事件→roads河80m内原一条road/bridge关闭；移动/图路由/控制器共享拦截，原在途单向退出许可 | STATIC_PRESENT | 基于山洪事件与距离挑一条现有路，不是水位淹没空间场；无通用身份命令任意封路/交通事故清障 | 源事件可追；假事件/干路/异层/重复拒绝；保存未走完退出许可、道路revision、目的地与绕行 | src/simulation/extensions.ts:249；src/roads.ts:142；src/roads.ts:182；src/simulation.ts:634 |
| 居民道路维修 | core捕获原行程+确无合法detour→roadDemand→roadworks.public；双官40或player100，原工人真实供应售点领1材料、携运、60分钟按合同gross/net/tax工资→completeRoadRepair | STATIC_PRESENT | 128需求/128工单/64closure有限；缺替补/留置材料再取；不是新道路建设或拆除拓扑 | 原材料/工资/税/托管守恒；未到场/预算不够/无供应拒绝；新工单未来续演/分块保持完整 | src/simulation.ts:634；src/simulation/road-demands.ts:83；src/simulation/road-demands.ts:119；src/simulation/roadworks.ts:251；src/roads.ts:229 |
| 道路新建与拆除 | 只存在原edges的closure/reopen overlay；Simulation构造固化maps/neighbors/fingerprint，storage只trusted recipe匹配 | MISSING_PRODUCTION_PATH | 没有CityPatch/规划许可/征地/真实新节点边/占用迁移/路线和缓存原子revision；不能直接world.edges.push或更换旧fingerprint | newroad坡度/净空/门接路/洪水/产权/预算料工检查；全部派生索引/路线/渲染同代；旧save完整兼容 | src/simulation.ts:131；src/roads.ts:229；src/persistence/world-layout.ts:48 |
| 供电资源与设施 | power central legacy-city-bus aggregate P分配building/vehicle meter，山洪core区设备持久损失，双官预算/工业材料1/已计薪技术员60min修5P | PARTIAL | 没有物理输配电图、变电/线路容量/孤岛/负荷优先与新接线施工；powerBinding硬编码core-main/core-energy-south，换城不可承诺通用 | 以实际供给/需求/损失/修复守恒；无料工资现场不能恢复；地图诊断须识别真实source/operator缺失 | src/simulation/power.ts:31；src/simulation/power.ts:60；src/simulation/power.ts:157；src/simulation/power.ts:275 |
| 用品废物与自主公共消毒 | 新paid/public care真1unit耗用→批次来源；认证医生工资剩余/原station观察→具名公共需求→同区双官20预算→整工业材料→剩余10min→sealed+cleaningResidual | STATIC_PRESENT | 只诊所用后材料；8unit容器与64需求保护；封存后原物2unit仍存，不是清运或最终处置；无城市生活垃圾/污水/垃圾车/处置设施 | 原来源/预算/整料/认证工资/相位联合容量；旧耗用不回填；无料/钱/工资/供电保物等待；ghostbudget/伪回执拒绝 | src/simulation/hygiene.ts:155；src/simulation/hygiene.ts:187；src/simulation/hygiene.ts:224；src/simulation/hygiene-public.ts:40；src/simulation/hygiene-public.ts:65；src/simulation/hygiene-public.ts:81 |
| 病毒传播与症状 | YV1显式controlled-validation种源→传染期诊疗污染批次→真实卫生接触window累积dose→潜伏/症状/恢复/免疫；真实临床或公共护理仅症状缓解 | PARTIAL_CONTROLLED_SOURCE | 没有默认自然输入、游客入城病例、空间空气/食物/饮水/一般居民接触传播；无药物物流、化验/隔离制度；不能把航空/低水质当病原来源 | 来源/接触/剂量/防护/免疫/真实劳动均保存可追；假接触/重复/无源拒绝；自然病原须先单独来源合同 | src/simulation/pathology.ts:7；src/simulation/pathology.ts:84；src/simulation/pathology.ts:99；src/simulation/pathology.ts:125 |
| 环境与水生态 | district pollution与extensions waterQuality/biodiversity/stormRisk聚合，健康与供能/风雨/洪灾反馈 | PARTIAL_AGGREGATE | 没有污染源排放物流/空间扩散、污水管网/净水设施/真实水量水位/物种生态链/地质演变；聚合指标不等城市环境设施完整 | 参数变化有源与下游行为约束；污水/垃圾设施必须先真实物质收支与空间覆盖，不按UI数值冒设施运行 | src/simulation/extensions.ts:249；src/simulation/extensions.ts:294；src/simulation/power.ts:180 |
| 火灾 | 未找到fire/arson/fireDamage/fireService生产事件或结构状态 | MISSING_PRODUCTION_PATH | 无燃料点火/蔓延/结构损伤/疏散/消防职务/交通管制/灭火供水/重建合同；敌对标签不等纵火已实现 | 实际触发与物理区位→人员合法撤离→有限救援资源/工资→损毁资产和索赔→重建，同档/24/分块 | src/types.ts:43；src/types.ts:44；src/simulation/extensions.ts:249 |
| 地震 | 未找到earthquake/seismic/structuralDamage/collapse/evacuation生产链 | MISSING_PRODUCTION_PATH | 无地震参数/损毁/承载/建筑禁入/道路破坏/避难/安置/修复，不能复用山洪消息冒称地震 | 明确震源/强度→实际结构与路段/供电后果→安全退出/安置→有限审批料工修复，保损毁历史 | src/types.ts:43；src/simulation/extensions.ts:249 |
| 表现与地图兼容 | Simulation(WorldDefinition)与纯状态事件运行不依赖renderer；示意图/UI读取权威roadNetwork/power/hygiene；持久化只可信recipe | PARTIAL | 另城市要匹配真实功能点/角色/资源和模块binding；自定义/真实地图注册、能力诊断、动态worldpatch存档契约未实现 | 不同合法参数世界同规则能运行；缺能力明确unsupported并保旧规则；通用参数并不等无条件任意地图/动态拓扑可用 | src/simulation.ts:98；src/persistence/world-layout.ts:48；src/simulation/power.ts:60 |

## 旧验证范围与本次证据口径

备忘录顶部候选检查点与旧矩阵部分表项未同步到当前脏源码：有“卫生正在修/道路封闭未实现/只读方案”的历史文字，而本次实际存在 roadNetwork/road-demands/roadworks 与认证工资 hygiene-public 链。以当前逐字源码与各原实际scope判定；不能把旧段中的 RUNNING 改成新PASS，也不相加不同epoch计数。原ROOT05终局为614/616居民存活、玩家死亡、财政下降78.812%、未稳态；full为TIMEOUT_PARTIAL/702顶层PASS/6FAIL/4SKIP，没有runner全套总表。这些原失败不在此审计中重跑或改写。

`tests/road-demands.test.ts`含具名受阻、干路绕行、无旅程/伪因果拒绝、双官40/实际carry/60工时等用例；`roadworks.test.ts`含partial取消与载料工人死亡保物保薪；`shop-lifecycle.test.ts`/`shop-self-funding.test.ts`有合法卖方/居民路线/买租/资金源/欠薪寄售/有限材料/60分钟与原子坏档；`public-disinfection.test.ts`有24个具名来源/未到场/实薪前段/无物料/公共保护/伪造重放/旧档与联合容量正负例。它们是现存用例覆盖，不是本次重新PASS。前卫生独立候选24PASS、相关78PASS+2SKIP、build0和真实reader24/partition均只属于原冻结候选，父合入其它模块后的整棵脏共享仍需统一绑定新scope。

## 可接续的一个有界实现：既有灾损工单替补与留置材料接续

原 `roadworks.ts:310–315` 会在原worker死亡时cancel并保留已买材料，`dropMaterial:148–156`把携料落在真实脚点且retained；现有 `roadworkTask:136–146`不提供retained物料pickup；`road-demands.ts:133–138`只在repairId=null重试，因此原已关联取消订单不会自动建立新的履约路径。这是源码静态断链，不冒本次真实负例。失能工人暂停，但无替补制度。旧validator又把采购人及全部labor receipt.actorId绑定唯一job.workerId（roadworks:383/392），所以简单换workerId或repairId=null会损坏历史合同，不能采用。

下一候选只处理原现有闭路、原repairId、原预算和已购买材料：新增明确有版本的crew/交接记录，保留每个原合同与工资；死亡/失能后合法释放未赚分钟，有限原资金不足则等待，不发新钱、不挪其他预算。原材料仍保原owner/source/原落点，替补者必须沿开放道路真实到pickup点领取并实际搬至worksite，领取后才可消费未完成的60分钟；取消退款未清仍保escrow/债，不返造供应库存。原终局cancelled旧档不被读档改造成未取消工单；另需明确旧档兼容合同。

所有后续实现仅隔离workspace：拟独占 `src/simulation/roadworks.ts` 与新 `tests/roadwork-replacement.test.ts`，旧相关测试只用原字节回归；若原stage/路线需要窄适配，先给父 `src/simulation.ts` 独立hunk，不替换其police/education/geometry组合；不碰architecture/culture/family/world/render。先做同输入真实死亡/失能后的断链负例与有资格/预算材料正例，再无资格、现金不足、原料不在现场、双重pickup、伪交接、坏档原子拒绝以及立即+24/分块完整保存。新候选不阻塞父ROOT07冻结，任何实际结果另版本原件留存。

动态楼房拆迁/新路后续必须另建权利和占用合同、CityPatch/同代world、缓存/路由/渲染/保存重建契约；本候选不承担新拓扑，也不通过直接修改immutable world冒地图改造完成。

本代理本批没有Library上传、commit/push；父会话统一办理。无本任务启动的生产进程。目录路径是供父接续的本地原件入口，不能冒称用户附件已送达。

## 收口时共享变更观察（保留两版，不冒输入稳定）

审计抓取于00:02:58后，父继续正常实现。00:11:22逐90项只读检查发现6项变化：备忘录、矩阵、architecture-floor-plan、commercial-district、world-layout、types。完整变更路径和前后SHA见 source-manifest.after.json；实际新字节另存 after-snapshot/，统一diff存 shared-deltas/，未覆盖最初原件。最后4源码仅商业楼梯压缩采样的明确route revision/指纹与声明，本报告所核core/roadworks/road-demands/shop/power/hygiene/pathology/culture源未变；不据此称父新商业路线已PASS。

实际读到父00:04新检查点：候选已接合，ROOT06 211输入 build0；系统联跑121注册=117PASS/1FAIL/3SKIP，失败是教材第二采购夹具前提未复现；商楼1148路径被1024保存上限拒，ROOT07正在窄修绑定新指纹。该阶段没有14日/DOM/WebGL。新矩阵已把本次动态范围标为正在只读重审，旧“未合入”等段保持历史记录。本报告没有重跑、相加或覆盖上述原范围。
