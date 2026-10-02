# 云山建筑与交通资产全表：只读本域原件

本表位于 `/tmp/yunshan-asset-inventory-built-01`，基于共享 HEAD `6c70d27fd96123a68fbd6125a326e065d54df37c` 的实际生产源码和已有隔离原型。本次只读生产文件，只写此目录。没有改共享 src、运行世界生成/模拟矩阵、GPU、浏览器、Vite、npm、benchmark、Library、Tripo或外网生成。

主件 `built-assets.json` 与 `built-assets.csv` 是同一份 314 条清单，CSV 为 UTF-8 无 BOM、标准 CSV 转义。两者严格使用父任务指定的 12 列，asset_id 为 BUILT-001 至 BUILT-314。`inventory-summary.json` 给出独立类型/状态统计和逐源 SHA；`evidence-reference-check.json` 验证 819 处源码/文档引用文件存在、行号在实际文件内。文件/行号检查不能替代几何、运行或艺术验收。

本域完整覆盖传统与现代建筑构件、实际楼体组合语法、天枢/亭/机场/星港地标、门窗/屋顶/楼梯本体，道路/桥/轨道/缆车/升降/水运/机场设施，以及城市车船飞机本体与附属道具。人物、室内桌床货架/柜台家具、商品食品、完整自然山水植被资产、生活业务/UI由其他域汇总；这里不重复计数。航空本体上的操纵台壳属于驾驶舱附属件，故列入本域；建筑内部机房/议事桌/档案架未列入。

## 计数方式和状态

| 条目类型 | 数量 | 含义 |
| --- | ---: | --- |
| 基础组件 | 176 | 独立构件/结构接口母版；每根重复柱、每栋实例不再计独立资产 |
| 组合模板 | 67 | 建筑/街区/交通/载具组合语法；不是实例计数 |
| 材质贴图 | 29 | 已有程序材质与待制PBR套分别列出；每套非按贴图通道再膨胀计数 |
| 配色尺寸变体 | 28 | 有实际源码参数的母版派生；不当新独立模型 |
| 动画特效 | 14 | 权威状态消费或明确缺项；不将模板和动画混计 |

| 状态 | 数量 | 严格解释 |
| --- | ---: | --- |
| 已集成代码生成 | 203 | 在可信生产树中存在可调用发射/模板/材质代码。包括仍供旧四配方使用的构件；不是203件艺术成品，也不保证可見支承已有body授权 |
| 隔离原型未集成 | 14 | 7件单桥模板/构件、7件街台模板/构件，有真实隔离源。未合共享生产，不能承接根的原465规则或GL结果 |
| 缺失待制 | 96 | 原提示词、当前审查与最新参考描述中的独立需要，在审计模块内尚无相应共享母版/完整精细件 |
| 待核实 | 1 | A1原模型只获父任务存在报告，本地未收到原GLB/模型像素，不能判合格或失败 |

基础组件、组合模板和材质套的母版ID自指。28个实际参数变体全部指向既有基础母版；8个有明确对象的动画指向驱动构件，其余动画是自身独立需求。不存在假造跨域ID。依赖接口均先写具体模块、数据和身体规则文字，根汇总时再建立跨域映射。314是本域可追溯条目数，没有凑1200，也没有把612栋实例、78桥盒、5006 motor记录当成资产数。

## 当前真实形体与组成

`src/types.ts:13` 定义15种 BuildingKind；`src/world.ts:18` 定义11区和用途计划；`src/world.ts:494` 起给各用途尺寸/层数，`src/world.ts:528` 是层高，`src/world.ts:531` 保0.2m层位。`src/world.ts:546` 只对 current-v4 的非core/非pavilion楼登记共享FloorPlan。六种真实房间拓扑在 `src/architecture-floor-plan.ts:115` 起定义，绝非只换牌子；真实墙洞在165、楼梯洞在188、双跑踏步和半转平台在190。近景发射 `src/rendering/architecture-bodies.ts:81` 逐块读这些结构，远景65保相同interior和courtyard轮廓，屋顶117使用实际RoofRegion。

