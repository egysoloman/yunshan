# 默认城市 food choice 静态证据（ROOT14，只读）

状态：`STATIC_READ_ONLY`。这是当前 `/workspace/yunshan` 的代码审计，不是逐 ID 路线查询结果或下一 tick 实观察。未构造 Simulation、未调用 factory/step、未运行测试/GPU/Git/Library、未修改共享源码、备忘录或 CLOSED 原件。唯一输出为本报告。

已读取 AGENTS、完整提示词、开发备忘录全部（本 agent 1–650；现有工资证据子 agent 651–1370）、ROOT13 REPORT。当前备忘录顶部记录工作分支实现提交 `17ad11d94029355207b52bce642e01f8f3747f1d`；本审计没有执行 Git 验证。实际只读核对 `docs/validation/2026-10-04-native-city-life/current-frozen-inputs.json`：295 输入、68 src，全部 SHA 匹配，mismatches=[]。`src/simulation.ts` 实读 SHA256 为 `46f0016cc88b60798648b1ac7a8dfbefb92ce151fac15ad4a61bbebf977eb822`。

## 原来的 offer 统计与生产决策不同

- `scripts/economy-observations.ts:59–77` 的 `foodSnapshot` 先筛 market/farm/dock、shop.open、inventory≥1；在活人中筛 hunger<30、携粮<1，再 `some(shop => actor.money >= shop.price)`。没有关系排斥、跨区距离、ACL、道路图、身体净空或实际决策检查，且字面返回 `routeReachability: 'NOT_OBSERVED'`。
- `scripts/economy-audit.ts:219` 在 snapshot 使用上述统计。`docs/validation/2026-10-04-city-life-root13/REPORT.md:42–48` 的 240、595 meals、库存15420.94804409、携粮320均属于默认295的一天原运行；240 不能换称240路线可达或240必会选择食店。
- 源码没有叫 `foodOpportunity` 或 `shoppingPlan` 的独立生产符号。实际入口是 `src/simulation.ts:1370` 的 `chooseFacility`、`1681–1686` 的已有承诺/重选、`1176` 的 `setDestination`、`1747–1749` 的 shopping/customer 和 `1771` 的结算。

## 真正的选择顺序

1. `simulation.ts:1612–1625`：按实际累计 minutes/频率处理；死亡先退出；hunger 每分钟−.05；hunger<48且携粮≥1先吃真实携粮并+52。age<6在家恢复后直接 continue，不走正常选设施。`family.ts:433–442` 另有现场监护人真实粮转交幼儿，不能把幼儿简单当同算法采购者。
2. `simulation.ts:1627–1647`：现有警务 dispatch 先履行或退出，紧急阈值是 hunger<20/fatigue<15/health<35及工资 allowance；继续履职分支会直接 continue。
3. `simulation.ts:1653–1667`：riding 未到端点直接 continue；已到站仅以原抵站后实际分钟重建原目的地。roadTask 再直接走施工分支。
4. `simulation.ts:1675–1685`：有效治疗以 hunger≥35/fatigue≥25先承诺；否则检查 `committedNeed`。有 destination 且 state==='roadWaiting' 无条件保留；eat 保留须 hunger<55、原店开/stock≥1/wallet≥原价；rest 保留须 fatigue<55/hunger≥30；work 保留须非 civic 重议、shift、employed、hunger≥30/fatigue≥25。有效 heal/treatment 也有 health/needs 条件。未承诺且满足 civic 重议、无目的地、decisionAt到期、夜间当前非rest之一才调用 chooseFacility，下一 decisionAt 设 now+25+random*35。
5. `simulation.ts:1686–1688`：设置路线后 roadWaiting直接continue；unreachable清 destination并continue。该时刻不存在实际到店或消费证据。

## 评分、价格和库存

`simulation.ts:1371–1376,1421–1422`：night=hour≥22或<6，shift=7.5≤hour<17.5；统一 add 用当前 walkingAnchors 到 buildingNode 的最小图距。travel必须 finite；统一扣 `min(150, travel/12)`；随后只按score降序取第0名，没有价钱、库存余量、预计到店营业或最终sale点身体路线的额外排序项。同分 comparator 为0，没有显式价格/距离二次 tie-breaker。

