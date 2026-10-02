# 建筑原型 01 独立只读复核

复核对象：`/tmp/yunshan-architecture-prototype-01/prototype/floor-plan.ts`、`prototype/check.ts`、`prototype/guards.ts`、`source-manifest.json`、三个 seed 的结果 JSON 与原始 PASS 日志。原型来源 checkpoint `3f01707581eef697572ffa58bdb994bef037e98d`。此次复核没有改原型或生产文件，没有运行 GL、访问浏览器 profile、导入或覆写玩家存档，也没有重新执行完整原型生成或扩大规则测试。

独立运行了只读 SHA 校验：manifest 所声明的 **33 个 frozen 源文件**均与原件相同；三个 seed 的结果内 `prototypeHashesBefore` 与 `prototypeHashesAfter` 相同，且与实际原型文件一致。每个结果的 `errors` 均为空，所对应 `check-seed-*.log` 都保留最终 PASS。此范围是原型声明的 33 源，不能写成 root coherent03/04 的全部 89 源验收。

原型源 SHA256：

- `prototype/floor-plan.ts`：`43cf5164a2f7bf0f543d86f243c2d0679872e4a5e37fed6ebedf4fac621d2635`
- `prototype/check.ts`：`007a06a4c594ee36a41e5d9e899a73fa9b4b2caa117f8a6bd40f258b81910b24`

## 已由原型与原日志支持的结论

`interior`、`circulation` 与 `courtyard` 都进入近景 slab 的真实几何描述，庭院不是仅有颜色的空白区。楼梯井从占用区域扣除后，独立 `stairLanding` 再生成平台 slab；`floorSupport` 只给实际可站区域返回支撑，原 guards 已验证平台可站、未填楼梯井区域无支撑。每层 shaft 的 x/z 来自原共享 `getStairPosition`。

门与庭院入口是 wall boundary 上的显式开口，近景墙体和碰撞盒都由同一 `wallRects` 生成。原 guards 包含关闭入口后确实阻挡站立点的反例。单个 MeshPart 的索引边均有双面邻接、绕向一致、正体积和 0.2m 网格校验；三个 seed 的结果没有记录这些检查失败。

三个 seed 均生成 **612 栋、3516 个楼层计划**，逐层检查原 shaft/use 点可站、层高、占用边界和近远占用轮廓的采样一致性。core-main 与 pavilion 的 `preserveExistingMesh` 保留原 renderer，原型不替换其几何；core 的 30 地上层、2 地下层及原观景层和地下权限断言保留。

原型比较的是生成描述与 frozen 原规则，而不是证明这些描述已挂到生产 Controller、Simulation 或 renderer。

## 可达性与碰撞证据的准确范围

0.8m 网格 BFS 仅对 **六栋用途代表建筑的各层**执行。其目标包括入口内点、用途点、shaft 和地面庭院两侧；市场代表还检查三个经营点。全部 612 栋的 3516 个楼层都有 shaft/use 点站立检查，但其余 606 栋没有逐层完整 BFS，不能称为全城房间通行验收。

BFS 将真实坐标取整到 0.8m 网格，检查邻接采样节点的 `canStand`；没有用实际 Controller 沿这些连续段输入步行。`canStand` 的支撑条件是中心加四个轴向半径采样，并非完整脚底圆盘的连续覆盖证明。墙体碰撞带使用 0.35m 身体半径，但尚无实际生产身体、权限拒绝、垂直楼梯操作与公共门外接路的联合验证。

外部门口检查目前确认外侧 `terrainHeight`/`getWalkHeight` 有限、门内站立点可用及入口开口存在；有限高度不等于从现有道路到门口已经连续可行。楼梯平台描述也不等于实际上下楼操作已接合。原型的局部 y 量化和未来世界坐标适配仍须与共享楼层规则一起核对。

`closedMesh` 检查的是每个独立 MeshPart 的索引拓扑，不是整栋所有相交部件合并后的无缝、无重复面或全局流形证明。远景 rectangle cover 允许相邻实例保留内部面，不能把它与单一封闭建筑实体混为一个结论。

