# RPG Maker MZ 合法 Walker 与冻结核心契约

状态：STATIC_IMPLEMENTED / EXECUTION_NOT_RUN。无 Node、Simulation、build、GPU 或浏览器执行；未修改共享仓库。此记录不宣称 MZ 插件、差分测试或浏览器 bundle 已通过。

## 输入与提取

- 冻结 Git 提交：`6785ca7dcca09e8e97afd610cfd52176c7a1cfb1`，不含后续自主道路维修需求候选。
- 原输入：`base-manifest.json` 的164项，静态逐SHA读取0变化。清单SHA：`03af37361bf737862832a7ee661da78beb80f4b270fc6195f675cf908a8a6e17`。
- `src/controller.ts` SHA：`7889f416e9cd8ff2fb81c76eb121d2cf286a76c0a16e2ad8cf1bd2fcd1c907ab`。
- 新 `adapters/rpg-maker/headless-walker.ts` SHA：`c40553f2489fb19ce30b323c330d386264301451e9287f1b2dc22f8d51b52414`，18809字节。
- 原 controller 从 `private walkTo` 至 `private contains` 的六个数值方法，逆转内部字段改名和本地clamp替换后，**原文本逐字相等**。规范化尾段SHA：`d7404b94417c89bbfe1eb74d47be787e3b37ad0425194725aafc265b7efdee49`。
- 原源 `walkTo:319`、`groundEdgeSupport:329`、`walkFloorPlan:353`、`walkToLegacy:397`、`mayWalkTo:439`、`contains:446`；以实际冻结文件行号为准。
- 同时复制原 `setMode('walk')` 支持面定位和 `useDoor/useStairs` 数值逻辑；删相机、姿态、输入事件与DOM。实际原函数不改。

## API

```ts
new HeadlessWalker(world: WorldDefinition, state: () => SimState)
walker.position: Vec3 // copied
walker.inside: Building | null // canonical world building, query only
walker.floor: number
walker.blockedAccess: string | null
walker.consumeBlockedAccess(): string | null
walker.move(x: number, z: number, sprint: boolean, seconds: number): void
walker.syncFromCore(): void
walker.useDoor(building: Building): boolean
walker.useStairs(): boolean
```

`move` 接受世界轴x/z各[-1,1]，对角归一；真实4.8m/s或10m/s，seconds有限且0..0.1，原x轴后z轴。near-v4仍原0.1m子步。半径.35m、身体1.72m、原楼梯/支持盘/孔洞/墙/家具/体素/道路闭段和权限守卫保留；普通帧不乘游戏speed。诊断沿原sticky语义，只有consume清空。

构造绑定可信Simulation.state getter。syncFromCore不接坐标，供成功import/车辆/航空业务后的已验证核心body同步；外部tile坐标不能写位置。bridge须私有持有walker/core，不公开原state可写引用或setFocus。getter position返回副本，inside为已有world canonical对象不能向插件外泄露可写引用。

额外入口守卫：ground action拒死亡/车辆/航空器占用；useDoor必须是world.buildings中的同对象。有效站位和所有数值碰撞逻辑仍原provider。useDoor原6m入口交互和useStairs近梯触发/合法楼层循环保持：**useStairs本来是交互式层切换，不是逐级步行模拟**；逐级楼梯应消费move和真实treads route。

## 初始化、时间、RNG

