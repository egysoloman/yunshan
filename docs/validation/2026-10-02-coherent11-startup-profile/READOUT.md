# Frozen11 启动 CPU 采样原件与离线归因

本包保存一次独立启动诊断与离线样本计数，不是正式 browser11、原生住宅休息/IndexedDB、macOS、FPS、吞吐或美术验收。原 frozen10 compiled browser 在第一个断言前等待90秒失败，0/11 的原事实保持；本轮没有重跑或替换原判据。

## 已运行范围

- 实际诊断：2026-10-02 15:49:48.574–15:51:26.583 UTC，orchestrator session41100，exit0，DIAGNOSTIC_RECORDED。
- Profiler 在 navigation 前成功启动。90秒时仅一次 stop 请求；响应晚1.303秒。观察窗口实际90,008毫秒，清理在窗口外，原 profile 不裁剪。
- 默认1440×900、SwiftShader、1×，未更改设置、城市、NPC、现金、需求、身份、位置、天气、时间或命令。CDP/采样/只读定时器、rAF与DOM观察有开销。
- Frozen105输入、共享100可执行输入、外部 probe/contract、entry/maps 起止相同。entry /assets/index-CxfucW3u.js，SHA256 7ed91565c741671b4f25571118bc07d515d4ff1e42b0e3c55b6044077b2a2da9。独立HTTP与浏览器实际响应均200并匹配647107字节。
- Chromium162009与自有preview161991均正常结束；原 /proc identity 后不可用，自有4191端口释放。未使用Debugger.pause，也没有新GPU/Simulation/test运行。

## 实际观察与截图

页面时间轴约15.875秒已发布debug与UI，tick0；在主机导航+82.231秒取得最后一个成功快照，页面performance.now=82.2155秒，tick8，renderer frame3，probe rAF6，十阶段完整。

唯一原PNG是 observed-page-initial.png（1440×900），主机导航+5.251秒取得。root与本生产者实际查看：均匀浅灰绿色背景，没有可见城市或UI。这是启动诊断原图，不能当作城景/美术交付正向证据。末图 NOT_CAPTURED：90秒窗口结束，未延长等待或合成替代图。中间只读快照和最终快照超时均保留。console/pageerror/requestfailed 事件0并不代表正式业务通过。

最后已观察到8ticks；profile stop响应晚1.303秒，不能断言采样窗口只含恰好8ticks。完整原时间轴与longTasks在 originals/probe-evidence/snapshots.json，精简索引在 phase-readout.json。它们不直接定位具体源码函数的连续墙钟耗时。

## 样本结论

原CPUprofile 2,351,929字节，SHA256 e6905e952854f8b7967a76817543056aa37106f6dc3680ffb47eb20fea208515，73,462 samples /1,974 nodes。全部9个负 timeDelta 原字节保留；不钳制、累计为函数耗时或计算墙钟百分比。

单节点inclusive计数：frame 52,397；Simulation.step 49,330；people 46,899；floorPlanRoute 36,575；renderer构造9,755；buildLandscape 6,569。这些嵌套、互相重叠，不能相加。它们支持本轮同时包含启动构造和早期人物寻路/碰撞检查。

跨栈按真实generated callFrame函数起点合并后，exclusive计数：

| 函数源码参考 | exclusive samples |
| --- | ---: |
| localSolids | 8,945 |
| blocksFloorPlanMovement | 6,209 |
| localSolids内部map绑定 s | 5,751 |
| circleRectDistanceSquared | 4,170 |
| getBuildingBody | 881 |

mapped architecture-floor-plan.ts 全文件exclusive计数49,819；controller文件62，含该文件祖先的样本332；chunk-residency文件6，祖先范围78（其中update74）。Three bundle exclusive2,479；所选Three render函数祖先范围1,182。主entry bundle分类63,124含少量打入该bundle的依赖代码，不等于自研源码专属计数。program-or-unattributed4,913、GC2,855、idle51、other/observer40单列；它们不分派到任意JavaScript self、GPU或native函数。文件/函数inclusive及祖先范围非可加项。

报告 original cpu-attribution.json 是每个V8节点的top50；cpu-attribution-functions.json 合并同一generated URL/line/column/name在不同栈上下文的节点。递归时同一个函数在每条样本祖先链仅记一次。两份都只作样本归因。

## 源映射和缓存边界

实际两个source map均逐字SHA绑定。报告中的original position是按V8 callFrame函数起点generated line/column选择最近前置映射segment后得到的源码引用：不是sampled execution PC，也不精确标示函数内当前执行行。函数起点属于源码寻路函数，不证明样本必在BFS；同函数也做端点连接、直线检查和简化。不能只凭minified functionName或绑定名判因。

静态源码事实：getBuildingBody已使用primitive与array/reference比较的WeakMap快路径，不是旧13字段join；floorPlanSupport已有radius0不构造localSolids的分支。localSolids/nearPlans/stairSurfaces仍构造共享物理描述数组。Simulation.floorPlanRoute键包含building/fromFloor/toFloor及完整from/to XYZ，仅无voxels时读写缓存，routeCache上限2048。profile没有cache hit/miss计数，不能据采样声称命中率、缓存失效或把GC直接归因这些分配。当前证据将进一步JS调查范围缩到真实共享寻路/碰撞描述调用；不证明原10的启动失败根因，也未实施任何优化。

## 文件范围与原件保护

originals/保存本轮全部原profile、观察JSON、初始PNG、manifest、源契约与as-run脚本。frozen-source/是该manifest105个输入的原字节副本；frozen-dist/是实际编译产物及maps。它们含旧脚本与历史文档，不能将此包当新完整测试通过或最新产品交付。离线aggregate脚本与报告单列，未修改as-run脚本或原profile。上一轮28成员 frozen10 ZIP不包含在本包，也没有重新上传。

archive-member-index.json记录每个载荷成员的来源、字节、SHA；外部archive-validation.json记录全成员ZIP CRC、逐成员SHA/原字节对比、105输入核对。无node_modules、浏览器profile/用户数据、凭据或签名URL。本包Library身份在ZIP外的delivery/library-delivery-receipt.json中记录，不会回写ZIP字节。

正式browser11及原生床边W/IndexedDB流程仍未运行于frozen11；Mac/美术/fullgoal不在本轮范围。
