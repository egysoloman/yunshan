# 真实缺区食品柜台：只读证据与最小补丁契约

本轮为可实施方案和只读失败复现，**尚未实施食品柜台**。没有修改共享 `src`、既有 `tests`、world、资金、库存、岗位、班次或原始存档；没有再跑 14/30/60 日审计或 GL。后续仅在原冻结源做720tick短前缀重放和独立克隆的原生预算探针，范围在下方明确。共享 HEAD 为 `373165d0923d789b4042d7757116521b2683ed73`，建筑 v4 由其他负责人实施，本分析不替代其几何、权限或旧配方验收。

分析原件来自已完整运行的 `/tmp/yunshan-empty-freight-production14-20261001`，使用**同一原 32 个 src 文件（31 TS + 1 CSS）**及其可信世界生成器、14 日末原存档。原 audit 的 13 个金融源范围另见上阶段，不能将本次只读查询说成当前全部共享源码的审计。每个源与原 `snapshot-manifest.sourceCopy` 一致，查询前后源 SHA 相同，原档 import/export 逐字节相同；没有执行一个模拟 tick。

原 save SHA-256：`eb36bd85bcc83f798d7bfd3599bc79f1c41172b7b429bfae22aa6ccc075621d1`。完整原件继续在 [上阶段归档](../2026-10-01-phase2/economy-empty-freight-production/README.md)，本目录不重新生成或修改其轨迹。新只读结果、观察脚本、七项检查日志及 SHA 清单在本目录。

## 原档中的需求、财力与路径失败

第 14 日 08:00，616 NPC 存活，276 人钱包至少 15 却 hunger<20。学院、官署、星港各有 56 人，理想需求各 `56 × 1440 × .05 / 52 = 77.5385` 份/日。食品即时食用和随身储备仍按原 52 饱腹单位/份、原每分钟 .05 衰减，不修改这些参数。

| 区 | 实有区货 | 食品商铺 | 有钱饥饿 | 有钱饥饿者无可广告的可负担食品 | 区货按理想需求可维持 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 学院 | 140 | 0 | 8 | 0 | 1.806 天 |
| 官署 | 168 | 0 | 41 | 36 | 2.167 天 |
| 星港 | 172 | 0 | 56 | 56 | 2.218 天 |

这些区货全部是既有 `shopId:null` 公共批次；它们没有 `nodeId/siteId`。全城货池 6785.1739 不是全部属于公库：河岸/工坊区有真实供应商货权，不能将这些批次改成公共粮食。新方案不将工业物料变成食品。

三个实际失败（均来自原存档，不是赋值夹具）：

- 官署 `citizen-5`：钱包104.7228、hunger0、随身粮0；43 家开放现货店有可负担的有限真实路网路线，但全被原广告范围排除。原 `chooseFacility()` 选择住所休息。最近食品 `river-b46` 真实路程3975.955m，晴天步行946.656分钟，08:00出发预计23:46才到，22:00已关门；附近真实议事堂 `government-b23` 只需380.108m，但它没有售粮业务和在岗员工。不能仅删除1200m广告过滤后宣称该人可按时吃到。
- 星港 `citizen-21`：钱包772.639、hunger0、粮0；43条可负担现货路线，无一进入广告范围。原选择去 `starport-b10` 工作，最近真正售粮路程5335.906m，预计次日05:10才到。原工作地点251.876m，但柜台不存在，员工都没有健康服务前提；不能把这个近工作点当成已开放粮店。
- 学院 `citizen-26`：钱包237.4922、hunger0，有15家食品广告；仍要走1641.135m、390.746分钟到河岸现货。附近真实学校 `academy-b16` 路程410.203m，有两名健康且有当日合同的教师，但当时均未到岗，也没有柜台、许可证或现场粮食。这是可改善的条件候选，不是已经发生的交易。

新柜台只能改善其中有真实履约条件的访问链。原全城食品产量196.0761份/日，理想需求852.9231份/日，现有初始粮食仍在被消耗。柜台销售收入不能代替新增农田劳动、真实招聘和更长程守恒/生存验证。

## 实际场地、人手、批准与资金

原可信世界学院**没有 station/hall 建筑**。上阶段只允许驿站/议事堂的方案在学院不可实施；应明确允许真实学校的公开服务点，仍须现场许可、公共层访问、工作分配，并计入教学服务占用。新 v4 必须从共享 FloorPlan/usepoint 读取实际公开服务点，不能复用任意矩形 inside 或院洞作柜台。

