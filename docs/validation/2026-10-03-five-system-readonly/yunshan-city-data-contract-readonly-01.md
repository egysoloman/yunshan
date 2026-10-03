# 新城市数据接入：只读契约审查

本报告供下一阶段规划与备忘录引用。当前先完成各子系统；本轮没有实现地图 adapter、CLI、编辑器或新 recipe，没有运行 Simulation、测试、构建、浏览器、地图生成或压缩。只读对象 `/workspace/yunshan`，HEAD `15550fd968023c4bd436a2f60022ff45d6c3d5da`；现有 dirty 修改保留。来源 SHA 与历史回执比较见同目录 provenance JSON；这是可变工作区的 as-of 审查，不是假定整工作区冻结的验收。

## 结论与边界

规则核心确实可以接受另一组城市数据，2D/3D/文字客户端可以读取同一状态；当前浏览器入口、初始化配置、地形算法、室内物理和保存身份仍有云山特定契约。`new Simulation(world)` 成功不等于该城拥有完整道路、电网、住房、教育、医疗、产业与自治闭环，也不等于这张地图能够由现有浏览器安全重载。

现有受信配方是五种：`legacy-ee3e7a1`、`current-v2-r5`、`current-v2`、`current-v3`、`current-v4`（`src/world.ts:5`）。保留四旧配方及 current-v4 的原身份；新城市将来应有独立注册的 map identity/revision，不能借用 current-v4 标签，不接受存档自带任意 geometry 作为权威。

## 当前实际约束

| 范围 | 当前行为及源位置 | 对另一城市的含义 |
|---|---|---|
| 纯模拟输入 | `types.ts:23` 的 WorldDefinition；`simulation.ts:102` 接受该数据。`simulation.test.ts:6–26` 是两区30楼自定义 fixture；`trade.test.ts:20–35` 是一区7楼。 | 已有源码及历史受控测试证明可使用非默认布局，不证明任意 GIS、真实高程或自然生活可直接导入。 |
| 最低结构检查 | `simulation.ts:103` 只先检查 districts/buildings/nodes 非空；随后生成 maps、最近 door node、无向邻接。 | 缺统一的唯一 ID、引用、有限数、维度、路段端点、图连通性与能力诊断。构造器不是完整 validator。 |
| 初始人口与经济 | `simulation.ts:108–112,157–186`：08:00、固定初始钱/需求/物料、NPC 数 `max(384,min(896,districts.length*56))`；角色由 kind/facility 推导。无 home/job 时会退用其他楼。 | district.population 不等于实际实体人数；缺住宅不能静默解释为合法居住。不同城市须显式初始化配置，避免小图意外生成384人。 |
| 商铺和车辆 | `simulation.ts:123–136`：market/workshop/farm/dock 非 facility 才成为店；fleet 由 edges 推导，短路段与 bridge 排除，部分道路依赖 `${building.id}-door`。 | 外形、名称不足以声明生产/服务能力；命名、长度和端点会影响车队、货运及保存实体集合。 |
| 步行连接 | `simulation.ts:728–789`：walk graph 只 road/bridge，权重使用 edge.length；入口与最近节点连接由系统推导。 | 交通图能连通不证明街道/入口之间可真实步行；必须检查门口接驳、支撑、坡度、身体净空与入口权限。其他 mode 不能当普通步行边。 |
| 室内语义 | `types.ts:18–19` 的 work/service/sale 与 ACL；`architecture-floor-plan.ts:216–239` 仅精确 profile 生成共享 bodies/use points，core-main/pavilion 保原路径；`simulation.ts:1301–1327` marker 分支需要真实 room/stairs 与合法功能点。 | 新图必须选受支持的物理 profile；未标记楼保旧 proximity 契约，不能拿小 fixture 证明新详细室内已可用。 |
| 床与容量 | `simulation/home-rest.ts:44–68` 派生真实床侧，身体盘半径 .35、支撑及室内路径；运行时另查权限、体素、live occupancy/预约。 | Building.capacity、侧点数量、home kind 数都不是可用床位数；诊断应按唯一 bed ID、可达权限与实际居民需求计数。 |
| 高程和水系 | `world.ts:91–149,185–240,244–277` 从 mountains、district terrace、道路/楼体等计算高度，不读取 GIS heightfield。瀑布雕刻仍有绝对 z 范围；quarter 节点、runway、core-lift-top 有 ID 例外。 | 替换平面坐标不能替换权威地形。真实地图需独立 height/ground profile，当前不能宣称任意地形 JSON 会参与碰撞。 |
| 物理单位 | `world.ts:11` 与 `simulation.ts:1553` 等实际 .2 量化；provider local y=楼基+.6，米单位，+Y 上，XZ 平面，rotation 标准 Y 旋转。 | 仅改 world.voxelSize 不会把全系统换为另一体素尺寸；输入需遵守当前 .2 lattice 与坐标契约，或未来独立版本迁移。 |
| 特例 | `access.ts:28` 仅 core-main 顶层公共例外；`transport-geometry.ts:5,13,35` runway ID 控制宽度/护栏；`aviation.ts:39–44` airport/starport kind 与首个 airport 派生设施。 | 要把能力写入结构化数据，不能靠新城市复刻云山字符串才能运行；旧 recipe 特例仍须保持兼容。 |
| 地图可变性 | `world.ts:39–76` 空间/高度缓存；transport 缓存以 edgeCount 判别，另有 invalidate API；provider 标量/数组引用缓存；home-rest 注明不可变几何。 | 运行中随手改同一 world/array 不受统一失效协议支持。动态体素有既有规则；地图编辑应产出新 revision，显式迁移后创建新实例。 |
| 当前浏览器 | `main.ts:24–35` readSave→selectSavedWorld→Simulation→Renderer，当前页面要求 WebGL；RAF/UI/Controller 是该客户端。 | 模拟与表现可分离，但完整2D/文字客户端、不同城市选择器并未由此实现。 |
| 存储槽 | `persistence.ts:6,21,154,197–215` 单个 yunshan-city 数据库和 autosave identity，保上一代恢复。 | 多城市应将 slot 与 world identity 明确关联；现有旧槽读取及恢复语义不动，不能因切图覆盖旧档。 |