| 候选 | 基础分与生产行号 |
| --- | --- |
| eat | `(100-hunger)*1.15 + (hunger<30 ? 260 : 0) + (18≤hour<19 ? 12 : 0) − (night ? 50 : 0)`；1388–1393 |
| home rest | `(100-fatigue)*.8 + (night ? 140 : !shift ? 18 : 0) + (fatigue<25 ? 110 : 0)`，须有可用床；1382 |
| work/study-at-work | `clamp((450-money)/10,0,45) + (shift ? 58 : -16) + craft*.06`；学生school或实际employed；1387 |
| review | businessReview70（shift且needs门槛）/budgetReview65（限定公职与无allowance）；1383–1386 |
| heal | `(60-health)*3 + stress*.1`，health<60且wallet≥30；1410 |
| study/social/refuge rest | 1417–1419；同区，儿童学校另有限制；避难夜间rest可跨区（1412） |
| shopLifecycle | `shop_lifecycle.ts:399–409`：needs≥50/45等合法成年意愿；经营复核82，买租 `74+min(12,skill/10)−price/100` |
| family education | `family-education.ts:114–119`：成年愿意、needs≥40/40、8≤hour<17、资格/款/课程/≤500通勤等；social85 |
| civic | `civic-staffing.ts:177–196`：able(45,40)与心情/原工资资格/有限费用等；登记83+情绪项，17.5–20投票76+情绪项 |

`simulation.ts:1389–1393` 的食品先决条件仅：`shopCommodity==='food'`、open、inventory≥1、wallet≥shop.price；敌对等级≥2且玩家持店排除；door三维距离>1200且跨区排除。`shopCommodity` 的实际定义在315：workshop为materials，其余shop为food；不要混入工业材料店。

食店价格只作为资格门槛，不因更便宜提高eat分。库存只作为≥1门槛，不因库存更多提高eat分。选择使用未打折原价；成交 `1784–1786` 才按 trust>55打95折并算quantity。因此只有折后钱够、原价钱不够的居民仍进不了此候选/结算前原价资格。

仅在终档约08:00这个day/shift时刻，且假定正常有效needs/profile边界、age≥6、确实触发fresh choice时，可静态推出：hunger<30的eat原分>340.5，扣上限150后>190.5；home rest最多190，health≥0/stress≤100的heal最多190，其他普通候选更低，而上述needs≥40的机会被挡。若至少一个食品候选具有finite图距，fresh choice应是eat。此推导不是原下一tick实际选择；夜间rest+140、eat−50，不能外推夜间或其他时刻。

## 道路、ACL和完整身体是后续门槛

- `simulation.ts:150,994–996`：buildingNode由原door的nearest World node缓存；评分不是从人的位置直线到食店。`1071–1080` walkingTree只用开放road/bridge与edge.length；`roads.ts:95–98` 按live closure判断开放。
- `simulation.ts:1092–1138` walkingAnchors先处理captured道路退出许可，再真实室内出口；楼内floorPlanRoute失败返回[]。街道重用原route合法前缀；motion2逐真实3D路段精确匹配，仍不成才使用nearestNode并验证前缀。`1043–1068` prefix除road guard还可校验原native身体/stair helper，不能拿nearest door或投影替代。
- `simulation.ts:1140–1146` routeFromCitizen选最小图距anchor并拼network/door；无anchor/无nodePath/road guard拒，返回只有当前身体一点的singleton。`1376` 的finite graph add不是最终食店内部完整身体路径证书。
- `simulation.ts:1183–1220` marked目的地按activityPointPurpose确定用途；eat='sale'（2085–2086）。候选必须sale、从ground到目标每层ACL通过、eat仅floor0且非观景层（1190–1191）；function points以hash(citizen:destination)循环次序尝试floorPlanRoute（1205–1211），不是按点距排序。已经使用有效同目标点可保旧route（1204,1214）。内部无路/外部singleton会失败。
- **不要将roadWaiting状态等同指定闭边根因**：`simulation.ts:1220` 内/外路失败时只要全World任意edge当前关闭，就置roadWaiting；否则unreachable。`1681`又承诺roadWaiting。真实闭边见证须另调roadMovementAllowed/相交edge/permit，不能用state文字归因。
- `access.ts:19–38` 为共享floor ACL；`simulation.ts:1185,1709,1780` 采购NPC使用citizenIdentity及单一主身份构造person。`architecture-floor-plan.ts:255–260` ground market/workshop/farm/dock提供真实sale用途点；有sale点不等于当前身份可进入。
- `simulation.ts:2090–2107` 到点须真实floorPlanPresence为room/stairs、该层权限与目标radius≤2；室内route复用shared findBuildingFloorPlanRoute(.35)及真实counter callback(.35/1.72)。`architecture-floor-plan.ts:560–588` 处理真实floor、stairs recovery、完整tail/connector guard，失败返回null；`507–522`检查合法standing/entrance。
- 默认motion2采用 `simulation.ts:1513–1599`：live placed voxel、floor ACL/链接目标ACL、counter、floor walls/furniture/roof及native stair description/validate/advance共同约束。身体拒绝置physicalWaiting（1551）；道路拒绝replan或roadWaiting（1552–1555），actual arrival仅routeIndex到末尾后成立，arrival尾分钟另计。`home-rest.ts:84–89` 是.35/1.72身体对.2m cube的查询；`architecture-floor-plan.ts:432–446` 共享实墙/家具/屋顶sweep。