| 候选场地 | 真实原岗位 | 健康且有当日承诺的人数 | 当前在岗 | 住宅真实路程≤500m覆盖 | 最近运输节点→门真实路程 | 仅一趟往返步行 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| academy-b10 学校 | 8 | 7 | 0 | 10/56 | academy-quarter-2→96.621m | 46.010分钟 |
| academy-b45 学校 | 4 | 1 | 0 | 16/56 | academy-quarter-1→272.926m | 129.965分钟 |
| government-b13 议事堂 | 3 | 1 | 1 | 10/56 | government-quarter-1→89.097m | 42.427分钟 |
| starport-b10 驿站 | 3 | 0 | 0 | 15/56 | starport-quarter-2→107.628m | 51.251分钟 |

健康前提为真实存活成年、health≥45、hunger≥40、fatigue≥35，与现有受资助公共服务的前提一致。`academy-b10` 的 `citizen-81` 现在还有195承诺分钟，距岗位78.064m、hunger52，仍须真实抵达；它不是新增员工。`government-b13` 的 `citizen-555` 是唯一真实健康且在岗候选。`government-b10` 五名员工全部hunger0；星港所有公开候选场地员工均hunger0。没有把休班、死亡、饥饿人员或店主身份简单改成售粮员。

今天真实 `public-shift-14` 共287名员工、每人195分钟、cap4918.2203，前日19442分钟由 `citizen-39/citizen-303` 在 `core-b12` 现场批准。历史工资债、雇主和时薪保持。全城83名具官员/议员身份的人当前仅 `citizen-555` 在岗，**没有同场两名在岗签署者**。此前班次签名不等于已批准新的柜台。

真实财政快照：cash11198.7887，已赚公共工资202.1481，下一日全岗位工资预测11863.6806，已承诺剩余工资4844.9883，必要运维2073.6，保护reserve14139.4286，新可授权预算**0**。不得为柜台补钱、释放过去工资债、或绕过既有受保护预算。公共员工承担售粮任务时，在原已批准时数中明确划分服务分钟，不能再领第二份工资；原教学/交通/行政服务减少的分钟另列缺口。

一个场地不足以覆盖城区：只按“存在健康受资助员工”作几何候选，学院四处公开学校最多覆盖44/56住户的500m路程；官署只有一处健康场地覆盖10/56；星港为0。其余区域柜台、外来商户和真实招聘是后续真实合同，不能自动重派工作人员。

## 最小生产补丁：先地点和货权，再开市

推荐分三次可独立验证的改动，不同时引入宏观税费、自动加岗或新公共补贴。

**A. 货池定位与原档保全。** 当前 `cargo-arrived` 给区货池加数量/货主，却丢卸货节点；`freightLots` 只按供应商合并。追加实际事件 `vehicleId,nodeId,arrivedAt`，新批次按 `lotId,sourceShopId|null,quantity,commodity:'food',depotNodeId,receivedAt` 保存，每个 depot 必须是车辆真实到达的可信 node。对旧批次保持 `location:'legacy-district'`、原数量/货主和全城实物恒等，不伪造历史节点。

保守的首版仅允许**未来真实到站的已定位批次**进入柜台采购/寄售；旧6785.1739继续作为未定位区权利，不因迁移成为任何一座楼的现货。若随后决定将旧区货池规范为区域仓库，须单独可见的库存核对契约：真实区级仓库节点、现场职责人员/批准、原旧批次ID与核对数量、位置证据性质、只加地点元数据、不增减货权/现金，以及后续实际搬运。不能静默宣布旧140/168/172已经在任意候选楼内。这项旧资产定位选择须由集成负责人明确实现，不能靠保存标签获得授权。

**B. 小额许可与原班次任务。** 独立 `FoodDistributionState` 初始化为空，不新增 baseline `Shop`（固定 shops/companies/estate/FIFO引用保持）。候选只读取真实 `station/hall/school` 公开服务点；学院明确为学校公开服务任务，不使用禁入教室。许可证必须沿现有现场 mayor/实际议会，或真实同场两名在岗任职官员的小额部门审批。首批价值上限40、最多8份，初始公开价格12文/份须作为许可证的公开销售条款依法签署；不自动审批、不改法定税率、不用售价给财政守卫造收入。超范围/续额等待真实新授权。

公共初始粮仅使用已定位 `sourceShopId:null` 批次；供应商批次先冻结真实 `quoteSupply` 的 H，保原货主，取得寄售保管权而不是假装公库已买货。`maxBatch = min(8, floor(40/H), actualAvailableQuantity)`；H=4时最多8份，H=6.17时最多6份。首版不提前给供应商钱，不承诺超出真实顾客付款的公共垫资。

