# 云山核心性能与异步 Worker 阶段交付

## 结论

本轮已实测原核心的冷启动阻塞，完成并验证一个保持完整存档相同的空支撑查询优化候选，以及唯一权威核心的异步 Worker 适配器。真实 Chromium DedicatedWorker 运算期间主线程仍可处理界面点击。核心冷启动仍慢：32 tick 同范围对照中，候选前 4 tick 合计仍为 25.744 秒。

Worker 解决的是表现主线程被同步核心占用的问题。它没有减少核心所需算力；忙碌期间新移动、命令和查询仍须等待。父线程原有私有 MZ 工程尚未采用此 Worker，原 CityUI 的同步接口也不能直接替换为 Promise。下一步需宿主接好异步输入、业务反馈与完整存档流程。

## 冻结版本与实现边界

- 原核心：提交 `6785ca7dcca09e8e97afd610cfd52176c7a1cfb1`，默认 seed `20261001` / `current-v4`，真实 612 栋楼、616 居民；原 164 执行输入。没有接公共维修需求候选。
- 空支撑候选只改 `floorPlanSupport`：没有支撑候选时提前返回，保留原公开墙板/上层板缓存建立顺序，以及畸形成员原异常路径。不缓存永久“无支撑”，不改碰撞、权限、路径、RNG、分级、钱、时间或世界几何。
- 原 provider SHA：`b4d0c35fb868deedfb10e14128c2f3255a1f3a5f3b54f2f853afb0d2656a4d42`；已验候选：`27431000d8f47ad5c5ece0e8c9319362c0610efda53559854a317995f1fc5f08`。
- 本报告读取时，共享 `src/architecture-floor-plan.ts` 仍与原 provider 相同；优化尚未接入生产 `src/`。适配器共享复制由 root 单独守卫执行，不在本报告声称完成。
- Node 与浏览器 Worker 使用同一原 facade：`b376c8480b707ef51f109e52b3c2469e41e6d132e217f080423df51b16cee2db`。它尚未包含上述性能候选。

## 已运行与已验证

各行是独立范围，不能相加为全项目测试数量。

| 范围 | 实际结果 | 可以证明的范围 |
|---|---|---|
| original/run01 | 12 原生 `.25` tick / 120 阶段；另 4 对真实续演完整档相同；exit 0 | 原完整 616 居民，十阶段与保存续演；测量未改变这 4 对核心结果 |
| compare32/compare32-01 | 每实例 32 原生 tick；初始及 32 完整档逐字相同；exit 0 | 此默认输入中候选保状态/runtime/RNG/route pool/模块档，世界不变 |
| geometry/build01 | `tsc --noEmit && vite build` exit 0；171 输入稳定、6 个 dist 原件哈希有记录 | 候选可构建；存在 bundle 大小提示，不冒零警告 |
| geometry/geometry01 | 15/15 PASS，0 FAIL/skip；171 输入稳定 | 实际楼体、完整支撑盘/门窗/屋顶/台阶、缓存可变与畸形路径范围 |
| worker/protocol01 | 6 具名案例 PASS；7 输入稳定；exit 0 | Node worker_threads + 原浏览器 IIFE 的 VM 协议/复制/FIFO/拒绝/坏档范围 |
| worker/capacity01 | 1 具名案例 PASS；7 输入稳定；exit 0 | 256 条真实入队命令保留每条已接受结果，不隐式执行或丢结果 |
| browser/browser01 | 3 具名 checks PASS；9 输入稳定；exit 0 | HTTP Chromium 151.0.7922.173 的真实 DedicatedWorker 与 DOM；并非 MZ/NW/file/Mac |

所有上述 owned 进程在回执中已结束；本报告再次读取具名 `/proc/<pid>` 均不存在。浏览器原 cleanup 记录 `browserClosed=true`、`serverClosed=true`，端口 4317。

## 原核心 12 tick 诊断

时间是本容器 Node 阶段墙钟观察，非 FPS。保持原构造的 drone mode，没有外部 setFocus。实际原 clock 从 08:00 到 08:03，续演到 08:04，speed 1；没有注入位置、需求、钱、角色、随机数或调整规则。

- 生成世界 3.204 秒，构造 Simulation 0.849 秒。
- 12 tick 原阶段合计 47.088 秒，完整 step 墙钟合计 54.596 秒；step 内观察器成本另记 7.505 秒，不能将其称为生产计算成本。
- people 阶段占已测阶段时间约 99.756%。该时间包括所有该阶段钩子，不能据此认定某一个函数已确认是瓶颈。
- 前 4 tick 阶段时间分别约 10.694、11.618、6.673、5.843 秒；后 8 tick 仍有 0.862 至 3.862 秒波动。
- tick 12 时 route cache 为 885 条 / 32,765 点，walking tree 为 245 棵 / 165,130 节点；尚未达到原 2,048 / 384 容量上限，不能由本测量归因于容量淘汰。
- 阶段中保存 SHA 只是诊断；恢复对照使用完整 tick 档，不宣称任意半阶段恢复受支持。

## 优化候选的同范围 32 tick 对照