以此前真实 CPU 结构原件 `/tmp/yunshan-city-structure-audit-01/structure.json` 的 seed20261001/current-v4 为准：11区、612楼、605共享FloorPlan、674节点/61站、691边。建筑种类 home221/market109/workshop56/bank32/hall41/school14/clinic41/police13/station29/core1/pavilion6/airport1/starport1/farm31/dock16；六族数量home252/market109/workshop56/civic68/finance-health73/transport-waterfront47。道路671、maglev4、lightRail5、cable2、lift1、bridge4、ferry2、flight2。该记录是当时实际生成的静态世界/规划证据，本次复用，未重跑；其11项生产源SHA与当前源对应核对见 `source-provenance.json`。这些数值不证明普通玩家身体旅行。

BUILT-086 天枢阁仍是144×112m起、五级各六层、总234m高、30层及2地下层的旧中式地标，具完整楼层用途/身份权限。它与6座亭子保旧发射器。现只有天枢和星港两栋高度超过80m，不存在新的现代玻璃金属主塔/次塔高密CBD群。当前楼位采用四驿六点环散楼语法，不能把单楼中的真实院孔当成连续中低街墙、连续街院或最新总览的大庭院已经完成。

`src/renderer.ts:280` 对共享body楼发射后立即return，所以下面旧programExterior中的阳台、旧市场檐棚、旧工业烟囱、旧钱庄壁柱、旧码头栈台等虽然仍在可信旧配方内，不会自动出现在605栋v4共享body楼上。表中“建筑旧版外立面”22项逐条写明此范围，保留旧成果，并不伪称默认v4全面使用。旧门侧细部则 `src/rendering/architecture-detail.ts:222` 分别选择共享或旧路径。

## 现代、机场与交通缺项边界

BUILT-222 超高主塔、223次塔群、224空中连廊以及中式现代冠顶/金属竖片/多层裙房，均为缺项。连续街屋、角部开口、沿等高线街院组合、大庭院、共享街阶/坡接和院墙也列缺项。依据包含 `提示词.md:31`、`docs/视觉返工审查与方案.md:45/61/63/73/74` 和父任务实际观察后的最新参考描述；本子任务和根未取得新参考原像素，不能宣称本地看过新图或完成对新图艺术验收。不得以图未到停掉源码与结构工作。

当前机场已有真实960×44m跑道(`src/world.ts:653/656`)、一栋generic transport-family航站楼、两公共flight edge，以及城市各处租用无人机/机场勤务jet机位。航站中心约(1150,64,785)、跑道高14.6m/z1490，约50m层差、705m纵向分离。不存在独立空管塔台、共享机坪/滑行道、多飞机泊位、真实航站至机位登机接台、机库和完整前景机场组。BUILT-266 塔台、267机坪等14条门户缺项明确列出。星港已有Torus能量环和光塔，但环内实体泊位/发射台/可登离飞船尚缺，不能把环和盒体班机当作完整星际门户。

BUILT-169 公共交通现是body/head/trim三盒母版；道路客运/货运共外观，maglev/lightRail共尺寸，渡船没有独立船底，公共flight代理17m长且把宽体直接当机形。精细公交/货车/车厢/吊架/升降舱/渡船/公共客机以及轮组、连挂、登离门、起落架、主翼、发动机、登机梯等26项单列缺项。城市可驾驶AerialVehicle的四旋翼/勤务jet已有独立代码组合，并与getAviationPads、租用/身份、登机、驾驶、落地、退出权威状态同源。保此实际城市获取成果，不改成独立飞行模式；公共flight Vehicle与可驾驶AerialVehicle仍不同契约。

当前道路/轨道可见墩柱、桥塔/端块主要由renderer独自发射，不能称body已经消费全部承力实体。交通表的相应行明确注明显示件和待共享净空。新结构必须同时进入terrain接合、getWalkHeight/support、实体体积阻挡、route和renderer，并在近deck高度才提供上层support，ground underdeck不被约154m高层拉上去。正常W桥下合法地面穿越和实体pier阻挡，不能用静态ground返回值替代。

