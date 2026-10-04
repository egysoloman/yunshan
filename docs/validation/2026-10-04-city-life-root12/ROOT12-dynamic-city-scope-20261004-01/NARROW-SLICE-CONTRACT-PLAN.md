# PLAN：已登记私营店再次经营困难的自然停业

本合同尚未实施，未运行测试或模拟。它只修“原店重开后再次满足原困难条件，却因已有title而不再自然停业”的入口；默认城市的本区供料缺口、整栋拆迁、新道路、火灾/地震和自然病毒源另列剩余，不纳入本切片的完成声明。以后实施必须从父组指定的新冻结源码建立新组，不能直接把本组264当作共享267的补丁基线。

## 现有合同和可复用通路

`src/simulation/shop_lifecycle.ts:388–396` 的opportunities是普通居民目的地评分的一部分，`src/simulation.ts:1362,1692–1708` 经原路线、身体位置和原work功能点才发`shop-lifecycle-arrived`。现owner第一次困难的自然路径已存在：原到场→`suspend`→有限本人自筹`restart`，自筹/供料/人手等前提不足且有处分权时才sale/lease报价；其他居民依真实身份、需求、意愿、家到店图距离和钱包自然选店、步行、实付，然后按原合同修缮。不能把这些实现称为“只有玩家按钮”或“模块默认未启用”。

静态缺口在opportunities第393行及arrived第426行均要求`!title`。已有合法title且state=`operating`的原店即使再满足相同三项困难，也没有自然再次暂停入口。该静态结论不是已经运行的FAIL；本组没有建立可执行复现。

原困难条件必须继续是三项同时成立：`profit <= -600 && inventory < 1e-7 && shopFunds - shopProtectedFunds < 20*8/24`。`shopProtectedFunds`在`simulation.ts:305–310`保护原已赚工资、当天尚未执行的真实授权工资和租约债/垫款。夜间、断电、少一个条件、显示时钟调整不能成为倒闭或处分权来源。现`shopInsolvent`与两处lifecycle判断一致，不能为促成默认轨迹改阈值、减保护或增加钱粮。

## 最窄新规则

拟新增游戏规则：已登记、当前operating、非公司绑定且无未清租约权利的既有私营market，可以由当前成年存活资产持有人在原work点再次办理economic-distress停业。这是原角色的实际意愿行为，不产生土地/楼宇产权、不代公司清算、不给另一居民强制夺店权。

候选必须满足原`privateMarket`、真实operator等于原assetOwner且等于当前citizen，`shopLifecycleCanDispose`为true；现或历史租约的未退押金、欠租、未退advance不能删掉后放行。存在current corporation或尚未清的租赁/公司返场义务时，本新增路径等待原租约、股权、死亡/遗产合同处理，不自动切换账户。原父组若要将“租户自愿暂停经营但不得处分”纳入后续规则，应另审，首合同不扩。

原普通意愿门槛继续使用alive/18岁/health45/mood55/stress≤55/hunger50/fatigue45及7–17。到场后仍执行`suspend`原成年人、存活、当前经营权、2m近建筑、work功能点和voxel阻挡检查。新增候选不从继承产权免费取得merchant、skill45或education1；后续买家使用原eligible，经营修缮仍须eligibleOperator。

停业的最小状态变动是原title从operating到suspended、原业务时钟suspendedAt、reason=economic-distress和shop.open=false；保留同一shopId/buildingId、assetOwner/legacyOwner、原现金/库存/寄售货权、历史利润、员工合同、全部已赚/授权工资、租债、旧listing/lease/receipt编号、上一轮reopen及reopenHistory。随后复用现有限自筹/报价/交割/修缮，不重建title、不清旧修缮履历。32个修缮履历、256报价、4096回执等现容量不足时合法等待。

## 供料、身份与真实劳动的验收边界

复用原`restart:250–302`：至少一名真实在册成年员工和employees≥1，实际1份工业材料、食物补到2、真实供应者扣库存/收净款/公库税、保原保护现金与营运6.6667；本人补款保100生活费。后续原工资事件的creditedWorkStartAt/EndAt与job时窗交集累计60员工分钟，`consumeShopLabor`避免再计产出。到场、注资和买料不能代替正额实薪工时。买价/首租仍给原主，50费用入公库、200资本入原店，租两期押金和七日期限照旧；死亡/无继承人继续现family/executor等待流程。

默认109market没有一店同时拥有本区实际private workshop和farm/dock供应候选，详见`DEFAULT-MARKET-RESTART-SUPPLIERS.json`。因此，本切片可证明再次停业与合法报价入口，不可据此声称默认空店完成第二次重开。测试用小地图必须明示受控供给前提；新跨区物流不能用取消本区限制或账目瞬移作为“完成物理运输”。已有本区采购仅证明真实资金与货权账，不证明逐件搬运。

