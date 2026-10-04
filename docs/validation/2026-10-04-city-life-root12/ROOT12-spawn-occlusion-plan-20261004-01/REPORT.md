# ROOT12：出生街景遮挡的只读诊断与 authority 修订范围

**本轮没有修实现，美术仍 FAIL；实际渲染网格/截图像素 owner 命中均 UNKNOWN。** 当前源码已把可调查对象缩到具体道路段与站棚，而不是凭棕块外观认楼、柜台或车辆。此处记录 source-backed 几何候选与后续验收；不以候选解析盒代替实际 Raycaster/三角形命中。

## 对原封存报告的勘误

ROOT11 `HANDOFF.md` 首行把 `a2e9cb1…` 写成 main，是本代理的来源表述错误。它是 **takeover-city-life 的工作基线**；根线程于10:23实际回读 remote main 仍为 `6955d37`。本轮没有重新查询 Git remote，明确以根线程回读作来源。ROOT11 已封存原件不改，勘误只在本 NEW 文档及根综合报告记录。

## 来源、实际参数和边界

只读来源 `/workspace/yunshan-work/ROOT11-integration-20261004-01/source`。该 264 输入 integration clone 没有 `AGENTS.md`，已重读 `/workspace/yunshan/AGENTS.md` 协作控制；完整提示词及备忘录已在前序任务读过，不重建。snapshot 与全 SHA 见 `READ-SOURCE-SHA256.json` / `source-as-read/`；14相关源码（含原browser harness）与 ROOT11 封存全字节相同，再读 SHA 稳定。

仅复用既有 CLOSED ROOT11 World 原 JSON（SHA `2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512`，612建筑/691edges/674nodes），没有新 `createWorld` 或 Simulation；World producer 及 access/roads/商业/floorplan 等本轮相关输入 SHA 全同。源码 current-v6 `world.ts:433–439` 明确由 v5 继承 graph/terrain，再改5商业楼。版本/计数相同不等于任意地图都已适配。 这不是根当前browser World的新完整dump或逐byte验证；后续真实命中见证须同时导出actual World并核fingerprint，不能把本解析候选自动等同当前运行所有对象。

两张 root原图已实际看并逐byte复制：`root-integration-day-as-read.png` / `root-integration-interior-as-read.png`。父线程原264 browser11 **11/11 PASS**（10:23:39→10:33:46，raw `bf6c22879685e177b9fb4fba6f7ea28e7858d9c8e3d949ba343de4d5ede04cbc`，264stable、owned66966active0），本代理没有另跑它。`root-browser-results-as-read.json` 是父组原结果的字节副本，不改原断言或期限。这个原11功能结果不证明视觉质量、Mac或FPS。

此前真正 native 原姿态来自 ROOT11 metadata，生产原构造源码在当前 integration 相同：

| 姿态 | body | eye | 实际 camera quaternion | 时刻 |
|---|---|---|---|---|
| 普通出生 | (-330,51.5375,487) | (-330,53.2575,487) | (-.024191989150678845,-.25171716574181724,-.006294240498289998,.9674779577170685) | 原metadata tick8/hour8.0333，截图前采集，RAF继续 |
| 真 W净30.476m 后 | (-315.0281115874095,52.10331245069323,460.4547898587516) | (-315.0281115874095,53.82331245069323,460.4547898587516) | 同上 | 原metadata tick28/hour8.1167，F键暂停模拟，RAF行走仍原实现 |

FOV48/1440×900/near.12，中心朝向向量 **(.48675707847,-.04997916927,-.87210643226)**。root day 是原harness出生位置的15.5时刻图；它没有独立导出该截图瞬间 camera dump。此处以源码与已有真正 native 参数重建候选，不伪称 root day 的逐像素命中。

原 interior不是从出生完整走到店里的截图。harness `scripts/browser-test.mjs:85–97` 先设到第一 market 门外，再真调用 E 入门，随后拍 interior；第一 market 实际 **river-b1 / 清溪水岸·西溪院·商肆1**。原结果 `controlledSalePlacement.beforePosition` 给拍 interior 后、设交易点前 body **(-846.4,18.6,1134.2)**，floor0；之后才受控设置 sale-center(-846.4,18.6,1127.4)。不能把该受控进入/交易设置当从出生的日常街巷行程。

## 可以从源码和既有数据证明的结构问题