## 原生到店与结算还要逐层证成

- `simulation.ts:1689–1699` 门距>200可选择首个满足条件transit：合法非移动车、非flight、wallet≥4、capacity、近车≤40；乘车+剩余合法步行+15必须比walk快。扣真实4文后先riding，不能直接称已到食店。
- `1702–1713` actual moveCitizen完成后，还须near building及marked真实用途点，否则unreachable清目标。`1747–1749` eat到场才state=shopping、emit customer；`787` listener将具名请求存runtime.customers。
- `1766–1769,1805–1813,1819–1823` 当前commerce phase零售开门真实依据：06:00起，market<22，其他<20；district.energy>25、未insolvent、lifecycle允许。批次间也在当期合法opening处理实际customer请求，旧晚间批次关门失单修复已经在当前源，不把旧v4事件直接当295原因。
- `1775–1793` 结算重查活人/关系、commodity、destination、shopping、hunger≤78、wallet≥原价、stock≥1；位置还需建筑范围且marked真实sale点、不被voxel挡。数量无携粮至多2，否则至多1，再限wallet/折后价及whole库存；counter≤100000、FIFO consignment quote、supplierGross、经营账户收款cap都可拒。只有通过后才扣现金/库存、hunger+52、携粮+quantity−1、实际税/货款转账。
- `1799–1802` 成功只消耗该请求一次；`1894` 批次末仍清customer队列。需区别原terminal的eat intent、existing route、actual customer、sale，而非把这些阶段合成一个“购物完成”。

## 私营工资与公共财政的真实关联

- `simulation.ts:319,376–379`：shopFunds是绑定company.capital或shop.cash；transferShopFunds只更新雇主经营账户。
- `330–367`：private allowance来自实际具名日班；现场合法owner按经营现金扣工资债、旧承诺与经营储备才增加cap。没有新劳动承诺则allowance0；不是从国库拨私薪。
- `278–308`：现场实际剩余分钟、480日cap和原allowance决定credited；shopLabor与已赚claim仅按credited增加，已赚时经营profit记费用。17:00 `1754–1761` 才将claim排入工资支付队列。
- `1910–1917`：privateRatios以shopFunds支付私薪、扣雇主账户；publicRatio以treasury支付公薪、扣国库。实际税后支付增加citizen.money，未付保arrears；税再进国库。购粮 `1389/1777/1793` 直接读取/扣citizen.money，没有publicBudget或wage debt参数。
- `594–606`：publicBudgetSnapshot只保护shopId===null的due/earned，公薪预测排除shop场地；私营工资债不直接计入公共预算。公共材料采购可将有限真国库款付给供应商（676–685），这只是明确的材料贸易路径，不能推导任意居民食物route失败由国库造成。
- `scripts/economy-audit.ts:232–235` 将已到期arrears与earnedNotDue分列。原REPORT:44摘要“私营欠410.14548”不能单独判为逾期，更不能归因于国库直接拒付；应引用原JSON具体private/privateEarnedNotDue字段再定名。
- 当前food高库存与paid farm劳动并不矛盾：`1843–1847` produced受max(0,120−inventory)限制，stock高于target时合法有薪劳动产出0。observer `scripts/economy-observations.ts:22–24,50–54` 也明确earned minutes≠paid cash≠positive batch production；不能由库存/工资总额猜物流或消费闭环。

## 对逐 ID 原终档审计的建议

1. 保原terminal/save SHA与原World几何；沿每人的真实position/route/index/activity/destination及rider/dispatch/roadTask/decisionAt先判断是否经过fresh choice，不改需要/现金/粮/速度。纯对象查询结果标`STATIC_QUERY`，勿记成下一tick实际行为。
2. 对每个offer分开记录：raw商店门槛、关系/1200跨区、anchor是否存在及具体失败出处、finite road图距、ground sale ACL、具体function point与内路、原full route每条身体/道路guard见证、闭店deadline、票款、实际customer/成交前提。只发现首个阻碍时保其building/floor/edge/segment/from/to；其它原因留未观察，不推全城同因。
3. 所获120上限纯查询只覆盖实际查询的120对象/案件，其余显式`NOT_QUERIED`；不要把原240参数offer统计改成240身体可达。保原食物/材料/携粮/已吃meal口径与due/earnedNotDue分离。
4. 备忘录原边界继续遵守：777的citizen191旧v4晚间失单有真实31步见证，456/604没有native customer不能称同因；857旧layout食品37相关PASS仍natural quorum总体FAIL，不搬v4/295；858公共班审与采购签字前提不同；1090雇主资本为实钱；1332旧05:20夜闭不等破产。所有旧图/旧长程不替代当前295默认证据。

本审计没有新增逐 ID 路线结果、动态消费结果或长期稳态证明；这些仍由父任务的原终档纯查询与独立后续授权运行决定。
