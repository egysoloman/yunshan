# actual14 可变城市建筑/路网的静态复核

审查对象为冻结 `/tmp/yunshan-system-coherent-14/source`；本文所有 `src/...:line` 均指该冻结目录。已重新读取工作区AGENTS、原始提示词、当前备忘录的实际14结果与最新“城市必须会变化”追加。冻结自身备忘录01:05仍记待build/GPU，当前共享备忘录01:38记录14住宅7通过与工作分支7a49f67；本文不把冻结as-of文字当作后续运行状态。依照委派限制，只进行了rg/cat静态读取及本独有/tmp报告写入，没有Node、Simulation、test/build、GPU、ZIP、Library或共享编辑。

## 结论

actual14已具有可信基础世界、共享建筑碰撞几何、原子状态导入、完整金融/路线存档及局部方块编辑；没有建筑拆迁或路网改造的统一权威状态与发布事务。基础 `world` 在类型上可以被修改，但现运行结构依赖其稳定。直接在现对象上push/splice/改坐标，或随后把constructor旧fingerprint继续写进save，会让交通、碰撞、画面与恢复读取不同城市，不能作为可变城市实现。

已有施工劳动和灾害反馈应保留：公司扩张确实消费现场劳动/材料并增加company.level；山洪确实扣资源、伤健康、延班次。这些不能称为楼体扩建、空间灾损、封路或拆迁已完成。最新用户追加是完整范围要求，本报告的单例增量不替代医疗/科研修复，不创设固定开发阶段，也不借未来地图adapter取代子系统。

## 权威数据与目前变化边界

| 已有机制 | 实际行为与证据 | 对新范围的边界 |
| --- | --- | --- |
| 基础WorldDefinition | `src/types.ts:23`含districts/buildings/nodes/edges/地形；`src/world.ts:428`按受支持layout+seed生成；`src/main.ts:31–35,69`把同一world交给Simulation、Renderer、Controller | 没有city revision、动态楼/路生命周期、几何变更清单或事务 |
| 动态SimState | `src/types.ts:34`存人、车、商铺、模块、signals及voxels | 没有建筑状态、路段关闭/新增状态、拆迁工程/资产登记模块 |
| 玩家build/demolish | `src/simulation.ts:1550–1558`检查本人住所/经营控制及4米范围，增删0.2m `state.voxels`、耗/回收block；存档1631验证4096个方块；`src/main.ts:384–396`绘制它们 | demolish只拆“你放置的体素”，没有删除基础楼、基础门墙、道路或土方 |
| 公司施工 | `src/simulation/extensions.ts:250–258`从具名wage-earned现场分钟消耗劳动，完成后company.level++与construction-completed事件；290–295为扩张资格/资金/冷却/已有任务检查 | 不是world建筑尺寸、楼层、占地或路网变化；不能凭等级称实体楼扩建 |
| 灾害反馈 | `src/simulation/extensions.ts:117–127`山洪改变城区能源/繁荣/污染、水质、健康与stress，有限公共救灾采购，并延vehicle.nextDeparture；132统一按stormRisk乘车辆speed | 没有火灾/地震空间破坏、楼/路损坏状态、实际封路、疏散修复；消息文字“道路受阻”或全车速度乘数不等同局部通行图改变 |
| 保存与分区 | `src/simulation.ts:1562–1565`保存完整state/runtime/routepool；`src/persistence/partition.ts:25,88`未知扩展字段可无损留global；`src/persistence.ts:173–179`原子提交各分区 | 储存能够运送新数据，不代表未知城市字段有验证/生效/空间投影合同 |

`Simulation`的 `private readonly world` 只保证引用不被重新赋值；`worldDefinition`在 `src/simulation.ts:599`返回原对象。没有在运行基础world上统一freeze/代理，源码查到的freeze主要用于区块描述和保存会话快照。这是实现约束，不是已开放任意world mutation的承诺。

## 几何与渲染缓存：有局部守卫，没有统一revision

1. **地形/基础建筑空间索引。** `src/world.ts:38–76`的WeakMap以World对象身份缓存。building buckets、quarter nodes只在首次indexFor创建；edge按indexedEdges计数追加。新增尾部edge可进入这一层，但删edge、同长度替换、改polyline或移动/删除楼不会统一重建。旧bucket还会持有被删楼和原segment端点；building移远后新位置缺bucket。`landHeights`也驻留在同一index（353）。这不是支持路网编辑的完整增量索引。

2. **共享建筑body。** `src/architecture-floor-plan.ts:209–222`比较宽深高、楼层、旋转、位置、kind等值及footprints/uses/permissions数组引用，能重做部分body。嵌套footprints/用途/权限原地编辑只保持数组引用时，不能靠该检查统一发现。wallPanels（243–259）和slab（262–266）按FloorPlan身份缓存。后续nearPlans/localSolids/supportFootprints确实检查成员、部分高度及rect坐标（275–331），不是完全忽略变化；但这维护的是已返回派生数据的既定可变行为，不是城市楼体编辑revision。`tests/floor-plan-derived-cache.test.ts:6,21,32,45,54,63`正明确隔离检验这些geometry query，可读测试名称不能证明全城变更可用。