## 四种旧生成配方、十二个可信世界的字节边界

每次 seed 原型检查均附同一组四种配方×三个 seed 的 **12 个不同可信世界**记录；这些重复记录不是额外的 36 个不同世界。

- `current-v3`、`current-v2`、`current-v2-r5` 各三个 seed，共 9 个：frozen generator 与相应原世界 fixture 的 `world` 直接 deepEqual，`JSON.stringify(world)` SHA 与 fixture 的 `worldSha256` 相同，原 fingerprint 相同。`makeBody(existing-envelope)` 前后生成世界序列化保持相同。
- `legacy-ee3e7a1` 三个 seed：从生成对象扣除新增 `layoutVersion` 后，原主体 JSON SHA 与 main 旧证明的 `mainWorldSha256` 相同，fingerprint 相同；生成的带标签对象在调用原型前后也保持相同。**这不等于带新增标签的整个 JSON 与原 main 全字节相同。**

这些证明保留原 frozen generator 的世界输出，不将 v4 候选占用体注入旧世界。它们不能替代未来新 v4 可信几何描述、唯一 fingerprint、存档 recipe 选择与旧档 Controller/renderer 再现的验证；只保旧世界对象字节，随后把新物理建筑描述用于旧档，仍会改变玩家可达空间。

fixture 从工作区读入，脚本没有把外部 fixture 文件 SHA 纳入其起止 33 源清单；此次复核也没有另外执行完整 fixture 捕获。其断言内容明确，但不应扩大为一次新的完整存档续演或浏览器恢复检查。

## 预算证据

| Seed | 候选/旧建筑远景三角数 | 候选/旧名义建筑缓冲 | 候选/旧名义空间材质几何组 |
| --- | ---: | ---: | ---: |
| 20261001 | 0.994473 | 1.063390 | 0.663130 |
| 7 | 0.994377 | 1.061913 | 0.658793 |
| 2024 | 0.995568 | 1.063600 | 0.658730 |

原日志均通过不超过旧建筑 component inventory 115% 的三角数与缓冲门槛。旧值通过 frozen `buildHouse` 记录器取得；候选值来自真实部件几何与拟定实例描述。名义组数和缓冲采用计划的空间合批键与属性尺寸，没有构造完整生产 renderer 或实际 GPU 驻留。

这些数值不能称为实际 draw calls、帧率、macOS 性能、GPU 上传内存、阴影总预算或近景释放检查。全城近景三角数仅作 accounting，尚未验证生产有限驻留的实际近景组数、创建/释放和总内存。

## 实际看过的图与设计结论

本次实际 `view_image` 检查了 `six-family-ground-plans.png`。市场、住宅、学院与诊所仍主要是同一种 U 形两翼加中央 spine；工坊和交通代表主要减少侧翼，形成后厅加中央 spine。庭院、廊道和真实门洞比完整方塔更有结构，但这张图不能支持六种用途已形成充分不同的建筑主体。

`mainSilhouetteSha256` 包含实际尺寸、楼层数和所有层的占用坐标，六个不同 SHA 不能证明六种归一化轮廓设计不同。单靠尺寸变化可使同一模板的 SHA 不同。root 已实际看过地面与体量两张 CPU 图；本复核实际看过的是地面图，不把 root 的观察算成本代理亲自看过体量图。

原型没有实体界面、生产完整近景、连续光照或正常玩家键鼠旅程截图。下一候选 02 可继续按相同共享占用体/碰撞/预算契约检查真正不同的用途轮廓；未使用同一生产 Controller 验证前，仍应称为 CPU 原型可达性。

## 复核结论

原型 01 的单部件闭合、庭院与平台支撑、共享墙体描述和建筑远景 component 预算有明确 CPU 证据；本次只读复核没有发现必须修改冻结生产源的缺陷。全城连续通行、未来 v4 可信存档几何、实际 renderer 驻留和六族审美差异仍未完成。本文件为新的独立复核记录，不更新根备忘录或需求矩阵。