任务须由已有合法雇主/许可签署者和真实成年员工在现场接受，绑定原 `public-shift`、原 `citizenId/workId/ratePerMinute`、时间窗口与分钟上限。不能直接改原workId、工资债或原身份。字段包含 `taskId,shiftId,counterId,staffId,acceptedAt,startAt,endAt,minutesCap,workedMinutes,taskKind`。任务分钟不能与当tick原公共工作/文化教学/临床/交通服务重复使用；核心提供统一单人每tick分钟分配回执，并仅一次累计工资。处于饥饿、缺资助/过时段/离场者不能值柜。

**C. 实搬运、到场服务与付款。** 首批使用实际已在 node 的有限货，不另做自动长途调车。员工接任务后沿原 road/bridge 路径真实到 depot，现场把不超过8份的原货主批次转成 `carrierId` 保管批次，再沿真实路线回柜台。离场、休班、红灯/不可达按原路程/速度/天气暂停，不在 commerce 时跨区扣货。员工保管粮与其自有 `Citizen.food` 分开，不能被家庭餐食或自动饱腹免费耗用。

开柜必须许可证有效、本人在合法公开服务点、真实当前有资助分钟/需要合格、柜台有已收到批次。每份买食使用2分钟真实共同在场服务；该值是建议的新服务设计，尚未验证。每个买家最多一个等待队列项，先保留有限库存预留，不提前扣钱包；到场服务完成时重新完整preflight再原子成交。无人值守就明确等待，不能将公职默认身份当24小时柜台。

按建议8份/批、2分钟/份，academy-b10一批至少62.010分钟（仅取粮往返+售粮），government-b13至少58.427分钟，starport-b10至少67.251分钟；195分钟一人班次分别最多3/3/2批，即24/24/16份，尚未计排队和到岗路程。academy-b45一批约145.965分钟，只能一批。此上界揭示人手/地理负荷，不能宣称覆盖56人日需77.5385。

## 建议状态/API与精确账路

可由新 `simulation/food-distribution.ts` 实现业务，core保留真路网/班次/固定商铺权限。所有时间使用 `extension.lastUpdate`，没有第11阶段、时钟镜像或复制公库现金。

```ts
type LocatedFreightLot = {
  id: string; sourceShopId: string | null; commodity: 'food'; quantity: number;
  depotNodeId: string | null; receivedAt: number;
  location: 'node' | 'legacy-district';
};
type FoodCounterLicense = {
  id: string; siteId: string; servicePointId: string;
  approvedAt: number; authorizationId: string; approvedBy: string[];
  openingMinutes: [number, number]; retailUnitPrice: number;
  batchValueCap: number; batchQuantityCap: number; status: 'pending'|'approved'|'closed';
};
// 为新模块提供窄方法；不允许其直接assign任意workId或造工资。
freightInventory(districtId: string): readonly LocatedFreightLot[];
reserveFreightLot(lotId: string, staffId: string, quantity: number): Reservation | null;
collectFreightReservation(id: string): CustodyReceipt | null; // 真node现场
receiveCounterCustody(id: string, counterId: string): CustodyReceipt | null; // 真柜台现场
allocatePublicTaskMinutes(taskId: string, elapsed: number): LaborReceipt | null;
foodCounterOffers(citizenId: string): readonly ActualOffer[];
purchaseCounterFood(counterId: string, buyerId: string, quantity: number): SaleReceipt | null;
```

以上是接口草案，尚未落盘。`Reservation/CustodyReceipt`须引用同一原lotID/货主/冻结H/真实node/人/时间，quantity在 source、reserved、carrier、counter 四处只能属于一处。不能靠重复查询 `freightInventory`复制资产。批次数/队列/收据有界，归档统计保总接收/退回/售出/消耗恒等。

成交例：买家P=12、q=2，吃1份、随身留1份，实际 stock−2、actualConsumed+1、consumerFood+1。公共货主为null时，Pq=24：公库净零售收入22.08、销售税队列1.92；没有假供应商、没有额外4文进货收款。私有供应商H=6.17时：供应商gross12.34、net11.3528；公库零售差额9.74、salesTax1.92、wholesaleTax0.9872，共24。H=4时同理供应商net7.36、公库margin14.08、salesTax1.92、wholesaleTax0.64，共24。

若 `Pq*(1-tax)<Hq`，或任一收款方达到1e9账户上限、买家现金/库存不足、许可/人手/地点无效，整笔无mutation，不能clamp丢钱或补财政差额。供应商利润仅记录本次实际净入款，过去生产工资已应计不再扣；公库无镜像counterCash。原core `sale` 税/GDP与 `wholesale` 税事件各发一次，不给counter伪造baseline shopId。公库margin单独真实入库，账本/审计来源标签区分已观察事件，避免再次把整P入库。新的actual food-consumed事件只记那一份真正已吃掉的食物，保留另一份实体库存。