- `src/world.ts:430`：`createWorld(seed=20261001, layoutVersion='current-v4')`；五个code-owned recipe见world.ts:6，未知layout拒绝。生成器PRNG见world.ts:33，自有seed序列，不是Math.random。
- `src/simulation.ts:118`：`new Simulation(world)`，至少非空district/building/node；初始tick0、day0、08:00、speed1、player真实spawn/traveler/600文。constructor原规则初始化居民、岗位、商店、车辆和模块。
- `simulation.ts:647`：`step(realSeconds)`有限0..120；暂停则不积累；每累计.25真实秒固定执行time→environment→energy→traffic→people→commerce→finance→security→politics→feedback，每tick游戏分钟`.25*state.speed`。不足.25秒保runtime.accumulator。
- `command({type:'speed',value})`允许.25..16。MZ不可用每帧固定step(.25)当真实时钟，需单一真实秒driver；否则随FPS加速。长帧/后台暂停策略明确由bridge制定，不重复MZ+Yunshan两个计时器。
- `simulation.ts:184` xorshift32，初始`(world.seed>>>0)||1`，runtime.rng和accumulator完整保存。render/MZ读状态不能额外消费nextRandom。
- setTime是显式调度编辑：重排天气/班次、清NPC路线和决策（simulation.ts:1670），不能当连续劳动/治疗/休息时间推进。
- 原main.ts:193–208先合法walker→可信坐标同步→exit permit release→focus/detail/input→Simulation.step。bridge按此业务顺序，passenger/aircraft位置只让原traffic业务驱动。

## 业务与权限

核心Command没有walk/move。`Simulation.setFocus(p,'walk')`在simulation.ts:657只检查有限范围就复制player坐标，**不是碰撞接口**；桥接仅可将walker已验证body经内部此旧同步路径交回core，不暴露任意坐标设置。

`planJourney`（simulation/journeys.ts:23）只记录目标/偏好，纯journey规划提供route，不移动身体。不应把route点直接赋给player。楼层合法性共用`canAccessFloor`（access.ts:19），包含地下、public floor、identity packages和core-main顶层特例；并非一个无条件floor command。

交易走`command({type:'purchase', targetId:buildingOrShopId, value:1..30})`（simulation.ts:1678），保持真实sale站点/ACL/库存/停业/付款/税/寄售结算；v4 functionpoint requires真实room/stairs支持和2m距离（simulation.ts:1590）。work/rest/heal/study/research均原模块入口，桥接不能凭MZ菜单自行加钱、库存、need或技能。

ride/drive/leaveVehicle保持原35m停稳车辆/容量/身份/票款（普通4、flight45）/封路拒绝，驾驶输入走driveInput，航空输入走setAircraftControls。纯核心import航空模块无Three运行时依赖；types.ts中的Three仅renderer类型，应由TS打包擦除，不以此宣称实际bundle已验证。

## 保存与恢复

`exportSave()`（simulation.ts:1838）原JSON：format='yunshan-save',version=1,worldSeed,worldFingerprint,routeEncoding,routePool,state,runtime。routeEncoding为pooled-v1或paged-v1，勿把citizen wire route数字索引当Vec3[]读写；route-encoding.ts负责还原。

`importSave(json)`（simulation.ts:1843）8,000,000字符上限，safeTree节点/深度/禁prototype键，世界seed/fingerprint严格匹配，所有实体/module/财务引用和保存校验通过后才换live state；load hook异常回滚旧state/runtime（2065–2067）。不截断/只存state，不手编module manifest，不省runtime RNG/班次/出勤债。

跨旧5世界用`selectSavedWorld(json)`（persistence/world-layout.ts:45）从代码重建全部可信recipe后匹配完整fingerprint；不能相信save自带任意geometry/layout。MZ map/tile坐标为表现映射，不授权替换World geometry。当前协议支持可信现世界，任意MZ自定义地图完整语义契约仍需独立实现。

载入应先选可信world→构造Simulation→完整importSave成功→walker重新绑定该Simulation getter/syncFromCore→刷新MZ表现。完整tick或完成的命令后保存；不承诺任意ten-phase中途保存断点。旧save允许既有显式migration；立即export改metadata的旧迁移与新/已迁移档+24exact必须分列。

## 待执行验证

静态差分test由独立agent在 `/tmp/yunshan-mz-walker-diff-tests-20261003-01` 准备，原controller侧允许Three/controlled DOM，仅测试依赖；当前NOT_RUN。root统一CPU GO后才运行strict/差分/真实bundle浏览器。MZ自身任意tile teleport/movement不得作为证明。
