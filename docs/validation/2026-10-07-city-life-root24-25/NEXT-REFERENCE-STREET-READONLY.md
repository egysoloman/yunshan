# 下一有限街景实体：到达商肆真实台基接地

状态：READ_ONLY / PROPOSED / NOT_RUN。本报告仅静读当前共享源码及已存 literal world；没有执行 Simulation、createWorld、类型检查、测试、构建或浏览器，也没有修改共享文件或旧封存证据。当前 v8 尚无本任务亲见的新街景截图，不能声称白平台已改善或 ART PASS。

## 顺序

先解决并实际验证当前出生街的原生进门、E 出门、路缘石抬脚/离开和完整身体支撑，再实施下述新台基实体。父代理已静态指出 E 出门候选 `(-282,80.4,403)` 的足圆触及二段真实 curb，而且不在现有 `.4m` 精确支持走廊；这是当前待验证/处理事项，不得用下一美术改动掩盖。该 Controller/E 核验由父代理负责。本报告没有运行或宣告其失败/通过。

## 已从源码确认的缺口

选一项：**出生市场建筑的真实台基接地**，先限定实际 arrival 建筑且 `basements === 0`，不是全城美术框架。

- `src/architecture-floor-plan.ts:279` 的 `buildingWorldPosition` 将 local ground walking plane `y=0` 放在 `building.position.y + .6`。literal v6 的 market-b26 为 ground `79.80000000000001`、door/foot plane `80.4`、无 basement。
- `src/world.ts:133`–`:135` 的地形规则在该无地下室建筑原 footprint 内直接返回 `building.position.y`。`src/rendering/terrain.ts:124`–`:127` 实际地壳也采该地形高度再按 voxel 量化，不额外补 `.6m` 台基。
- `src/rendering/architecture-bodies.ts:174`–`:175` 当前 near floor slab 只有 local `[plan.y-.2, plan.y]`；ground slab 的实际底为 `80.2`。far court/circulation 同样只用 `.2m` slab，见 `:169`–`:171`；far 室内体块则从 ground local `0` 开始，见 `:163`–`:164`。
- `src/renderer.ts:462`–`:470` 在程序建筑后直接 return。因此旧 emitter 的实体底座及门前 apron（`:504`–`:506`）不会出现在这些程序建筑中。
- `src/architecture-floor-plan.ts:389`–`:430` 当前 local solids 消费墙、fixture、stairs 和**高于当前楼层**的 slab，没有本层 ground plinth。不能称现在已经存在共享底座碰撞。

由这些数值可静态推导：b26 当前 ground slab 底与实际 terrain 之间相隔 `.4m`。这解释了需要补真实台基的结构原因；新 v8 在实际镜头里的可见程度仍 NOT_OBSERVED。

## 最小实施方案：三个核心接点

1. `src/architecture-floor-plan.ts`：新增 code-owned `getFloorPlanGroundPlinthRegions(building)`，只对显式新 revision 且无 basement 的 arrival 建筑返回 solids。XZ 直接复用 ground `getFloorPlanSlabRegions` 的真实 mask，保留洞及 landing；高度为 local `[-.6,-.2]`，连接实际 terrain 与现有 `.2m` slab。把同一 solids 接入 `uncachedLocalSolids` / `localSolids` 的本层查询及 cache 失效判据；不得只向 renderer 添加可见方块。
2. `src/rendering/architecture-bodies.ts`：`buildProgramArchitecture` 的 near/far 都读取上述**同一** descriptor，经现有 `regions/rectangleCover` 发出 bounded stone body。体积不外扩到道路、门前 curb 或邻楼；原 slab top、door、sale/use points、inventory、原商业主体保持原值。台基不是 ceiling/roof；用 ground body 标签，避免房内 cutaway 把承重底座隐藏。无需 GLB、额外店铺或新 shader 循环。
3. `src/persistence/world-layout.ts`：`savedWorldFingerprint` 只在一个**新的明确 recipe/revision** 中绑定 marker、台基尺寸参数、实际选中 buildingId 以及生成的 plinth solids。不要更新已经冻结的 v8 identity。旧 legacy/v2/v3/v4/v5/v6/v7/v8 的 descriptor、字段顺序、FNV 和完整 world 文本原样保留。相应 types/world 新 revision 声明只是此接线的契约配套；旧存档不会自动迁移，新 recipe 只用于明确新城创建。

不扩展有地下室的建筑：其 excavated terrain、ground stair hole 和 basement headroom 必须留在原合同里。若到达建筑有 basement，有限台基 recipe 明确不适用，不能填洞或悄悄选别的建筑。

## 有限验收

- **几何与身体**：只审选中建筑，near/far 每个 plinth part 与 descriptor 的 XZ union/洞/高度逐项相等，底接原 terrain、顶接 slab bottom；原 `80.4` walking plane 不动。用真实 `.35m / 1.72m` 身体验证出生→door、原生进门/E 出门及 curb crossing。新增反例必须证明进入台基体积的低身体被挡，同时正常门口站立/行走仍通；有 basement 的负例不得生成新 plinth。
- **兼容**：复用 root 已保存的旧 recipe×seed 24 组精确基线，比较完整 world/body/roof/FNV，连旧 v8 一并守住；旧保存重读保留原身体/camera。新身份才允许绑定台基 solids，不能把新几何冒成旧 identity。
- **真实画面与资源**：完成前述原生门/curb 验收后，有限同镜头 old-v8/new-recipe 街面各一张、door side 各一张；以实际出生身体/初向拍摄，记录近远 LOD 切换一次与 resident unload/reload 一次，核台基连续、无漂浮缝、无新增路面遮挡及资源回收。软件 GPU 截图仍不能代替 macOS 性能证据。

以上验收全部是后续要求，本报告零运行。家具摆放、整条商业街新业态及全城桥底实体权威不在这个最小切片中。
