# ROOT25 41506护栏交点分支只读审阅

本审阅只读源码、冻结清单及既有pure/factory回执，没有执行游戏、几何生成、测试或重门。审阅对象 `src/transport-geometry.ts` SHA `37c07ac5eca27d895d32c37494caf737ab4bfb68a66f6d20f63d91f0a831e38c`，冻结41506清单SHA `2e33e21e1acfd80d7a05cc984948dd07f7201ad5a226538e6fb9d20f41f43d02`。

已有保护在源码中明确保留：

- `transport-geometry.ts:29–30/80`缓存键包含edgeCount与streetGuardJoinRevision，切换revision时不能沿用旧rail数据。`world.ts:449`只在新current-v8声明revision2；`types.ts:41`限定该声明，旧默认不被隐式赋revision2。
- `transport-geometry.ts:54`旧recipe继续跳过同edge的segment配对；不同edge的旧交点路径没有改为新recipe专有路径。`54–60`只允许XZ真实线段交点，平行/共线、交点超出任一原段及插值高差大于 `.26+1e-8` 均拒绝切口。这保留**大于该原same-grade容差**的不同高度隔离；不能概括为任意非零高差都隔离。
- `37`只参与road/bridge，机场runway-strip跳过；rail模式没有进入交点切口。`65–67`切口来自交叉实际deckWidth、原`.35`身体净空、原guardrailOffset、夹角与真实3D弧长，未clamp高度或弱化身体半径。
- `72–78`仅从原闭合rail区间扣除实际开口，`74`与开口不相交的区间保留原值。`89–95`将这些剩余区间投影回原segment，远离开口的span因此按原区间保留；旧端部6m规则仍在`36`。
- `renderer.ts:803/833/843`使用guardrailSpans/hasGuardrailAt，`public-street-birth-check.ts:223`也使用同spans；`transport-geometry.ts:115–119`运行时barrier按同intervals。`persistence/world-layout.ts:54`把revision与算法版本纳入新v8fingerprint。共享数据来源存在，但这项静态检查不替代实际Controller完整旅程或GPU像素核验。

验证范围仍有限：既有新增测试 `tests/public-street-birth.test.ts:142–152`覆盖一个同edge真实bend、离开bend沿弧13m处rail仍在、renderer span起点及删除revision后的cache复原；root pure04实际14/14 PASS。它没有覆盖同edge自交两层高差刚好跨`.26`、多个相邻短段/极浅夹角、非相邻自交、更多远端rail或所有旧layouts全部guard spans的新冻结比较。

需保留的静态限制：`65`的half含`1/sin(angle)`，除`55`原cross阈值以外没有固定开口半长上限，也没有按参与segment端点裁切cut后再传播。近乎平行的相交或短段弯接可能让全edge弧长开口很长，`72–78`会在全edge区间扣除该开口。因此“开口区间之外保持”有代码依据，“任意远处护栏一律不会被影响”尚无普遍界。是否应裁限必须服从真实交叉deck需要，不可仅为过门截断；下一阶段应由root单门验证实际同高短/浅角几何与不同高隔离，并检查真实远端保留。

既有实际门：fresh01 FAIL负Z微坡local+Y实际底面、fresh02在修正实际上表面后FAIL elevated self-bend rail堵门/8m curb超过原.22；失败回执不改。fresh03实际read-only factory PASS已读取（0Sim/0step、两World输出exact、production walking journey存在；`actualNativeWalkingEstablished=false`），只说明完整v8工厂与只读共享几何，不是原始Controller/W/E购买退出或GPU通过。

## 后续41702修正追加（旧发现不删除）

root已修新同edge浅角开口传播：`transport-geometry.ts:67–74`先保留按原deck/body/angle计算的opening，再仅在`joinRevision===2 && current.edge===crossing.edge`时将start/end限制到当前参与真实segment的3D沿程区间。不同edge旧算法未触碰；不同高隔离条件仍在`60`。因此当前新self-edge切口不能越过该参与segment擦除后续不参与的rail；原41506“无segment端点裁切”的发现只属于旧冻结，不再作为41702当前缺陷。

当前源SHA `33242b2817676b19f50e998c1ea642923ec87cc9c9f7261cae2d2aa7022c01ea`；FROZEN-417-02清单417项SHA `86de9f68bbc388fa1cabb62a4d8711455df398cd80bac6a0bef85766b9eacce4`。`STREET_GUARD_JOIN_VERSION`变为`actual-same-grade-deck-joins-within-participating-segments-v2`，原v8fingerprint继续包含该实际算法版本。

既有真实pure07门PASS20/20，417输入stable/active[]，raw SHA `902705fc63e313db2def18b0aa1241e8aeb39e39aff359b349a4528ec8de45cc`；新增 `tests/public-street-birth.test.ts:209–216`浅角同edge自弯之后无关segment护栏仍在。没有由本审阅者执行该门。更多高差边界/多段自交与完整Controller/GPU仍以之后实际门为准；不继承fresh03旧输入factoryPASS至修改后的41702。