两个完整原实例使用同 seed；奇数 tick 原先/候选后，偶数反序。只包围原阶段计时；完整导出和文件写入发生在 timed step 外。初始及每个完整 tick 共 33 对保存均已留原件，本报告再次直接逐字比较相同。

| 指标 | 原 provider | 候选 provider |
|---|---:|---:|
| tick 17–32 step p50 | 218.744 ms | 134.377 ms |
| 同 16 样本线性 p95 | 263.428 ms | 160.343 ms |
| 同 16 样本最大值 | 290.425 ms | 167.699 ms |
| 前 4 tick 合计 | 27.474 s | 25.744 s |
| tick 9–32 最大值 | 3,046.982 ms | 2,555.272 ms |

这是一次具体输入与容器的对照。它支持候选在此范围减轻查询成本，同时显示冷启动及后段尖峰仍存在。它不是 Mac、MZ 或渲染 FPS 测量，也不是新的长期城市稳态验收。

几何等价 driver 实际记录 1,017 次支撑查询、339 次路线查询（456 支撑、561 空支撑、204 路线），并检查有效公开描述变化。15 案涵盖完整盘/头顶障碍、真门净孔/玻璃、楼梯、屋顶、公开缓存寿命及 null/sparse 畸形成员异常。较早仅保 priming 的静态版本有 throw-to-null 差异，已保历史，不属于此次最终候选。

## Worker 真实合同与浏览器结果

主线程只用 `client.js`，唯一 Worker session 持有 Simulation/合法 HeadlessWalker。输入按单调序列的有界 FIFO 发送，仅一条在途；已发送动作不能假装取消或自动重试。可取消的是尚未发送的请求。队列确认与购买/门/楼梯等业务成功分开，调用方必须读取原业务结果。

接受前复制参数，返回快照是副本；旧样本有 epoch/generation/sequence 标记。完整保存经原 bridge codec 导出，包含队列与余量；坏导入保原全态。没有 tile 坐标 writer、裸 setFocus/step 或免费 teleport API。256 命令容量 guard 不偷跑 advance，也不自动领取结果。

真实浏览器的 Worker 8 tick 耗时 19.7717 秒；其间主线程计时器触发 973 次，最大 gap 45.9 ms。5 次真实 DOM 点击均在 `finished=false` 时得到响应，主线程 `coreOnMain=undefined`。Worker 结束并关闭后才在同 Chromium 顺序运行原 facade oracle，8 次完整 envelope save 逐步相同，没有并行原 oracle 污染心跳测量。

该计时器只证明此 HTTP 浏览器范围的主线程响应，不能换算为 FPS。Node 协议/容量测试不是浏览器证明；上面的 browser01 是另一个实际范围。独立 restoration scope 未在本报告列为已运行，不能用已测坏档/停机或 8 tick 对照代替它。

## 宿主仍须完成

1. 父 MZ 工程只创建一个 Worker owner，渲染只消费复制样本；避免同时保留主线程同步核心。
2. 将真实输入间隔映射到原合法 Walker，不把积压墙钟时间补成新的移动输入；保原 paused、速度、碰撞、楼层权限和交通规则。
3. 改造 UI 与命令反馈为异步：排队成功不等于交易成功，忙碌/过期样本与不确定结果应明确表现。
4. MZ 存档先 await 完整 Worker 导出，再进宿主保存流程；同步 makeSaveContents 不能从临时快照拼档。加载失败保原态，成功后更换 generation/世界副本。
5. 单独验证 MZ/NW.js/file/CSP、停机/错误处理与父实际工程；随后才能报告宿主采用或实机性能。

未运行/未验：新全套、macOS 硬件、MZ 编辑器/实机、长期 14/30/60 日经济、全城稳态及新美术验收。完整用户目标仍开放。本轮没有以减少居民、修改时间/工资/资金或绕过碰撞来换取性能。

## 原件索引与本报告

`validation-results.json` 列每个真实 scope 回执、完整指标、33 对存档 SHA、4 对续演 SHA、实现/接线边界；`manifest.json` 列本报告文件 SHA 和各必要原件的绝对 sourcePath、字节数与 SHA。未复制大源/原档，原件目录由 root 后续整体收集。

- original：`/tmp/yunshan-core-performance-6785-20261003-01`，raw `03ac7e59…`。
- compare32：`/tmp/yunshan-core-empty-support-root01-20261003-01/compare32-01`，raw `94075e21…`。
- geometry：`/tmp/yunshan-geometry-performance-verified02-20261003-01`，build raw `fd15b66d…` / tests raw `d3c3678b…`。
- worker：`/tmp/yunshan-mz-worker-root01-20261003-01`，protocol raw `8ccdeba4…` / capacity raw `92a4d76c…`。
- browser：`/tmp/yunshan-mz-worker-browser-root02-20261003-01/browser01`，raw `93924ab5…`。

较早 README/SEMANTICS 的静态 NOT_RUN 字样是当时交接记录，保原字节；本报告用实际后来回执更新当前结果，不覆写历史。Library/Git 交付由 root 独立 producer 回执确认，本报告不填写未经返回的 ID。
