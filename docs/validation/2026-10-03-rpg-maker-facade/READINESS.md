# RPG Maker facade 交付只读复核

复核结论：**可作为同一冻结城市内核的 facade 候选交给制作方接线。** 49 个 `src/` 文件与原 Git `6785ca7dcca09e8e97afd610cfd52176c7a1cfb1`、共享源码、ROOT03/06/07 均逐 SHA 一致；正式 ROOT03 IIFE 的 32 个运行输入全对齐，没有 Three／DOM／Node 运行依赖或外部导入。公开 API、米制量纲、三维门限和原楼层 ACL、固定十相位、原核心完整存档保持一致。复核未确认新增生产实现阻塞。

实际验证须写成：**ROOT06 全轮 14 项中 13 PASS／1 FAIL；ROOT07 修正 fixture 后 upper-door 针对性 1 PASS／0 FAIL。** 这是两个不同范围，不能称单轮 14/14 PASS。真实 MZ 接线、编辑器 GUI、用户本机与 Mac 性能仍不属于这些证据。

本复核遵守共享与候选 `AGENTS.md`，读取原提示词、当前备忘录与追加任务要求；仅用源码、Python、SHA-256 和只读 Git 原件读取。全部复核文件写在本独立 `/tmp` 目录，没有 Node／tsc／npm／浏览器执行、ZIP／上传、Git 修改、官方 MZ 资产复制或共享备忘录编辑。

## 源码、正式 bundle 和契约

最终候选为 `/tmp/yunshan-mz-root07-20261003-01/source/adapters/rpg-maker/`，正式 bundle 为 `/tmp/yunshan-mz-root03-20261003-01/bundle01/`。ROOT07 对 ROOT06 只修测试 fixture、补 README；bridge、walker、build、tsconfig、core manifest 与 ROOT03 全同。ROOT06 原测试／原回执保持原字节。

| 文件 | SHA-256 |
|---|---|
| ROOT07 `bridge.ts` | `87ddfb0ce805f5f3a2643ef4c33d03fd323c9aab408604c5dfa09411a1d03927` |
| ROOT07 `headless-walker.ts` | `c40553f2489fb19ce30b323c330d386264301451e9287f1b2dc22f8d51b52414` |
| ROOT07 `bridge.test.ts` | `08e8f1300930f5ec988312b59404c56d0e7b871ea846dfce3bc63d5ed29bcef0` |
| ROOT07 `README.md` | `1edbde7ca3507a0cd1e390cd8dbe541e49774a4428bce7b49e748f0762b7f671` |
| ROOT03 `YunshanCore.js` | `b376c8480b707ef51f109e52b3c2469e41e6d132e217f080423df51b16cee2db` |
| ROOT03 `bundle-metafile.json` | `d10d180202b93da0a5ba966d3533df8bcafb86e9c48c1b1c5cc148fe8aba5c92` |
| ROOT03 `contract.json` | `8a2f04942d8deda00eb2a2f5bdf185ed035d94825aeedabd93e9e449da478310` |
| ROOT03 `initial-core.save.json` | `64479d66a295320791bb5f00c20356170f38e1a391c6a5c024446544b9f5bb2b` |
| ROOT03 `world-current-v4.json` | `a054d6592de8383222caa5174a726cdbce25fbef36fbb2456ee3bb84c667d1e8` |

元数据实际列出 30 个原核心模块、2 个 facade 模块；32 项源码大小与打包元数据一致，生产源码 SHA 与 ROOT03 同，输出 imports 为空，所有输入边均在图内，正式 5 个输出 SHA 与 build receipt 一致。构建脚本和测试自身的 Node 依赖不在运行图中。生成代码中的 `window` 是建筑窗户字符串或局部教学／研究时间窗口变量；原 `roads.ts` 的局部 `require` 是校验函数，正式 IIFE 没有未解析的 CommonJS `require(...)`。

默认世界仍为原 `current-v4`／seed `20261001`／指纹 `80cd31e2`，612 栋、616 居民、11 区、674 节点、691 边，原 IDs 保留。单位为米，x 东／y 高／z 南，voxel 0.2m，地面 floor0／地下负数，步行 4.8m/s／跑 10m/s。`contract.systems=[]` 是 tick0 的未执行历史；`fixedPhaseOrder` 与原 ORDER 相同，实际 tick 后的十相位断言已在 ROOT06 通过。

`CitySession` 私有持有原 Simulation/world/walker，公开查询返回副本；`advance` 在验证输入后处理原命令 FIFO，再以 1/60 真实秒身体子步交原 Simulation.step。核心每累计 .25 真实秒按 time→environment→energy→traffic→people→commerce→finance→security→politics→feedback 更新，原 speed／暂停／RNG 继续由核心拥有。MZ tile/event 应投影实际身体，不反向写位置，也不能另起模拟、账本或 NPC 日程。

