# 独立 MZ `rpg2d-v1` 空间合同建议

状态：**计划 / 未实现**。本组只读最终 root05 源码，未改核心、MZ、适配器或存档，未运行构建、测试、浏览器或模拟。现有 3D 与兼容桥保留。本建议不表示已完成业务抽离，也不表示 MZ 已接管 NPC。

只读基线：`/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source`。下文路径和行号均指该冻结目录。`SOURCE-READONLY-BEFORE.json` / `SOURCE-READONLY-AFTER.json` 记录本组实际观察的 64 个文件及 SHA；它不是全仓库或 MZ 项目审计。

## 结论与当前实际边界

已有经济、身份、库存、关系、需求和固定时钟规则可作为共享业务的来源，但 `Simulation` 目前没有可替换空间上下文。业务状态和空间状态仍混在同一类型、同一读档合同中：[src/types.ts:28](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/types.ts:28) 的功能点含 `floor/Vec3`，`:29` 的建筑把经营权限与实体几何放在一起，`:35` 的居民同时持有钱、需求、XYZ 路线，`:40` 的玩家同时持有库存、身份和 XYZ。

现有 `CitySession` 不是独立 2D 权威。[adapters/rpg-maker/bridge.ts:24](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/adapters/rpg-maker/bridge.ts:24) 明确 MZ 瓦片坐标不写核心，`:29` 持有 `HeadlessWalker`，`:88` 用旧 walker 实走，`:104` 再把合法 3D 身体写回核心；`:158` 调用原 3D 寻路。它适合保留为旧兼容候选，不能直接称为本次批准的 `rpg2d-v1`。

独立版本应共享业务规则、稳定业务 ID 和明确定义的业务状态结构；它有自己的空间状态和存档。共享不意味着两个运行中的 3D / 2D 核心同时写一份账户，也不意味着旧完整存档可直接导入。

## 权威分工（拟定）

| 范围 | MZ / 新 2D 空间提供者 | 云山共享业务核心 |
| --- | --- | --- |
| 地图 | 地图、层、瓦片、门、门户、室内区域、实际通行图、碰撞体、地图改动 | 建筑 / 店铺 / 家庭 / 区域的稳定业务 ID、设施类别、用途与经营关系 |
| 行动 | 从实际位置寻路、每段真实长度、碰撞与阻挡、路径游标、跨地图与交通站位 | 行动意图、存活与身份、需求、日程、模式许可、每 tick 可用分钟与速度预算 |
| 到场 | 实际到达锚点、合法区域、占位、真实到场时间和可用活动窗口 | 消费、工资、出勤、诊疗、教育、研究等按有效窗口结算；拒绝重复或超预算凭据 |
| 交通 / 航空 | 实际载具位置、路径长度、碰撞 / 停靠 / 进近 / 出口、乘员空间绑定 | 资格、票款、容量、租约、公共账本、天气 / 能源政策、库存与计费 |
| 改造 | 校验新布局和碰撞、路网连通性、空间 revision 与受影响路径 | 产权 / 租约许可、材料、现金、施工任务与规则；共同原子提交 |
| 保存 | 地图身份、实际位置、路径相位、占位和地图增量 | 业务状态、时钟 / RNG、ID 引用、未消费窗口；共同原子恢复 |

MZ 的事件编号只是表现绑定，不应直接作为居民或店铺身份。清单应为 `actorId/siteId/anchorId/vehicleId/edgeId` 分配稳定逻辑 ID，并显式映射到 MZ map / event / layer。重新布图或重新排序事件不能创造新居民、重置钱或复制库存。区域 ID、设施用途、床位 / 服务台等锚点和权限区域也要在清单中声明；不能从贴图外观推断。

地图清单同时声明当前支持的交通、航空、施工等能力。尚未提供实际空间实现的能力应返回具名不可用原因，不能用远程菜单、假位置或立即到达补齐。能力缺失须报告为未实现，不得从地图上删除设施后宣称完整目标已完成。

`floor` 在当前代码中兼有物理 Y 和权限语义。新合同用逻辑 `zoneId/layerId` 绑定权限，不伪造 Y 高度。MZ 负责其真实瓦片身体和通行规则；无需把原 3D 的 `.35m / 1.72m` 身体硬塞给二维地图。量纲仍须明确，保持真实距离、时钟和业务预算。

## 最窄 `SpaceContext` 草案（未实现）

先协调一个具名接口，不同时重写所有系统。位置是有标签的空间位置，禁止把 MZ cell 坐标塞成 `Vec3` 去哄原核心通过。

