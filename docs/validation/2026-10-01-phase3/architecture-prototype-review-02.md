# 建筑原型 02 独立只读复核

对象：`/tmp/yunshan-architecture-prototype-02` 最终冻结稿。复核原型 `floor-plan.ts`、`check.ts`、新增 `gpu-template-proof.ts`、最终 README/summary、三 seed 原始 `check-frozen-*.log` 与结果、69 文件 manifest，并亲自查看最终两张 PNG。此次只读复核没有改原型或生产、没有运行 GL、没有操作 profile 或存档，没有重新运行完整生成/规则测试；只运行文件 SHA 和结果对应范围的只读断言。新增本复核文件不改变冻结的生产源清单。

最终 manifest SHA256：`fd3c9fc76dc73095bfd82a602f730eaee5fc1f6c8403a3f0c00c2b70f7c5262b`。独立核对 **69 个交付文件 SHA、33 个 frozen 源 SHA** 全部一致；三个 seed 的原型起止 SHA 均与当前源码相同、`errors` 均为空，最终 raw log 都含 PASS。原型来源仍为 checkpoint `3f01707581eef697572ffa58bdb994bef037e98d`，不是 coherent04/05 的全生产候选验收。

仓库中的[完整原件 ZIP](architecture-prototype-02/original-prototype.zip)也只读核对：103 个成员逐字节与最终 `/tmp` 原件相同，CRC 检查通过。ZIP SHA256 为 `5992a5d805c97077240b12ceb0034bfc62bd6541258e9502300c4626960e5eb4`。没有解压覆盖原件或重新生成结果。

| 最终文件 | SHA256 |
| --- | --- |
| `prototype/floor-plan.ts` | `1d1966d694f11fb86d3d78a5fa32474606a7c417f8741c3fa4d01794d209d326` |
| `prototype/check.ts` | `5d4c208807e6dcd4e27b9aad6bcb6f531d913bc10ea0edd8a5c76e00b94528ab` |
| `six-family-ground-plans.png` | `9525acea387d2c2b69a0433f4f5abafbad60dd449fb232c305d02ecd9d791698` |
| `six-family-bodies.png` | `34f98598505c55edace275a2370f4dff0136f259960d92863f248ee0074994b8` |
| `gpu-template-proof.json` | `ef239ab7dc002ca4d101004368829fed539824fa94125898d21771cbe7c550b2` |

## 实际像素观察

最终地面图确有用途轮廓差异：市场为三铺、背面后厅与横廊；住宅为不等宽主侧翼与独立前翼；工坊为宽厅加前廊；学院为前门院、两侧翼与后堂；诊疗楼为 H 形联络部与病房翼；交通楼为开放候车地面、低棚和一侧服务翼。它们的占用拓扑已不同于 01 多用途共用的 U 形中轴主体。这一判断来自实际看过的图和矩形并集描述，不以六个不同 SHA 代替设计差异。

最终体量图也实际查看过：住宅有低侧翼，市场保留低铺面与后厅，工坊形成较宽生产体量，学院有低前门院，诊疗楼不等高翼楼明显。交通楼已经去掉无必要的上层中轴 spine，图中只保留原 shaft 服务翼的高体量和低棚；原多余双塔稿保留在 history，未混为最终图。

这些图仍是 Matplotlib 对实际 far mesh 的 CPU 几何图。直立大墙面、简化盒体和高服务翼依然明显，不能据此声称近景门窗/家具/材料/光照已完成、用途可在游戏远景可靠辨认、参考图视觉要求已达到或浏览器成品已交付。

## 新共享屋顶模板契约

候选使用闭合低坡 gable 体，不再为每跨度堆叠五层独立屋顶盒。实际跨度若含奇数个 0.2m 单位，生成一条真实 0.2m 平檐封条；剩余坡顶跨度可被 0.4m 整分，使 ridge 在 0.2m 格上。并集的矩形覆盖决定实际屋顶范围，空庭院不被整幅屋面覆盖，显式廊道仍有低顶。

两种归一化 profile 以 `[0,1]` 坐标表示。矩阵锚点为 **rect 最小 x/z 与 bottom y**，缩放为真实宽、高、深；它不是原 centered BoxGeometry 的中心锚点。未来 renderer 必须使用该约定，否则直接沿用旧中心矩阵会产生半跨度偏移。建筑世界位置、整体 yaw、共享楼层 y 偏移、正常法线矩阵及 cutaway/floor roof 引用仍需生产接线验证。