表中行范围用于定位阅读，实际 as-of 文件 SHA 在 provenance。涉及时间/路径/费用/需求的规则必须继续实时判定，地图诊断不能通过移人、补钱、补粮、假床或改时钟修复报告。

## 新地图保存身份的缺口

`persistence/world-layout.ts:7–41` 基础 FNV 文本只有 seed、楼 ID/district/kind/position/door/宽高深/footprints、节点 ID/position、边 ID/from/to/mode/length/points。非 current-v3/v4 的自定义 World 不纳入 rotation/floors/basements、地形、水系、体素尺寸、function points 或 ACL。所以两个对模拟/碰撞意义不同的新图可能拥有相同现有指纹。这里是静态字段覆盖分析，没有生成碰撞样例，也没有修改旧 hash。

current-v3/v4 另加地质算法/地形/物理层；current-v4 另加真实 floor plans/roof regions/function points/ACL。即使这些受信配方也未显式把所有设施语义、capacity、district.kind/population、初始化人口/账户/车队配置写入身份。代码配方受控制是当前信任边界，不能把它推广成任意外来城市的完整身份协议。

`simulation.ts:1562–1611` 保存状态与 runtime，按 seed/fingerprint 和基线实体集合核对，并不导出权威 World；`world-layout.ts:45–61` 只重新生成上述五配方。`tests/world-layout.test.ts:142–165,216–234` 明确保留：外来标签/任意 geometry 不放宽保存身份，错误导入须原子拒绝。本轮没有重跑这些测试。

未来建议为 CityPackage 新增独立身份空间：`format/schemaVersion/mapId/revision/physicalProfile/data/initialization`，完整、规范化的 physical+semantic+initialization digest 另设版本，包含引用、地形、入口/功能点/ACL、facility/capacity、车队/人口等。保存只引用已独立注册且校验的城市包；先解析注册包再导入状态，不能通过一个存档自己授权自己的地图。保留五配方既有 FNV 文本、ID、baseline 和旧读取顺序；旧档继续打开旧城，迁移必须显式且原子。

## 将来最小数据和诊断契约（建议，未实现）

建议先做不运行城市、不消耗 RNG 的只读 `diagnoseCityData(raw, {capabilityProfile, geometryProfile})`，输出结构错误、静态能力、假设和证据层级，再由独立注册流程决定 trusted package。不能靠一个 `valid=true` 混淆 schema 与生活能力。

- **结构层**：有限米坐标/旋转、正尺寸、合法整数层数/地下层、受支持 .2 物理 profile、唯一 ID、district/building/node/edge 引用、边 points/endpoints/length 一致、数量不超过现有导入限制。必要结构错误明确阻断。
- **道路与身体层**：road/bridge 连通分量、spawn→入口真实接驳；门净孔、身体盘/头部、坡台/楼梯支撑、完整路径及逐层 ACL；交通可用 mode/站点/班次/换乘另列。抽样或 graph reachability 只标明相应证据，不称全真实行走已通过。
- **生活与供给层**：每户唯一床/合法床侧/预约容量、在服务窗口可达的 sale/food 库存来源、工业物料供应、老师/医生/公务人员的角色和工作地址、学校/医馆实际服务能力、金融/工业/物流入口。静态能提供点位仍不代表当时有人出勤或资金/库存够用。
- **能源层**：当前只可报告 aggregateEnergyRules，真实 power-grid capability 应标 `not-modeled`；不能把能源翼/光带/道路线当发电和电网已连通。
- **动态验收层**：自然人物实际到场、出勤、采购/支付、物料消耗、恢复/教育/政策反馈与保存续演；需新的明确运行授权与冻结来源。本轮不启动。

每项能力建议使用 `missing | declared | static-usable | runtime-observed`，附证据 `schema | graph | static-geometry | actual-runtime`、地点/楼层/人群条件和限制。可选能力缺失先报告；用户要求的核心城市生活能力缺失应阻断相应 profile，不能静默替换为另一种楼或免费服务。

下一步当前仍是完成能源、医疗、科技、政治、教育等系统。地图工作后续最小顺序为：结构/能力诊断 → 一张明确受支持的小城市包 → 注册身份/独立存储槽/原子重载 → 实际路径与自然闭环验收。此报告不把这些建议计为实现，不改变默认世界/五配方/存档，不声明真实地图已可直接接入。