```ts
type Rpg2dLocation = {
  kind: 'rpg2d'; mapId: string; layerId: string;
  cellX: number; cellY: number; offsetX: number; offsetY: number;
};
// 示例签名，尚未添加到任何生产源码。
interface SpaceContextV1 {
  readonly kind: 'rpg2d';
  readonly contextId: string;
  readonly manifestFingerprint: string;
  readonly revision: number;
  readonly metresPerCell: number;
  observeActor(actorId: string): Rpg2dLocation;
  siteAnchors(siteId: string, purpose: 'work' | 'service' | 'sale' | 'rest'): Anchor[];
  requestRoute(intent: RouteIntent): RoutePlan | Blocked;
  advanceActor(request: TimedAdvance): TimedSpatialReceipt;
  observePresence(request: PresenceRequest): PresenceWindow | Blocked;
}
```

上述 `Anchor/RouteIntent/TimedAdvance/Receipt` 必须一起协调，不能只加一个 `isNear=true` 回调。至少携带稳定 actor / site / anchor / route ID、地图清单身份、空间 revision、模式、路线游标与实际位置、业务 tick / 时钟、请求分钟、已用距离和移动分钟、实际到场时刻、剩余分钟、阻挡原因、观察区域 / 占位。收据只有经过该版本提供者实走并被核心校验后才可消费，不能接受随意传入的 `arrived` 布尔值。

路径计划是意图，不能授予到场收益。核心先校验 alive、身份、设施目的和可用时间，MZ 执行实际运动，核心验证绑定与预算并消费一次结果。拓扑变化让旧计划失效时，从当前位置重新寻路；如果不能走，保留受阻意图和实际位置，活动窗口为零。跨地图传送、楼梯、升降、出入口不能被计作零耗时的到场：清单必须声明其真实距离 / 过渡时间与合法终点。瞬时换场显示可以存在，但逻辑行程仍消耗明确预算。

核心每个固定 tick 只有一个时钟和一份分钟预算。新 2D actor 不再由原 `moveCitizenPhysical` 同时驱动；MZ 也不在帧回调里重复结算工资和需求。离屏居民保留稳定身份并按同一空间图计时；较低频只累积实际分钟，不能缩短路程、调快速度或重生补钱。

## 实际距离、到场分钟与业务窗口

原基线 [src/simulation.ts:795](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:795) 是每固定 tick `.25 * speed` 分钟；`:1543` 决定更新频率，`:1548` 累积跳过的实际分钟。原 native mover `:1478` 使用雨天 3.1 / 常态 4.2 米每城市分钟，`:1509` 抵扣真实路径距离，`:1529` 返回未花掉的 `movement / speed`。2D 是否使用另一明确速度是该独立版本的规则决定；不可静默把瓦片 / 帧数当成这些量纲。

2D 接口应积分每段真实路线长度，包含绕障、跨地图过渡和载具路径，并在 `usedDistance <= speed * travelMinutes` 等明确预算约束下推进。若行程未完成，活动分钟为零；完成后只能给 `requestedMinutes - actualTravelMinutes`，且活动窗口不能早于真实到达。ETA 是基于当前真实路线 / 等候 / 运力的预测，不能作为已到场证明。

这直接影响现有 [src/simulation.ts:1636](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:1636) 的 `arrivedElapsed`、`:1654` 的出勤、`:1661` 的学习、`:1665` 的服务、`:1667` 的社交，以及 [src/simulation/clinical.ts:160](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/clinical.ts:160) 起的医患到场窗口。因此抽离 NPC 路由却保留原 XYZ 设施检查，或者只把核心 position 投影到服务台，都会改变业务结果。

未来验证计划：一名演员从实际起点走到一个店铺服务 / 销售锚点；证明阻挡时不扣不存在的消费、不授到场分钟，抵达时距离和预算精确结算；不同频率 / speed 下不改变速度规则；再接教师、医生、研究员的重叠窗口。此组未运行这些验证。

## 必须处理的真实依赖

