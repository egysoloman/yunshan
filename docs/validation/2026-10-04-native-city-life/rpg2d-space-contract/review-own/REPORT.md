# rpg2d-v1 空间合同只读审查

状态：**PLANNED_NOT_IMPLEMENTED（规划，未实现）**。审查根源为 `ROOT09-root-production-candidate05-20261004-01/source`。本次仅读取代码、记录行号和 SHA256；没有运行测试、CPU 模拟或浏览器，没有修改任何 source/CLOSED，也没有 Library、提交或推送。

结论：当前无渲染运行可以继续使用现有 3D 城市系统；**独立 MZ 地图尚不能成为空间权威后直接复用未改动的 Simulation**。阻碍集中在 NPC 的 Vec3 路线/身体游标、通勤到达、各服务的真实用途点/分钟、以及绑定可信 3D 世界的存档恢复。经济、身份、库存、需求等业务的 ID 与结算语义可以沿用，但需要在这些明确边界接入原生 2D 空间依据。

## 精确依赖清单

| 路径 | 源码与行号 | 当前合同及复用边界 |
|---|---|---|
| 共同实体合同 | [src/types.ts:28](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/types.ts:28) L28–40 | 用途点、建筑、道路、NPC、玩家均含 Vec3；资金、身份、库存、需求与 actor/home/work/shop/district IDs 可共享语义，但这些整条实体类型尚未抽离空间。 |
| 唯一时钟 | [src/simulation.ts:790](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:790) L790–798 | 每固定步由同一 Simulation 推进 .25×speed 游戏分钟，并按原 phase 顺序分发；2D 宿主不能额外推进第二份时钟。 |
| deferred tier | [src/simulation.ts:1532](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:1532) L1532–1555 | active/regional/statistical 以 1/4/16 频率处理；peopleElapsed 累加每个真实 tick，任务提升频率但保留实际积压。需求衰减用 elapsed，不允许按当前 tier 反推时间。 |
| 目标与合法进入 | [src/simulation.ts:1112](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:1112) L1112–1152；[src/simulation.ts:2017](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:2017) L2017–2027 | 目的地绑定原建筑用途点/楼层权限，调用真实 floor-plan 路线并缓存 Vec3 路径；独立 MZ map/link 目前没有接入口。 |
| NPC 身体与路程 | [src/simulation.ts:1473](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:1473) L1473–1530；[src/simulation/npc-stair-motion.ts:345](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/npc-stair-motion.ts:345) L345–383 | 移动预算=实际游戏分钟×速度，按真实 3D 段/楼梯长度扣除；封路、墙、支撑、体素会阻止前进。到达才返回剩余可在场分钟；不能把瓦片位移投影成假 XYZ。 |
| 物理游标 | [src/simulation/npc-stair-motion.ts:325](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/npc-stair-motion.ts:325) L325–343 | 游标严格绑定建筑、routeIndex、原 from/to、piece/offset 与身体相位；它不是可移植为 MZ tile 的路径进度。 |
| 公交/通勤 | [src/simulation.ts:1582](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:1582) L1582–1596；[src/simulation.ts:1629](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:1629) L1629–1636 | 乘车中的时间先衰减需求；真实 arrivedAt 之后才可步行/在场。公交扣有限现金 4，并绑定原 vehicle/edge/stop IDs；不能换地图后免费到场。 |
| 到场与用途 | [src/simulation.ts:1638](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:1638) L1638–1669；[src/simulation.ts:1976](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:1976) L1976–2015 | 活动需实际合法休息/工作/服务点。near-building 与 at-function-point 依据原高度、楼层、支撑、距离及权限；presence 查询必须与新的空间权威共同替换。 |
| 出勤/工资 | [src/simulation.ts:263](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:263) L263–294；[src/simulation.ts:1652](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:1652) L1652–1654 | 只登记真实 arrivedElapsed，经班次/雇用/480 分钟上限截断；原核产生冻结 wage-earned 与 credited front interval，资金来源仍由核心核算。2D 不应直接发工资事件或伪造 working。 |
| 科研劳动 | [src/simulation/extensions.ts:158](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/extensions.ts:158) L158–234 | 研究依赖原实际实验楼层、支撑、净空、体素和 work 点；现场已付薪窗口、供电、资格、需求与同一 actor 分钟分配器共同限额，多个课题不得重复占用窗口。 |
| 医疗现场 | [src/simulation/clinical.ts:55](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/clinical.ts:55) L55–98；[src/simulation/clinical.ts:160](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/clinical.ts:160) L160–222；[src/simulation/clinical.ts:254](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/clinical.ts:254) L254–264 | 医生和患者需同一实际公共 service station；患者到场窗口与医生实际工资窗口求交，且验证当前 tick/clock/position。并发槽位与 actor 时间预算继续由核心限制。 |
| 教育现场 | [src/simulation/education.ts:40](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/education.ts:40) L40–83；[src/simulation/education.ts:219](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/education.ts:219) L219–231；[src/simulation/family-education.ts:66](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation/family-education.ts:66) L66–68、135–144 | 同教室真实用途点、楼层、碰撞/支撑；教师已付薪窗口、学生实际到场窗口、开放时段、供电、教材与有限槽位共同决定学时；saved timer/普通事件不能直接获学位。 |
| 完整存档 | [src/simulation.ts:2260](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:2260) L2260–2285；[src/simulation.ts:2503](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/simulation.ts:2503) L2503–2524 | 当前 yunshan-save v1/v2 绑定原 seed/fingerprint、state/runtime、Vec3 routePool、native cursor 与 peopleElapsed；所有引用/几何检查完成才原子替换。旧 3D 档不能直通独立 rpg2d-v1。 |
| 分区 | [src/persistence/partition.ts:19](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/persistence/partition.ts:19) L19–29、50–78；[src/persistence/partition.ts:101](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/persistence/partition.ts:101) L101–126 | 现分区按原 X/Z 每 256 米归属，整代无损分解/重组，保留原数组索引与 maps/路线编码。它没有 MZ mapId/layer/link 权威或空间迁移职责。 |
| world selector | [src/persistence/world-layout.ts:10](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/persistence/world-layout.ts:10) L10–45；[src/persistence/world-layout.ts:49](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/src/persistence/world-layout.ts:49) L49–65 | 指纹含真实建筑/道路/地形/楼层碰撞与用途权限；只重建代码拥有的 CITY_LAYOUT_VERSIONS。存档写一个新地图标签不能授权替换几何。 |
| CitySession 旧适配 | [adapters/rpg-maker/bridge.ts:24](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/adapters/rpg-maker/bridge.ts:24) L24–50、79–105、154–183；[adapters/rpg-maker/headless-walker.ts:163](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/adapters/rpg-maker/headless-walker.ts:163) L163–205 | 仍 createWorld→Simulation→HeadlessWalker，受原 3D 碰撞许可后回写 body；导航仍原 walking/transit。桥接包保存完整 coreSave，并经原 world selector/validator 恢复，不是独立 2D 权威。 |