1. **出生朝向选商铺的规则没有街道/高程语义。** `renderer.ts:396–398` 仅按市场建筑门的XZ欧氏距离选 arrivalShop，把 lookAt Y 写为 `spawn.y+1.2`，不取真实门Y；`controller.ts:42–44` 先读yaw，然后 walk `setMode` 在132–133又强制pitch=-.05。实际目标最近 **market-b26 / 千灯市集·云锦街·商肆7**，门(-282,80.4,401)，XZ距离 **98.488578m**，门比出生脚高 **28.862500m**。实际 camera保该店方位却向下约2.86°，不是朝高台门的3D入口或下一段可行街道。这能解释为什么默认方向先读成道路/站棚，不能单独认证顶部某像素的物体。
2. **道路网络是大量端点到站的分支，坡度不是按交叉节点一致级面设计。** world `576–589` 每建筑门连接 anchor/站，`421–427` 用累积XZ在起终高程之间线性给每条route独立grade。rail `610–640` 又从route重采样4m并按净空/拱高抬轨。该源没有为这次出生附近所有路段构造一个公共同grade plaza；具体道路相遇的高差必须以后实测，不能假定所有站附近边都是一个地面层。
3. **站立可用不等于眼部开阔。** world `245–280` 先建筑支撑，再近 road/bridge（bridge半宽4/road5）的中心线高度，referenceHeight以垂直差加权择支撑。transport `105–113` 只测deck附近身体跨侧栏，不是眼部射线；controller `356` / `397–439` 的已审步行路径用它、building/counter/placed-voxel/road-open 守卫，未见调用统一道路deck/柱帽的眼部或body overhead solids检查。这里只认定这些路径的可见缺口，不概括全模拟所有actor路径，也不武断认定30m末body已经穿实体：当前没有完整扫掠或头部命中证据。
4. **Renderer 的 segment不是水平AABB。** `BoxBatch.segment:41–46` 将unit box以完整3D方向 quaternion旋转，scale(width,height,3Dlength)，两端 lift 放在worldY。road/bridge deck `760` 为厚.5/lift-.25；轨道为1.4/lift-.9。斜段按这个frame有旋转与横向高度差，不能仅以“中心线Y-.5到Y”代替实际整宽实面。getWalkHeight使用centerline投影高度；两者的斜面/横向差需要后续同一solid descriptor统一验证。
5. **大型附属几何有明确生产者。** `renderer:775` elevated柱/基础/帽；`782` 每station固定23×.65×11 roof、22×1×18 platform；`791–820` bridge索/塔/端墩。其中 bridge tower/deck另有 guard interval条件。宽度/guard数据来自shared transport；这些附属件目前不能从守卫“身体可通过”推定“视线无挡”。不要删真桥/棚来让美术图变好。

## 重建出的具体调查对象（仍不是实际命中）

`static-network-candidates.py` 只执行既有 JSON 的轻量数值运算，没有import生产TS、Three.js、Raycaster、World/Simulation、浏览器、测试或渲染。根据 segment源码重建 OBB，在已有camera的九条NDC(-.8/0/.8)×(-.8/0/.8)方向分析box区间，距150m内仅含 **deck和station roof子集**。缺失实际scene visibility/LOD/inside mask/车辆/真实建筑三角形/地形/guard/post/柱/桥塔/索，不能以subset的最近对象当画面最近对象。完整结果 `static-network-candidates.json` 的所有runtimeMeshPixelOwner均UNKNOWN。

| 姿态/方向 | 静态subset候选 owner | 参数来源 | 解析区间入口 |
|---|---|---|---:|
| birth中心 | road-market-b69-door-market-station，segment14 | a(-320,52.4,488)→b(-320,52.6,464)，deck10×.5×24.00083 | 14.833m |
| birth上中NDC(0,.8) | lightRail-market-station-academy-station，segment5 | a(-320,62.4,464)→b(-316,63,464)，deck6×1.4×4.04475 | 27.592m |
| birth上左NDC(-.8,.8) | maglev-river-station-market-station，segment238 | a(-328,59.6,472)→b(-328,59.8,468)，deck6×1.4×4.004997 | 19.432m |
| birth上左另候选 | market-station roof | node(-330,52.6,460)，box中心(-330,59,460)，23×.65×11 | 22.228m |
| 30m终上左/上中/上右 | **road-market-station-academy-station，segment2** | **a(-328,53.2,464)→b(-312,55.6,464)，deck10×.5×16.178999，中心(-320,54.15,464)** | **.696/.809/1.349m** |
| 30m终中心 | bridge-market-dock-market-station，segment12 | a(-304,53.2,448)→b(-304,53.2,456)，deck9×.5×8 | 13.411m |

这使后续验证有了精准edge/segment/生产者，而不是“那一个棕块像柜台”。**优先调查30m终点相距很近的academy道路段**；出生顶部轨道/站棚也有多个几何候选，尚无法认定其像素占比或唯一根因。动态棕色车块在root day与此前native图位置不同；未取该截图时动态state，owner UNKNOWN。

## 室内空且过亮：可核源码，不能凭单图判唯一原因