主 check 对各屋顶实例的归一化顶点逆变换逐顶点与实际 mesh 比较，误差小于 1e-7。独立新增的 `gpu-template-proof.ts` 又把 position/normal/uv 转成实际 Float32 数组，检验有限值、模板法线单位长度、真实属性与 Uint16 index 字节，并应用正确锚点 Matrix4 还原 mesh 顶点。其原始 JSON/log 在 **seed 20261001** 上记录：

- 4637 个屋顶、46370 个顶点、2 种 profile。
- 最大位置误差 `1.1920931797249947e-8`。
- 最大模板法线单位误差 `2.396170539764597e-8`。
- 世界 JSON 不变、真实数组属性字节相符。

这解决了仅按 double JSON 坐标推断 GPU 数据的证据缺口。但该额外 proof 不是三个 seed 的 Float32 全覆盖，也没有 WebGL 提交、材质 shader、非均匀缩放后的实际渲染法线或近远镜头连续切换验收。

## 最终预算与原始失败保留

| Seed | 旧/新名义组数 | 候选/旧远景建筑三角数 | 候选/旧名义建筑缓冲 |
| --- | ---: | ---: | ---: |
| 20261001 | 377 / 391 | 0.917672 | 0.961518 |
| 7 | 381 / 394 | 0.914380 | 0.958151 |
| 2024 | 378 / 388 | 0.919599 | 0.961452 |

三 seed 的 triangle、buffer 和名义空间/材质/几何组均通过原 115% 守卫，未放宽门槛。旧值由 frozen `buildHouse` 记录器获取；候选值来自实际部件和共享模板属性字节。较早1372名义组稿、堆叠屋顶超预算稿、上层多余中轴塔稿及其图/源码/日志仍保留在 history，最终计数不能归给这些旧稿。

这仍是建筑 component inventory：没有构造完整 renderer、实际 frustum 提交、阴影总量、GPU draw calls、FPS、macOS 硬件性能或近景真实驻留/释放测量。全城 near geometry accounting 也不等于生产活跃近景内存。

## 保留的通行与兼容边界

01 的[独立复核](architecture-prototype-review-01.md)所列基本边界仍成立：地面庭院和 shaft landing 有真实 slab，shaft void 被扣除；墙体 mesh 与 collision 来自同一描述，但 `closedMesh` 是单个 MeshPart 索引流形，未证明交叠多件整体无缝。`canStand` 是中心加四轴身体支撑采样，非完整圆盘 sweep。

每 seed 612 栋、3516 层都检查 shaft/usePoint 可站、占用 bounds 与层高；**只有六用途代表的各层**执行 0.8m 网格 BFS。其余 606 栋没有完整逐层 BFS，六代表 BFS 也不是实际 Controller 连续 WASD 行走。门外检测的是地形/步面有限与门内落脚，未验证实际道路→公共入口→用途点的连续接入。旋转、权限、上下楼动作、体素障碍、NPC 真实到场和设施使用仍需共同接线。

旧 12 distinct case 的范围不变：v3/v2/r5 三 recipe×三 seed 共 9 个完整 world deepEqual/JSON SHA/fingerprint 相符；legacy 三 seed 扣除新增 `layoutVersion` 后与原 main 主体 SHA 相符，含新增标签的完整 JSON 不等于原 main 原字节。原型调用前后世界字节相同，不是12次完整模拟存档续演或旧浏览器 profile 恢复。

core-main/pavilion 保留原 renderer/body，原30地上层、2地下层和权限断言不改。新物理占用体不能直接套给旧档：真实 v4 必须保留四旧配方，指纹纳入可信物理 floorPlan 版本，并共同连接 world/floorSupport/getWalkHeight、access/Controller、near/far residency、真实用途点与 persistence recipe 选择。只保旧 world JSON，却改变旧档物理占用体，会改变玩家可达空间；未知描述仍须拒绝。

## 结论

02 是比 01 更明确的用途轮廓与共享屋顶 CPU 候选；原件哈希、图、最终三 seed 日志和新增 Float32 模板证据相互一致。此次只读复核没有发现必须修改冻结生产源的额外问题。可以据此继续设计可信 v4 的共同物理契约，尚不能将其记为生产建筑、全城通行、存档恢复、真实渲染驻留或视觉验收完成。此次仅新增独立复核记录，未改生产、原型、根备忘录或需求矩阵。