## 隔离原型及保留失败

BUILT-204至210对应 `/tmp/yunshan-city-structure-audit-01/prototype` 的显式 current-v5-bridge-01，仅453m/9m的lift-top→core-station桥。此候选曾共享78盒结构、梁底252.8、桥面254.6、8基础/160terrain接触、6墩/32脚/8帽、6桥板/6梁/5接缝/2landing/13栏；先前局部CPU正常Controller KeyW往返和20m桥下样本有实际记录，但当前真实lift侧pier撞继承下层bridge-core-dock-core-lift-bottom，保 `/tmp/yunshan-city-structure-audit-01/other-three-bridge-support-static.json` FAIL。原12×154.6×10巨大端块与ray/body不一致负例保留；初次footing非正高、fixture错误252.6和startup TDZ失败也保原log，不把fixture错误改写成生产源缺陷。根要求已暂停重CPU、修桥和集成，候选不是最终可合入PASS。

BUILT-211至217对应实际市集原型 `current-v5-market-block-01`，52m实体街台/身体51m实走、钱庄步行连接十级0.2m台阶；原market-b0楼/三sale点/库存账户保留。首次台基bottom>top的6/7 FAIL保原件，fixed59263a局部CPU/strict与旧15世界/五0tick档证据属于其冻结coherent03源。原件Library交付事实已有文档，这里没有再次上传，也不冒称合入coherent04/完成GL/普通URL/24tick续演。根正在优先单栋market-b24三层home真实BOM/GL验证；本表不声称该验证已通过。

未来联合可信v5应显式完整literal recipe枚举，default保持current-v4；旧五recipe仍有相同字段、JSON、完整fingerprint和save字节，未知配方不能以startsWith被接受。market WeakMap须对combined登记 `registerMarketBlockBase(combined,真实v4base)`，否则terrain fallback会指回自身递归。桥support、market solid和step/controller检查排序必须共审，fingerprint需包含桥和街台实际descriptor。当前本表只是接口要求，没有共享apply或代根宣布新配方集成。

## 材质、体素与验收

既有主材质确实已接：灰墙/木/石普遍roughness.83/metalness.05，glass.25/.32，轻噪声/木纹/石接缝在 `src/renderer.ts:150/159/164`，屋瓦接缝190，近细部独立roughness.82/.025在detail392。这些分列为程序材质，不冒称已有完整baseColor/normal/roughness PBR原件或已艺术通过。材质11项缺口包括原六表面套、灯罩/玻璃/金属/跑道/载具表面。所有PBR套按完整套计一条，不将3通道当3母版。现灯罩多为emissive，真实外墙/道路暖光池仍缺。根已实际看过当前六机位并判ART FAIL，本表没有新图通过结论。

世界和既有实体保持0.2m，身体半径0.35m/眼高1.72m见 `src/controller.ts:9/10`。A1细0.05m只是该单件局部资产规格，BUILT-251待核原件外3.6×3.0×.30m、贯穿洞3.2×2.8m、近≤2500实际tri。不能推广到世界实体，不能只一条中心ray或透明材质证明洞通。外部视觉门框/窗棂/瓦檐可挂真实共享构件，但Tripo模型不能决定楼位、门净空、楼梯洞、实际支撑、路线和权限。门窗必须保贯穿洞体积、背底面、硬边平面法线、UV和真实LOD/面数；先概念图实核再模型，未收到原件不假称已生成、已检查或已集成。

完成本表只运行JSON/CSV同列表、12列、ID连续唯一、母版引用存在/类型枚举/引用行数和文件SHA检查。未重新跑全npm、GPU或旅程，保父任务独占真实GL。阻塞项是资产制作/艺术验收缺口、桥真实下层pier冲突和新参考像素未取得，不是本表原件生成阻塞。原文件先交根汇总；本域未上传Library/外部应用。