`useDoor` 在 `bridge.ts:112` 先要求真实三维入口距离≤6m，再走原 walker 与 `canAccessFloor`；拒绝不 flush 队列。`useStairs` 使用原近梯触发与合法楼层循环，不能指定任意 floor。`exportCoreSave` 原样导出 `yunshan-save` v1，完整 state/runtime、route encoding／pool及模块校验保留；`yunshan-mz-save` v1 只在外层加桥接余量、pending／result和序号。新导档先重建可信世界与完整验证，再安装 session。

## 原始验证范围

| 范围 | 实际结果及限制 |
|---|---|
| ROOT01 | type/build exit0；早期 walker 版本，仅历史证据 |
| ROOT02 | walker 差分 10/10 PASS；type exit2 的两项测试类型错误原 raw 保留 |
| ROOT03 | type/build exit0；bridge 原轮 exit−9 中止，不能算完整 PASS |
| ROOT04 | type exit0；范围仅类型检查 |
| ROOT05 | bridge 原轮 exit−9 中止，不能算完整 PASS |
| ROOT06 | type exit0；bridge 14 tests＝13 PASS／1 FAIL，0取消／skip／todo；171 输入首尾同，owned PID 退出 |
| ROOT07 | type exit0；仅 upper-door 1 test＝1 PASS／0 FAIL，0取消／skip／todo；171 输入首尾同，owned PID 退出 |
| runtime-diagnose／vm-intrinsics | 因果诊断 exit0，保原件；不是 GUI 或硬件性能验收 |
| upper-fixture diagnostics | 原 homes finder 前提 FAIL 保留；bank floor1 finder PASS 只证明点位，不代替门业务；随后 ROOT07 原业务断言已实际通过 |

ROOT06 全轮 raw：`/tmp/yunshan-mz-root06-20261003-01/bridge01/raw.log`，SHA `43d6dc677d2164763f2f42a58616e22e7f4af566fee4fcc29545f3cd36bbcddc`。其唯一失败停在旧 `bridge.test.ts:269` 的 locator 前提，门拒绝断言未执行；不能据该轮称门行为失败或通过。

ROOT07 针对性 raw：`/tmp/yunshan-mz-root07-20261003-01/upper-door01/raw.log`，SHA `f54e81063cbe5b780a44f6be1f9e3694fff109041c1134d9ee264e8c54b4a16b`。实际 17:04:24—17:04:42 UTC，exit0。修正仅找原生成钱庄 `market-b3` floor1 的真实有权限／半径 .35m 支持盘／1.72m 身体可用点：`(-187.8,43,764.2)`，水平距门 `5.946427498927397m`、三维距 `7.397296803562766m`。移除旧 locator 自加的 floor≥2 与竖直距>6 条件，仍保三维>6、原门拒绝、完整 envelope/待执行队列不变与远门拒绝强断言；不改生产门限或玩家身份／现金／世界。

ROOT06 已实际通过相同 IIFE／原同 seed 核心、时基／十相位、快照隔离、FIFO与0秒flush、远售原子拒绝、近售钱库存一致、坏档原子拒绝及+24、完整桥接档+24、legacy档+24、真实 ride／权限 drive 和非法 advance 在 flush 前拒绝。+24 范围不能推广为所有连续步行、楼梯、门或任意 MZ 宿主接线的续演证明。各历史范围不相加计数。

## 交付边界与实际限制

父制作任务已另交私人原生 MZ 1.10.0 ZIP，LibraryID `libfile_3c0d4a37cd0081919db55fa1cee3f5b1`，仍使用同一6785的原 Simulation／CityUI／PlayerController；**该 ZIP 尚未采用本 facade**。本复核没有解包或重新打开它。两者兼容边界是原 canonical `yunshan-save` 核心字符串及可信世界指纹；两个外层 wrapper 不自动互换。采用 facade 时须另接表现、唯一时钟、合法输入与 DataManager 桥接 envelope，再做真实 MZ GUI／开局／游玩／保存恢复验收。

现有“浏览器 IIFE”证据实际为 Node 隔离 VM 使用自有 Math/JSON 标准引用、仅宿主提供 TextEncoder/TextDecoder；不是浏览器或 MZ GUI。Linux原核心首完整 tick 在已留诊断中约8–11.5秒，lexical VM实测11490.992548ms，这是具体启动响应限制，未证明实时性能、FPS 或 Mac 硬件表现。完整 JSON 快照应按显示需要采样；结果最多256条、事件历史有界，宿主须及时读取。

官方 MZ 引擎与素材保持私有，不混入公共 Git。本 facade 不宣称完整游戏目标、经济稳态、美术或全部自然灾害／拆迁／深层服务／自定义地图／流式统计加载已完成，继续以共享备忘录和需求矩阵为准。

复核结构化原件：`source-alignment.json` 逐文件／32输入／bundle SHA；`contract-alignment.json` API／单位／相位／命令／默认世界及存档；`evidence-ledger.json` 原 raw/receipt SHA与结果；`limitations.json` 独立测试口径、旧ZIP关系及未验证项；`api-review-notes.md` 独立源码行复核。`audit_review.py` 可用 Python 重复只读核验。所有 ROOT01–07、runtime-diagnose、vm-intrinsics、upper-fixture 原 raw／receipt 保留原目录，未被本报告覆写。