| 依赖 | 实际源码证据 | 独立 2D 的处理方向（全部未实现） |
| --- | --- | --- |
| 初始化 / 空间索引 | [src/simulation.ts:137](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:137) 构造参数是 `WorldDefinition`；`:141` 创建 `NpcStairMotion`；`:142` 节点 XYZ key；`:143` 门绑定最近节点 | 新 2D 清单提供业务目录与独立地图绑定，不能造一份扁平 3D WorldDefinition 假装完成抽离 |
| NPC 目的地与路由 | [src/simulation.ts:1112](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:1112) 起的目的地 / 功能点规划；`:1399` mover 分支；`:1492` 原 native describe；`:1482` 实际受阻等待 | 意图留核心；路由、游标与步进切到同一个 MZ 空间提供者 |
| 设施邻近 / 权限 | [src/simulation.ts:1976](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:1976) 邻近建筑；`:1996` 真实支持；`:2012` 功能点；`:2029` 玩家设施筛选 | 按 site / purpose / zone / anchor 的具名 presence 窗口，不按 XYZ 半径造近邻 |
| 医疗 / 教育 / 科技 | [src/simulation/clinical.ts:55](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/clinical.ts:55) 实体站点；`:160` 到场窗口；`:204` 医患交集；[src/simulation.ts:1661](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:1661) 教育活动；[src/simulation/power.ts:71](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/power.ts:71) 身体 / 工作点 | 学校、病床、科研和维修站点同样要 2D 实际站位；资格、钱和窗口重叠仍由业务核验 |
| 正式课程 / 科研劳动 | [src/simulation/education.ts:40](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/education.ts:40) 起同教室真实站位；`:219` 教师与学生窗口；[src/simulation/extensions.ts:158](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/extensions.ts:158) 起实验工作点 / 合法身体 / 已付薪窗口；[src/simulation/family-education.ts:135](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/family-education.ts:135) 起家庭教育到场 | 保留已付薪、教材、耗材、供电、资格与演员分钟分配；仅替换空间证明，不直接注入学时或研究完成 |
| 设施绑定 | [src/simulation/power.ts:60](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/power.ts:60) / `:61` 明确绑定 `core-main` 与 `core-energy-south` | 保稳定目录 ID 或显式版本化绑定配置；改地图不自动满足能源设施语义 |
| 需求 / 关系 / 家庭 | [src/types.ts:34](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/types.ts:34) / `:39` 业务结构；[src/simulation.ts:1551](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:1551) 起扣需求；[src/simulation/family.ts:551](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/family.ts:551) 起含实际同场家庭动作；[src/simulation/home-rest.ts:72](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/home-rest.ts:72) 起实际床位 | 共享规则但替换空间资格观察；床位容量和共同到场仍保真实限制 |
| 玩家消费 / 工作 | [src/simulation.ts:2083](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:2083) 工作点；`:2102` 销售；`:2117` 服务；`:2126` 租赁；`:2129` 银行；`:2152` 考试 | 所有空间业务门槛要走同一 presence 合同，不让菜单 targetId 越过实际到场 |
| 步行 / 通勤预测 | [src/journey.ts:65](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/journey.ts:65) 步行入口；`:148` 步行计划；`:167` 图搜索；`:179` 公交路径；`:230` 班次 ETA | MZ 网络决定真实可达性、长度、跨图和等候；预测和实际到场分离 |
| 交通车辆 | [src/simulation.ts:905](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:905) 沿 edge.length 推进；`:919` 实体轨迹；`:923` 实际到站事件；`:924` 乘员到站钟；`:2233` 上车；`:2240` 下车 | MZ 实走车辆 / 停靠与乘员同步；核心票款、许可、容量守恒；不能上车即到达 |
| 封路 / 施工退场 | [src/roads.ts:165](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/roads.ts:165) 剩余真实退出路径；`:182` 连续运动准入；`:204` 退出证据 | 拓扑 revision、合法退场与施工封锁由 2D 图表达，政策 / 修复费用留核心 |
| 航空 | [src/aviation.ts:55](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/aviation.ts:55) 实际近舱门；`:59` 军籍和驾驶；`:112` 租赁；`:126` 返航；`:131` 停稳退出；`:144` 补能；`:170` 起真实 3D 飞行 | 声明 2D 航空空间能力 / 轨迹 / 进近层后再接；仍是城市中获取、登机、驾驶、返航、退出的规则，不能独立菜单瞬时完成 |
| 建造 / 拆除 | [src/simulation.ts:2249](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:2249) 所有权；`:2251` .2m XYZ 网格；`:2254` 材料和4096上限；`:2255` 回收 | 新 2D 格子改造合同必须明确材料单位 / 容量 / 产权 / 碰撞 / 图更新；不直接把 cellX/Y 当原体素坐标 |
| 完整存档 | [src/simulation.ts:2264](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:2264) 原格式 + 世界指纹 + 原路线池；`:2281` 格式身份；`:2284` 原 native 游标；`:2511` 真实路线绑定；`:2523` 原子安装 | 全新 2D 标签与空间游标验证；旧 native 几何守卫保留，不删它来让 2D 文件读入 |
| 选世界 / 分块 | [src/persistence/world-layout.ts:54](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/persistence/world-layout.ts:54) 只认原 v1/v2；`:61` 信任世界 recipe 指纹；[src/persistence/partition.ts:57](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/persistence/partition.ts:57) XYZ 分块；`:144` 原路线编码恢复 | 新 2D manifest / map / logical chunks 和独立装配器；原文件保字与拒绝合同不改变 |
| 旧 MZ 桥 | [adapters/rpg-maker/bridge.ts:163](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/adapters/rpg-maker/bridge.ts:163) 包装原 coreSave；`:179` 选原 3D 世界；[adapters/rpg-maker/headless-walker.ts:164](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/adapters/rpg-maker/headless-walker.ts:164) 起实际 3D 碰撞 | 保旧兼容候选；新 MZ session / save reader 单独实现，不能把旧桥改名作新实现 |