## 版本启用与旧档语义

现state.shopLifecycle.version=1、shop.lifecycleVersion=1及导出runtime.shopLifecycleVersion=1是经营权/托管保存合同，不是新规则启用开关。`simulation.ts:2316,2338–2353`导出并验证manifest后会删export-only marker；不能凭已有title、第一次登记、constructor初始化或host的新城状态启用再次困难规则，否则旧v1/v2档的原24tick续演可能改变。

下列为待父组审定的具体新版本合同，生产尚无这些字段/API：

- 新产品创建入口明确选择规则集，浏览器main和headless必须调用同一显式创建入口；无参底层Simulation构造保旧语义。可与已审ROOT12产品规则版本工作合并，但商铺规则须有独立`shop-repeat-distress-v1`选择，不借地方议员/council标记取得经营权。
- 最小独立body候选名`state.dynamicShopRules`，version=1、ruleId=`shop-repeat-distress-v1`、activatedAt=原业务时钟、worldSeed/fingerprint、origin。新产品origin标明product；受信任显式旧档升级origin保存原文件SHA256与cutover，激活时不补倒闭/投票/工时等旧历史。激活不增加钱粮、身份或title。
- body加入PERSISTED_MODULES，runtime导出`dynamicShopRulesVersion:1`作为与body配对的metadata；validator精确验证字段、规则值、原世界和来源/时钟。以后若父组采用统一ruleSet，则以其商铺独立条目替代此候选body，仍满足同样manifest-pair和旧档覆盖合同，不能同时安装两个权威。
- 需要新外层save v3：目前reader只收v1/v2，故旧reader对v3必须在修改live状态前原子拒绝；新reader继续识别原motion v1/v2与manifest规则组合，不能把外层v3误当legacy motion分支。新规则body/marker缺一、伪cutover或跨世界原子拒绝。
- 导入原v1/v2（无新标记）必须覆盖并清空constructor/host留下的新规则及任何相关缓存，保持禁用；原24tick RNG、状态、runtime与完整导出字节同。旧有shopLifecycle/v1托管、旧公司/租约/遗产均照原语义保留。信任升级只能由另审离线/产品流程显式执行，普通命令/玩家emit不能伪造来源。

尚需父组选择统一规则集或独立body、受信任升级入口和外层v3读写范围，才能形成可执行生产补丁。此前不能声称旧24兼容或任意默认构造已启用新行为。

## 待改文件与强回归范围

| 文件/接口 | 拟改内容与约束 |
|---|---|
| `src/simulation/shop_lifecycle.ts:388–396,421–434` | 只对显式新规则下operating、原资产主、非公司且可处分候选扩展原两处困难判断；复用suspend/restart/list，先保持原函数时序和十阶段。可共用小私有predicate避免两处漂移，不新增Simulation大接口或路线/MZ迁移。 |
| `src/types.ts`、`src/simulation.ts` 的规则保存/import/export/manifest | 仅在父组批准规则启用合同后新组实施；原shop title v1继续作为托管，不改旧source SHA/fixture。v3 reader分支、旧导入清除host状态与原子验证必须一起审。 |
| `src/main.ts`与明确headless创建入口 | 和父组共用产品创建合同协调，不能子组擅自改共享入口或假称headless普通构造等于新城。 |
| 新隔离定向test及原shop-lifecycle/rights/self-funding/company-return原件 | 首先保原代码可复现的期待FAIL，再新规则PASS；具体旧18/其他immutable fixture及expectedSHA全部原封不动。 |

先做一条原第一轮自然通路的证据回归：受控经济困难前提必须明示，从原正常站位经ordinary选择/路线/真实arrived到有限自筹或报价，不在运行中调用suspend/list/buy/restart或伪wage/arrival事件。若采用合法首次完成修缮档，必须保其原实付、材料、劳动、来源，不编造默认历史。由此构建第二轮operating状态的baseline FAIL；本组264日终readerFAIL档不可冒充有效种子。

最小强断言包括：三条件边界（每次缺一项无停业）；仅新规则到场前不改权利/钱粮；原合法经营者到场才暂停；公司、活/未清租约、他人、死亡/未成年及非法层拒绝；同一title第二轮原历史和所有债权逐字段不变；自筹保100、无供给/工资合法等待、真实材料/税/60分钟只消费一次；实付sale/lease不删旧债；新v3读回+24一致、旧v1/v2清新host状态后原24全字节一致、坏marker/body/来源原子拒绝。阶段次序、默认map及旧断言不削弱。

验收只能写“新增规则下已登记私营原店第二次自然困难停业/报价入口完成及其真实合同验证”。是否完成自然第一轮/第二轮重开分别看完整轨迹和供料/工时证据；当前全默认城市、全部动态系统和稳态仍为剩余。