## 仅一个建议的下步协调接口

**`CitySpaceAuthority`，`spaceKind: 'rpg2d-v1'`（尚未实现）。** 这是同一核心时钟调用的空间协调边界，不是另一套居民经济模拟。其职责限于以下同一个合同：

- 输入核心已有的 actor/site/servicePoint/district 等 ID、身份与活动目的，以及本相位实际 start/end/tick 和该 actor 的可用分钟；独立 2D layout 持有自己的 `mapId/layer/tile-or-subtile pose`、可用地点/入口/连通 link 与碰撞版本，不写假 `Vec3` 给现有几何 guard。
- 依据原生 2D 可通行/门/占用/封路/地图切换与可访问地点生成和推进路径。声明 tile 尺度和速度单位，按实际路径段长度及交通等待/乘车/下车时间消耗预算；转场不免费传送，不用直线距离替代绕路/跨图长度。阻塞仍消耗真实经过的生活时间，不能产生在场劳动。
- 返回可核验的原生空间 pose/路径进度、可达或阻塞原因、具名 site/servicePoint 的合法 presence，以及仅完成到达后剩余的活动窗口。窗口须绑定同一 space fingerprint、actor/site/point、tick/clock；只能由该空间权威根据真实推进生成，表现插件不能随意注入“到场”或工资/学时。医疗/教育共同站点关系由同一原生地点绑定证明，不再拿旧 XYZ 两米半径猜测。
- 核心继续独占身份资格、需求、就业/班次、有限现金/财政、库存、订单/教材/医疗耗材、工资事件及跨活动分钟分配。只将现有 `move/presence → post-arrival window` 的空间依据替换为本合同；现有资金和时间断言保持。共享 ID 是显式业务绑定，不等于复制旧 3D 建筑坐标、楼层或 body/cursor。
- 同一个合同提供独立空间状态的保存/验证恢复：记录 `rpg2d-v1` 标识及代码认可的 layout/collision/topology fingerprint、actor 原生 pose/path/transit phase；与共同 core clock/RNG/peopleElapsed/账本/库存/任务一起原子恢复。拒绝旧 `yunshan-save` 3D body/route/cursor 直接导入此空间。若将来需要迁移，必须另行显式映射 ID 与空间状态，不能改标签后沿用旧几何恢复。

唯一建议的下一步是由核心 NPC/出勤侧与 MZ 空间侧共同确认并接入这个 `CitySpaceAuthority` 的 **实际推进→presence→post-arrival window** 合同；本报告没有实现接口、2D 地图、迁移、碰撞算法或额外子系统方案。

## 证据范围与限制

[adapters/rpg-maker/README.md:3](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/adapters/rpg-maker/README.md:3)、L54–65 标明旧桥接/浏览器产物属于历史冻结；不能把 candidate05 的源代码审查说成已重建或替换该产物。[adapters/rpg-maker/README.md:67](/workspace/yunshan-work/ROOT09-root-production-candidate05-20261004-01/source/adapters/rpg-maker/README.md:67)、L71–73 明确私有 MZ ZIP 未采用此 facade，两者兼容边界为原 canonical coreSave 和同一可信世界指纹。本 source 不含独立 MZ 表现插件；本次没有读取私有 ZIP，因而不声称审过 ZIP 内实际插件。

本报告不证明 rpg2d-v1 已运行，不包含 native-rules、build、browser、MZ 编辑器 GUI 或 macOS 验收结论。源文件完整哈希、字节数和引用跨度见 `SOURCE-CONTRACT.json`。以下两个关键源件实际核对为：

- `src/simulation.ts`：`9ab2fb0d8aa2dbc48a172d891724ab598cd19e733775e3d600541bd24808ad44`。
- `src/simulation/npc-stair-motion.ts`：`d15db069009834e47d153b3de0b0f6aebb87ab5a2e19d98e09bf6dcb4cb117e1`。