3. **路栏共享缓存。** `src/transport-geometry.ts:22–29`按world和edgeCount缓存，已有 `invalidateTransportGeometry(world)`（25）。相同edgeCount下的坐标/顺序/连接变化须显式invalidate；搜索生产调用仅得定义。此函数只清路栏layout，不能清world地形索引、Sim交通图、Controller柜台或Renderer。

4. **原生body与规划柜台。** `src/controller.ts:34,39–40`在constructor建立整城marketCounters；`src/journey.ts:23–27`另有WeakMap worldCounters；`src/rendering/market-goods.ts:9–15`以基础market建立柜台Map和实例容量。基础店址/用途改变须三者同一revision重建，否则可见柜台、body阻挡和planner不同。

5. **静态渲染。** `src/renderer.ts:235–254`初始化detail/counter/车辆容量、区块及全城far模型；`buildNetwork`（592–637）初始化边Map、道路/桥/站点网格。near residency虽按距离创建和释放（253–275、767–773），区块成员/边界由 `src/rendering/chunk-residency.ts:26–50`一次生成；重建近景不能消掉旧far楼或重算旧区块边界。detail manager的缓存条件只有camera/quality/interior和floor（`src/rendering/architecture-detail.ts:400–419`），没有asset geometry revision。terrain的heightCache按frame释放（`src/rendering/terrain.ts:288–327`），但已生成coarse/fine mesh不会因此自动反映楼/路修改。

因此，不能把“有一个路栏invalidate”或“支持返回的FloorPlan成员修改”推广成整城随时可编辑。也不能仅在3D隐藏楼体而保留碰撞/路图和生活地点。

## 交通图、活跃路线和实体引用

- `src/simulation.ts:83–109`在构造阶段建立buildings/edges、nodeAt、doorNodes、neighbors、freightCarriers，并记录fingerprint。没有受控城市变更入口重建这些structures。扩展还捕获原world及building Map，例如 `src/simulation/extensions.ts:40–42`；只给主Simulation换数组也不会更新这些闭包。
- `walkingTree`（732–740）缓存源node的Dijkstra tree，`nodePath`（742–749）和building route（786–790）缓存实际points；key没有几何/通行revision。`floorPlanRoute`（1322–1328）只在无voxels时缓存，不包含楼revision。追加路也许进入地形index，但不会加入Sim neighbors或清旧Dijkstra，所以不同系统可能给出不同可达结果。
- 车每tick用 `this.edges.get(vehicle.edgeId)!`（653），到节点按neighbors选下一路（706–709），位置按polyline进度生成（633–638）。删除当前edge会留下非空断言与ride/freight引用；不能直接删除车来消除断引用，车上乘员/已付票/货主FIFO/驾驶状态仍属于真实资产。
- NPC已有路线是坐标列表；`moveCitizen`（910–915）直接沿route坐标插值，并不每步重新做controller式碰撞或闭路检查。删楼/封路后只清planner缓存不足，已在走的路线继续穿过旧路。`walkingAnchors`（768–771）还复用已有route接nodeAt，变更需从当前真实同层位置重新接图，不能传送到“最近新node”。
- 纯journey planner每次由world边重新建图（`src/journey.ts:150–169`），而Sim有驻留图；若只修改world，会得到“界面建议新路、NPC仍旧路”的分裂。其worldCounters仍驻留。`src/simulation/journeys.ts:56–64`的保存验证检查target/stop/edge/vehicle引用，却没有graph revision。
- home/work/destination、shop.buildingId、player.homeId、薪资workId、公预算siteId、clinic/homeRest/session、家庭搬迁和遗产、航空停机位等都有基础楼引用。导入只接受现known IDs，例如 `src/simulation.ts:1608,1610–1615,1642,1688,1738–1742`。拆掉有租客/工人/患者/订单的楼，不能靠把world.buildings.splice后原Save API自己解决；必须疏散、合同/债权/货物去向与历史ID保留有明确原子决定。

## 保存身份不能沿用为已改变几何的身份

`savedWorldFingerprint`（`src/persistence/world-layout.ts:7–41`）覆盖基础building几何、nodes、edges；v3增加地形，v4增加真实楼层body/用途/ACL。旧版本hash配方被明确保留。`selectSavedWorld`（45–61）只接受由支持代码recipe重新生成且fingerprint匹配的world，忽略导入json中的world/layout/geometry标签。`src/main.ts:357–373`跨已知布局保存候选后reload以统一渲染/碰撞，而非原地热变更。

当前Simulation只在constructor108计算一次fingerprint，export1565一直输出它；若随后外部修改原world，输出不是当前实际几何的身份。重新计算成新fingerprint也不足：selectSavedWorld仍不能重新生成那座自改城市，启动会拒绝未知布局。没有新增保存的几何变更数据，修改后的楼/路本身也没有进入state/runtime。

路线pool（`src/persistence/route-encoding.ts:11–23,36–81`）只共享坐标及验证页/引用/数值，不表达某point属于哪条当前路或什么城市revision。import在 `src/simulation.ts:1595–1596,1608`验证point属于位置范围，不证明它仍可通行；这在原静态world合同下正常，但不能借它为新几何的旧路线背书。

