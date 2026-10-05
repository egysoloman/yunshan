# 云山 RPG Maker 桥接契约

本目录保留规则内核 `6785ca7dcca09e8e97afd610cfd52176c7a1cfb1` 的冻结桥接版本。后续城市源码独立接合道路需求、财政到期、店主自筹与公共护理卫生；这些变更不会自动进入旧桥接产物或私有MZ ZIP。此目录提供真实内核与合法移动接口，供制作任务编排完整 RPG Maker MZ 工程；本目录本身不是 MZ 工程，不能把它误报为全游戏完成。

## 直接使用浏览器文件

把交付的 `YunshanCore.js` 放入 MZ 工程 `js/plugins/`，以普通脚本在表现插件前加载。它无外部模块/网络/Three/DOM依赖；无需在用户本机安装Node或重新编译。使用全局 `YunshanCore`：

```js
const city = YunshanCore.createSession({seed: 20261001, layout: 'current-v4'});
const world = city.worldSnapshot(); // 一次读取真实地图、建筑/入口/用途点、轨道/道路
const frame = city.advance(1 / 60, {x: 0, z: -1, sprint: false});
const requestId = city.queueCommand({type: 'purchase', targetId: 'river-b1', value: 1});
city.advance(0); // 不推进时间，按顺序处理已入队命令
const results = city.drainResults(); // 可能合法失败；呈现result.message
const saved = city.exportSave();
const restored = YunshanCore.createSession({save: saved});
```

示例购物的成功取决于实际玩家是否在该店可访问销售点、是否营业、有库存/现金等；示例不传送或授予权限。制作方不得使用MZ金币、背包、职业开关替代城市账本，也不得给NPC加独立随机日程。人物与交通由原616居民/车辆/各子系统统一推进。全部核心命令字段在 `src/types.ts` 的 `Command`，枚举随 `contract.json` 交付。

## 空间与移动

世界局部单位为米，x向东、z向南、y为高度；并非真实地理经纬度。`voxelSize=.2`。rotation为弧度；ground floor=0，地下为负数。地面建筑position与门、楼层、用途点存在不同高度，不能全部压成一个2D碰撞层。612栋建筑、11功能区、616居民的原IDs必须保留，地图事件ID仅是表现映射。

`advance`接受真实秒数0..1，固定1/60秒子步积分。x/z为[-1,1]世界方向，斜向归一；4.8m/s步行、10m/s跑，速度不受模拟speed或帧率乘算。要按实际帧输入调用一次；失焦/长暂停应由宿主重置帧起点，不补造输入。原模拟暂停时仍允许身体步行，城市时间保持暂停，沿原3D规则。

MZ `Game_Player`/事件坐标是 `city.playerLocation()` 的投影，不能反向写成player位置。禁止调用Simulation.setFocus当碰撞、保存一个假位置或修改clone再导回去当移动。桥接不暴露原Simulation/原世界引用，也无任意坐标写入API。

`headless-walker.ts`抽取原controller的数值规则：实体墙/完整半径.35m支持盘、.2m梯级/上下洞口、悬崖、运输屏障、真实摊柜、体素改造、身份楼层权限、动态封路与真实在途退出许可。`useDoor(buildingId)`要求实际入口三维6m内；`useStairs()`要求实际近梯触发并遵守原可访问楼层循环，不能任意指定floor。楼梯交互延续原E操作，不称连续走完所有阶梯；正常方向输入也保留真实梯级行走。

`canAccessFloor(id,floor)`、`floorPlan(id,floor)`、`atFunctionPoint(id,purpose)`、`walkHeight(x,z,referenceHeight?)`用于生成显示与交互提示，最终业务仍由核心command检查。v4 `floorPlan`包含实际墙、洞口、支持面/楼梯和固定设施；旧布局可能没有v4 floorPlan，必须按原 `world` footprint/stair规则表示。`navigation(targetId,'walk'|'transit')`只读原真实导航，不传送；`departures()`为真实当前班次。`world-current-v4.json`是内核真实默认世界的原JSON，不是新设计地图。

乘车/驾驶/飞行必须先让原 `ride`/`drive`/航空命令成功。随后 `driveInput(throttle,turn,brake)`或`aircraftInput(controls)`仅提交控制输入，由原traffic阶段移动。普通步行在乘车、登机、死亡时拒绝。退出载具仍交原command审核实际停靠与落地地点，不将无人机/战机做独立模式入口。

## 城市状态与时间

`metadata`给出core commit、bridge版本、世界seed/layout/fingerprint、存档与固定步单位。`snapshot()`返回完整SimState拷贝，包括能源/医疗/教育/治理/家庭/商业/卫生/病理/道路等当前模块；“有模块”不代表完整规划已完成。`actorsSnapshot()`给出NPC原ID/家/工作、身份、实际目的地/活动、位置、物理楼层/空间、存活/需求/钱包及频率tier，不能另造616条替代行为。

`playerLocation()`是实际身体；`eventsSince(id)`读有界原事件历史，并非完整审计日志。`snapshot`/actors无需每帧深拷贝全城，按宿主显示需要取样，不能据此改个体速度或真实时间条件。