原 river-b1 地面房间的building envelope36×27.6，floorheight3.6；真实interior/court面积没有新执行provider计算，不把约993.6m² envelope称为可用室内面积。`architecture-floor-plan.ts:98–115` 按现有usePoint尝试每点一个counter(3.2×1.2×1m)，其他table或home bed，无sofa/monitor/desk独立fixture。`architecture-bodies.ts:141–159` 只细化真counter/bed的原host volume；这是空间稀疏与规则家具缺项的源级解释，不能通过贴图声称填满日常生活。

`renderer.ts:119` 只2个PointLight，`967–984` 按whole building尺寸与usePoint定位。floor0原推导光源Y=18.6+3.6×.68=21.048，intensity=`max(90,36×13)×energyRatio×(1-daylight×.3)`，distance=`max(36,27.6)×1.25=45m`。energyRatio=1/daylight=1的**例值**是327.6每灯，不是这张截图的实际导出值（energy没有该时刻dump）。PointLight没有配置castShadow；全局ACES/exposure1.02/sun/fill/albedo也共同影响。源可证明该灯使用建筑宽度与45m范围，不按独立房间/屋面遮光；白色过曝实际看到了，但不能宣称已定位唯一光学原因、或降一个数值就修好。

## 后续最小 authority scope 与验收（本轮只规划）

**先做真实只读命中见证。** 在新独占GPU namespace，普通出生及自然W同路线后捕actualscene instance UUID、instanceId、source owner、exactmatrix、triangle hit、eye与pixel方向。不要用驱动搬body，也不把全scene粗AABB当真命中。network batch当前只保material/cell name、没有逐instance edge owner；优先将实际命中instance matrix与source-reconstructed matrix逐项匹配，尽量不改生产源码。若相同矩阵或附属件仍不能唯一归因，再在NEW诊断clone真实producer收集只读provenance映射（edgeId/segment/partKind/matrix/nodeId），不改尺寸、显隐、simulation或shader；不得把辅助hook悄悄安装成生产行为。静态这两对镜头具体候选足够指导，不必整城重建或重新百万geometry。

**确认owner后才改局部真实街道。** 最窄实现范围是market-station到academy的该起始route及对应出生邻域交叉点/步行街逻辑，在 `world.ts` 的独立新街道recipe/version中明确plaza-grade、与现有路的同grade join、需要保留的立体路净空、真实可用去店路径。对旧v6和旧档保持原数据/历史路线，不能悄悄改同marker布局；新World应有清晰recipe/fingerprint及迁移边界。若真实命中证明是road/rail空间冲突，再改该真实polyline/grade/attachment，让terrain、步行支撑、路网车辆/NPC都读新authority；禁止只在renderer移桥、缩路、隐藏楼或移spawn转相机来避开问题。不要把“最近门98m且高29m”替换成一张好看但不可走到的camera图。

**共享结构描述应补真实净空。** 如实际body/道路solid有不一致，用 `transport-geometry.ts` 的shared segment/deck/附属solid descriptor供renderer与controller/body使用，保持world道路宽度、原radius/eye/speed/guard interval同源；transport cache对同数量points编辑必须显式invalidated或新World重建，不能只改某矩阵而留下旧guardLayouts。controller以及NPC physical-mover要根据实际owner再决定是否需接同一净空守卫，当前没有完整NPC调用链审查，不先扩改。新设计净空/坡度/步行入口指标应明确写为设计要求再测，不能说旧30mPASS已经证明了它们。

**室内另成真实生活局部。** 选既有river-b1或market-b0作为真实营业地，先以actualfloorplan room/court/light sampling控制照明，再在host/fixture/交易语义内完善柜台与生活资产；新增可用sofa/monitor/desk需明确设施语义、碰撞/support/存档/权限，不能只是屏幕像资产。经营、库存0、关闭、租约结束/换租权反馈必须继续如实显示。

必须保的后续验收：

- 普通birth、旧30m路线同camera及真实W记录，before/after原PNG与actualsource/world/clock/save证据。城市中实际到可用门、真实进出/到sale点/库存交易与身份反馈，不能只用受控functionpoint证明整段行程。
- 被改具体edge/solid的renderer/authority坐标一致、脚部支撑、head/capsule净空、same-grade交叉/guard opening、车辆/NPC路径及道路关闭/改造/许可退出，原速度/radius/眼高不变。camera ray报告实际owner与命中距离；不靠放宽断言。
- 新layout与旧v6/旧档加载原子性、即时存档和旧24tick exact分别实际验证；新marker不能经普通读档/首次使用暗升级。道路对象同count修改必须测试cache失效，bridge端口和同级交叉守卫保留。
- 同原11软件GPU功能检查、真实新局部截图库和renderer calls/triangles/texture/arraybytes/dispose预算；独占性能测量与Mac另立scope。原功能11PASS不让ART自动绿。

剩余项：本轮没有实际pixel/raycast、没有修路/净空/空室/光照，也没有新GPU/Simulation/test/build。只读分析已完成，可从source owner明确定位继续。Library根统一交付，本代理未上传。