预约取消/到期不扣钱、不丢物；已取未售批次仍归原货主，继续保存真实carrier/counter位置。返还必须实际搬回合法depot，不瞬时恢复远方producer stock；死者未完成托运进入真实资产保管/执行人记录，不能删货。尚未成交的钱在买家，最小版无需新的金钱托管池。

## NPC窗口广播、保存与验证顺序

`foodCounterOffers`只发布依法批准、有真实现场值班和已收现货/真实可兑现到货窗口的服务。people仍沿真实路径去柜台，到场排队；不往 `runtime.customers` 塞station/counter ID。counter访客独立保存，核心新增明确食物活动分支与模块命令/原生UI入口。预报以真实walkingTree/公开当前班次推算**抵达、排队结束、当班剩余分钟**，不是以直线距离伪造可达；来不及在窗口结束前履约就不能广告“当前可买”。低粮者在尚未hunger0前依据可负担的有限份数自费准备一份携带粮；维持消费量/钱包/库存原约束，不自动免费给粮，不无限囤货。

保存需同步新module manifest与partition：真旧档无module初始化空许可证/空counter，原旧区货权保持；新档删module/预算/body不能旧档清零。签署者/真实公开servicePoint、shift/task原雇主、所有lot/depot/vehicle/carrier/counter引用严格交叉校验。新v4使用共享geometry/usepoint；四可信旧world配方继续按其自己的point规则恢复，不接外部save的layout标签授权改几何。原始档与批次移交中/待售/队列中/返还中均要求逐字节保存恢复、24tick精确续演。

实施回归顺序：先原区货→实际node定位事件/旧未定位保全，再真fetch→carry→柜台食品守恒；未批准/非公开point/未到岗/休班/缺需/错node/无钱/无货/超账户cap全部原子不动；null公共批次与两种冻结私有H实际付款/税/袋内食物单次耗用；返还/死亡/截止班次保资产；工资不重赚/其他服务分钟真实扣减；跨module坏档原子拒绝与24tick精确续演。通过后才在新的三方冻结源运行默认14日，再30/60日，同时检查健康、可负担窗口、真实生产、欠薪、机构服务缺口、现金财政及所有食品货权恒等。

本目录**七项检查**中五项是原档/几何/预算/失败条件的只读断言，两项只检查上述建议账路的数值分拆，**不是新柜台实际交易回归**。新柜台、搬运、许可、NPC消费或长程改善均未实现/未运行。观察脚本初次用JSON key顺序比较原manifest失败；逐文件SHA完全相同，改为逐键内容比较并保留失败日志，不降低真正源SHA/原档逐字节断言。

## 新局能在失效前合法启动的实际时点

根随后要求核实早期可批准/可工作窗口，故在同一原32源独立重放**最多720tick**。没有注入钱、货、角色、路线、时钟或批准；观察器只读。原完整采样tick0/180/360/540逐字段完全一致；tick720的全部独立冻结字段相同，唯原详细采样六人的position引用在原14日后写日志前继续随本人移动（18个xyz差异）。原观察器代码是 `position:c.position`，未copy。首次完整deepEqual失败原样保留在 `initial-prefix-mutable-position-failure.log`；**不称五完整sample或全部模拟状态逐字节等价**。新firstFailure/车辆position都即时copy，32源起止相同。

| 实际事件 | Tick / 当日时刻 | 人/车/地点与前提 |
| --- | --- | --- |
| 首个真实两署在岗 | 21 / 08:42 | government-b13，citizen-27/555，hunger61.345/71.579，真实出勤8.623/12.284分钟，standing appropriation有效，可新增保护后预算65199.5638 |
| 学院现有教师可现场服务 | 26 / 08:52 | citizen-422，academy-b16，hunger91.471，出勤8.920分钟，原480分钟站立拨款 |
| 星港现有驾驶员可现场服务 | 27 / 08:54 | citizen-21，starport-b10，hunger67.712，出勤12.033分钟，原480分钟站立拨款；第14日同一人饥饿0不是新局的初始条件 |
| 星港本区实际两署 | 45 / 09:30 | starport-b18，citizen-307/505在岗，保护后预算64926.1329 |
| 首个有钱hunger<20 | 401 / 21:22 | 学院citizen-191，钱包410.4643；本区140粮，商铺粮14642.4814；最近路658.727m、156.840分钟，但距22:00关市只38分钟 |
| 星港首个有钱hunger<20 | 404 / 21:28 | citizen-604，钱包376.3044；本区172粮，原有20个广告，仍无法从遥远现货形成及时到店/储粮 |
| 官署首个有钱hunger<20 | 408 / 21:36 | citizen-456，钱包461.6645；本区168粮，最近路729.092m、173.593分钟，距22:00关市仅24分钟 |