时间与随机数唯一所有者为原Simulation。每累计.25真实秒，依次运行 time→environment→energy→traffic→people→commerce→finance→security→politics→feedback，推进 `.25*state.speed`游戏分钟，默认1。宿主只调用此session.advance；不能另外启动第二Simulation/重复Scene_Map与SceneManager tick。内核runtime xorshift RNG与accumulator/延迟/工资/班次/活动等全部随核心存档恢复；新地图配方只能显式初始化，不能把另一几何塞进旧档。

## 命令与保存

`queueCommand(command, requestId?)`入队拷贝，FIFO最多256；每次advance先flush，0秒也能flush。`drainResults()`返回并消费有界结果 `{requestId,command,result:{ok,message},tick,clock}`；ok:false必须显示理由，不能在MZ表现脚本里补成成功。自定义requestId在pending及尚未消费结果中须唯一，自动编号随桥接档保存。

`exportCoreSave()`原样返回 `format=yunshan-save,version=1` JSON，包含原世界指纹、seed、routeEncoding/routePool、state与runtime/模块manifest，可由原3D加载。`exportSave()`包裹为 `format=yunshan-mz-save,version=1`，含coreCommit、完整coreSave字符串、桥接固定步余量、pending/result队列和序号，适合写进MZ DataManager的独立字段。MZ事件页、金币与随机数不是业务存档。

`importSave(string)`同时接受核心档和桥接档：重建代码拥有的五种可信world配方匹配指纹，再用原完整core validator验证工资/库存/家庭/模块引用等；全验证成功后才替换session，否则原全态/队列/余量不变。旧核心档没有桥接队列，恢复为零余量/空队列；桥接版本或冻结commit不匹配拒绝，不静默换城。原完整档大小上限8MB；桥接包上限10MB。不能仅从snapshot复建，因为它缺runtime、RNG与在途/财务来源。

## 源码与复现

复现此历史冻结时，从已交接的 `3f560d99ae331cbed5c614c855d6ec177faea22f` 创建独立检出，再运行以下命令；该提交包含本适配器和逐字对应的6785源码。后续城市源码不能绕过旧哈希守卫直接构建成同一版本：

```sh
git worktree add --detach /tmp/yunshan-bridge-6785 3f560d99ae331cbed5c614c855d6ec177faea22f
cd /tmp/yunshan-bridge-6785
npm ci
node node_modules/typescript/bin/tsc --noEmit --project adapters/rpg-maker/tsconfig.json
node --import tsx --test --test-isolation=none adapters/rpg-maker/walker.test.ts adapters/rpg-maker/bridge.test.ts
node adapters/rpg-maker/build.mjs --out /tmp/yunshan-core-new-bundle
```

`build.mjs`检查全部冻结src哈希，IIFE依赖图不得包含renderer/controller/UI/main/node_modules，输出JS、meta、完整world、原初档、合同与运行回执。esbuild来自现有Vite依赖树；当前实际版本写入回执。修改core必须先形成新可追踪冻结、重新验桥接与存档，不绕哈希守卫。

官方MZ试用引擎和素材由制作任务私有使用；本交接不含这些文件，也不将其上传公共Git。父制作任务已另行交付完整私有MZ 1.10.0工程，其冻结为同一6785原Simulation/CityUI/PlayerController，并未采用本新增facade；本适配器是后续可独立选用的接口，不能称已接入该ZIP。不能把本内核VM检查称MZ编辑器实机验收或Mac性能。当前城市经济稳态、部分自然灾害/拆迁施工/卫生病毒/深层服务/美术等仍有待推进项，见仓库备忘录与需求矩阵。

## 与已交付私有 MZ 工程的关系

父制作任务报告的私有工程为 `Yunshan_MZ_1.10.0_Private_Project.zip`，LibraryID `libfile_3c0d4a37cd0081919db55fa1cee3f5b1`，ZIP SHA256 `20ac4c5d2b3ab069565397ed12bb052dc155c96ca2663088c283e333b071bc41`。它使用原非渲染Three camera控制器；本facade未被采纳，不能用本次测试替代该工程自己的验收。MZ编辑器GUI/用户本机启动仍未运行。

两者兼容边界是原 `yunshan-save` 完整核心字符串及同一可信世界配方/指纹。原私有工程的外层wrapper不必与本目录 `yunshan-mz-save` 相同；迁移时提取并校验canonical core save后交 `importSave`，不能冒称两个外层格式可直接互换。私有工程必须保留原碰撞/ACL/唯一frame顺序，不能重复推进MZ移动或第二模拟。

本轮Linux Node/隔离VM诊断中，默认世界首个完整模拟tick实际约8–11.5秒；这是具体诊断条件下的结果，尚未证明实时性能。原plain VM两轮因CPU时间过长中止记录保留；最终测试只在VM内捕获其自有Math/JSON标准引用以避开context全局代理开销，正式浏览器IIFE字节不改，也不注入宿主游戏/DOM/Three对象。后续应单独测量真实宿主性能。

2026-10-03后续制作方报告：独立dot MZ候选已采用仅 `architecture-floor-plan.ts` 的已验窄性能补丁，initial＋32完整核心保存相同；旧Library私有ZIP尚未替换。此报告区分制作方新候选和旧交付包，不改变本目录6785冻结，也不是根环境重跑MZ、编辑器GUI或macOS性能的证据。