未来可采用“原可信recipe身份 + 经过验证的city delta/operational state + 显式有效geometry/graph revision”的合同：旧fingerprint仍只表示未改base；新版存档额外验证完整有效城市，不冒旧fingerprint是修改后几何。几何操作从代码拥有的模板/合法坐标/稳定新增ID生成；不能允许一个untrusted save.world绕过受支持配方。旧存档无新模块应保持原字节/原几何，首次真实变化才显式materialize新模块。新模块必须加入manifest/原子validator与load hooks，不靠partition未知字段透传就算已支持。

具体几何变化须保存**versioned CityPatch**，不是进程里悄悄改World：记录patch schema版本、base recipe/fingerprint、单调revision、稳定operation ID与顺序、actor/审批/完工clock、被改实体ID和precondition、代码拥有的模板参数/有限坐标与连接、新增ID/tombstone、有效geometry hash及对应资产工程回执。恢复先重建原可信base，再完整验证并按版本解释patch，最后构造candidate有效城市/索引/图，全部通过才发布。baseFingerprint或revision相同不能授权不同patch；不能只存一个自报hash而没有可重建的实际操作数据。资金/材料/劳动/安置实际回执仍是权威子系统状态，不能由几何patch凭空发钱/销债。

## 一个最小、可独立评审的下一增量候选

主审当前的固定noncompany shop挂牌、有限付款取得经营权、保shopId承接债务/寄售、现场劳动/采购恢复候选可保持基础geometry不变；该经营增量不需要借新建筑指纹。本文不要求先做路网替代它。若开始实施本子任务中的通行变化，**既有公共路段的具名检修订单与关闭准入/修复恢复**是一个可独立评审的候选实例。它不增加/删基础node/edge，也不冒全部拆迁、新铺路、灾害或产权生命周期完成；它能验证“权威状态确实改变通行”所必需的合同。不是固定优先顺序，也不替代当前医疗科研工作。

- 权威可保存记录包含路段ID、状态/原因、发起actor与身份、合法审批、有限资金/材料/实际具名劳动、开始/完成clock与graph revision；由现十阶段钩子更新并发事件，3D/2D/文字从同一记录读结果。
- 关闭必须先禁止新路线与新进入，已有车/人可沿实际所在可用出口安全退出或明确等待；不得删乘客/货物、变速补偿、传送或虚构到站。闭路快照需被main/controller交通准入、NPC/车辆、journey planner共同读取。原线路几何保留，施工实体与阻挡采用同一权威边界。
- graphRevision变化须清相关tree/route/门接图，给活跃route保存其生成revision并在继续推进前合法重规划。只clear全体路径会丢路上位置/临床/上班承诺；应保真实脚点、原目标和不可达明确状态。旧存档没有revision不能在load时补走或改原save字节。
- 完成来自实际有限劳动/物料与审批，恢复准入与路图，不从随机消息自动完成；新revision原子验证并正确保存/恢复。

真正新增道路或拆迁楼体随后仍须受控**candidate effective world**事务：验证code-owned几何和所有引用、占用/安置/ACL/材料资金合同，构造对应几何index/图/柜台及受影响渲染资源，再在明确边界一次公布同一revision。可以从完整重建有效投影起步求正确性，但不能重新初始化Simulation而重置RNG/资金/居民或丢订单。删除实体宜保留不可复用tombstone历史ID；有占用或未安置/未转移义务则拒绝执行，不能把拒绝的拆迁描述为完成。路标、门牌和灾损网格只是该事务的读者。

## 后续有意义的回归判据（本次未运行）

1. 关闭订单因余额/材料/权限/在场分钟不足失败时，完整save不发生部分扣款、部分封路或revision增长；完成和取消各只有一次真实结算。
2. 同一关闭状态：3D障碍、controller、NPC graph、live vehicle、journey suggestion和文字状态一致。已在路上车/人不传送，车上人数/车票/货物/FIFO与实际当前位置连续；新route不走关闭路。
3. primed缓存后增/删/移楼与同edgeCount改polyline的candidate：有效支撑、柜台、墙/路栏、terrain及near/far几何都对应新revision；旧snapshot仍保持原物理查询。不能只测一个invalidate函数。
4. 删除有居民、工资债权、货权、患者、休息或停机订单引用的楼先被原子拒绝；合法疏散/义务转移后才允许，不删除有限钱货以消除问题。
5. base geometry hash与delta/有效geometry hash不一致、未知新增ID、伪造审批、失效route revision、dangling rider/edge/site都原子拒绝，旧live状态与原world/资源保留。
6. 新城市变更fullsave导入/分区组装逐字一致，后续24tick对相同完整输入逐步exact；旧legacy/v2/v3/v4保存不获新楼/新路或新marker。原 `tests/world-layout.test.ts:137,151,169,201,216`与route编码边界合同不得被放宽。

以上都是只读静态候选和判据。可变城市模块、统一revision、建筑拆迁/新铺路事务、空间灾损修复尚未实现或验证；actual14生活/零售结果不能替代这些完成证据。