首失败已有一百余间开放现货食品店、财政可用55729.0089，并非全城粮食总量已经耗尽、没有合法早期署名、或初始公库没有运营资金。早期原岗位和480分钟实际站立拨款提供启动条件；新职责需要明确接受/服务分钟分配，不能直接把所有教师/驾驶员叫售粮员。柜台须在这个早期窗口履约、让居民自费在工作/学校附近买食和有限携带粮，不能等21:22才广播关市前来不及抵达的机会。

**独立克隆的合法预算探针**：精确恢复tick21原save，仅在该克隆调用现有 `authorizePublicBudget({siteId:'academy-b10',purpose:'food-distribution',cap:40,approvedBy:['citizen-27','citizen-555'],approvedAt:522})`，实际返回true；cash79906.1184前后不变，授权余额仅增加40。原重放轨迹不变。这证明旧布局下现有小额真实署名/预算方法可以使用，不等于原轨迹发生了食品许可证/柜台，也不证明新v4两个不同楼层的旧inside位置等于新的共同决策usepoint。v4必须按其共享公开/决策点重新实际验证和路由。

**实有粮在哪**：旧14日observer仅累计卸货amount，原log无法提供node/vehicle。短重放在每个traffic前后只读捕获 `preCargo + actualLoad - postCargo`，每tick逐owner/district对账原生 `cargo-arrived`，保存真实生成车辆、原边终点和实际位置，路车仅有原1.3m车道偏移。学院四个quarter各28在08:26～08:30到站、main站再28于09:12到站，共140；官署四quarter各28同窗口到站、main于09:18/09:30各28，共168；星港四quarter各28同窗口到站，真实flight `vehicle-flight-airport-runway-west-starport-station-0` 于09:12在starport-station卸60，共172。完整16笔车/节点/数量见 `food-first-failure-replay.json`。它们是**初始公共货**，不是有供应商的新增生产货。原配对区货保全不等于凭这份诊断给实际用户旧档补节点。

前720tick这三个零食品商铺区没有新的private-owned粮食卸货。装车修复仅让下一真实节点卸货，未建立将农场粮送到缺区的真实订单路径。因此先定位/柜台也只能消费已有480份，后续仍需真实需求订单、冻结货主价、合法空车接单、实际跨区路由和相应有限劳动，不可将首日局部销售当14日可持续供给。

## 一个扩展模块与最少核心接点

首版限可信初始化**没有食品商铺**的区域（学院/官署/星港），保留原固定Shop IDs。这三地原 `commerce` 不会把区货转进市场库存，因此可以严密对账已定位批次、旧未定位货权与区域总数；不能悄悄将此受限方案扩展为所有市场的无地点配送。

新 `food-distribution.ts` 注册固定十phase/command/save hooks，拥有许可证/任务/柜台/队列和原批次转交状态。核心接点：

1. `cargo-arrived`补实际`nodeId/vehicleId/fromEdgeId/arrivedAt`，给新有限卸货独立FIFO receipt；原旧区货保留未定位，不合并到新收据。**根已授权下一步仅在/tmp实现这一个接点及其严格保存/定向回归，尚不改共享source。**
2. `chooseFacility`读取模块真实offer，用共享v4 servicePoint及原路网/关闭窗口生成到场选择；独立counter活动/访客，不能改成普通shop ID。
3. 对已签署的搬运任务，在people的普通移动/劳动前提供窄的`onCitizenActivity`代理：核心先按原tier elapsed更新需求，扩展只接管真实任务route；核心提供“原雇主/原时薪/原承诺分钟”劳动回执。这样出站取粮外勤可以合法累计一次真实工资，而不是离场仍假称isOnDuty或再次重复原工作工资。柜台现场只消费该tick原工资回执中的可分配服务分钟；原其他服务占用按同一人员分钟账减除。

公共预算/签署者可复用现有接口；原生购买/取消由扩展command handler接管；无新的免费资金池。既有职责可被其合法主管分配有限柜台/搬运任务，但必须明确接受、记录教育/运输/行政机会损失和保护后的工时，不将新商业职责隐形塞进已使用的480分钟。下一步单做货物定位的patch不改变任何这些人员行为或许可。