这里列的是已确认的接入依赖，不是全仓库穷举。教育、研究、财政、卫生和其他事件消费者还需要在正式抽离组逐一验证；本组没有宣称所有业务都已与 geometry 解耦。

独立只读复核见 `review-own/REPORT.md`，含 NPC、工资、医患、教师 / 学生与研究的详细行号及 12 件源文件 SHA。其建议名 `CitySpaceAuthority` 与本文件的 `SpaceContextV1` 指同一个待协调的空间权威边界，不是要求再引入第二套接口。名字和 DTO 最终由接入组统一。本组未读取私有 MZ ZIP，未审其实际表现插件。

## 独立 2D 保存建议（未实现）

建议标签示例：`format: 'yunshan-rpg2d-save'`, `version: 1`, `simulationContract: 'rpg2d-v1'`。最终字面名称由 MZ 接入组协调；此例没有写入现存 parser。

档案应同时带业务 schema、`worldId`、完整 MZ 清单 fingerprint、空间 revision、稳定 ID 绑定、核心业务状态 / tick / clock / RNG、MZ actor / vehicle 位置与游标、地图改动、占位，以及尚未消费的时间窗口 / 队列。纯存档标签不足以证明几何身份，必须校验 map / portal / anchor / 路径 / revision 的一致性，拒绝 NaN、错 actor、删游标、超预算、重复收据和不存在的设施引用。

读入时先在临时对象中验证核心业务和 MZ 空间，再共同原子安装；任一失败时保留原运行状态。分块保存应按 MZ map / region 和稳定业务归属组织，并重构出相同完整代际；不能用原 XYZ 分块 codec 隐式变换坐标。writer 导出的正常受阻意图必须可以读回，但它仍受阻、不能凭读档领工资或改变到场。

新 2D reader 应拒绝旧 `yunshan-save` 与旧 `yunshan-mz-save` 直接载入；原 reader 保原 v1/v2 行为并拒绝新标签。旧 3D 档保留原件和兼容候选，不作静默迁移。将来需要迁移时另开明确迁移合同：业务账户、死亡状态、库存和引用逐项核算，空间游标不能复制为 2D 游标。不能借失败 fallback 开新游戏并发钱。

## 下一步唯一协调入口

先让独立 MZ 组和业务抽离组共同冻结 **`SpaceContextV1` 的锚点 + 实走 + 到场窗口收据**：一名 actor、一个店铺、`sale/service` 锚点、明确地图单位和一次固定 tick 的真实预算。MZ 给地图 / 碰撞 / 路径；业务组给 stable ID、分钟和交易规则。以这一个垂直切片证明路径、邻近、钱物和存档闭合，再扩到工作 / 医疗 / 学校与交通。

当前阻碍是生产核心仍持有并验证 `WorldDefinition/Vec3`，不是缺一张更好看的贴图。下一实施组需要新独立 session / schema 与受控业务门槛接入；不得同时修改本轮已 CLOSED 的 3D 核心来凑新版本完成。路线审计、连通性、电网和设施缺失分析可在清单之上后续开发，本组不把它们算成已实现。

## 本组运行与交付事实

只执行读取、行号检索、文档写入与 SHA 观察。没有测试结果、性能数字、MZ 升级、代码变更、提交、推送、浏览器或 Library 上传。本组为父任务内部独立文档组，不混入既有 29 组 CLOSED 原件；父任务若另行上传 / Git 收录，应采用本组 manifest，并返回其实际结果。
