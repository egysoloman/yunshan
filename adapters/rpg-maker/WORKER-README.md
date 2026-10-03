# 云山 Worker：实际状态


冻结6785/b376完整内核：Node transport protocol及256capacity两独立范围实际PASS；真实Chromium151.0.7922.173 HTTP DedicatedWorker八tick/616居民/原十阶段与clock、fullshutdown及停止worker后同browser原facade逐完整save对等全部PASS。运行期间五次实际DOM点击响应，main无YunshanCore/第二Simulation；timer973次，最大间隔45.9ms，Worker八tick约19.77s。这是界面隔离与语义证据，不是MZ/NW file origin/FPS/Mac/实时吞吐验收。原旧私有MZ工程尚未采用此Worker。

源码及原件见仓库 `docs/validation/2026-10-03-core-performance/` 和本轮Library handoff；以下早期STATIC说明保留为准备阶段历史，当前状态以本段与原回执为准。采用时宿主需要显式异步交易/输入/保存，不能把原CityUI同步API当drop-in或在ack时显示业务已成功。浏览器文件无需用户安装Node；协议复现实验使用 `--bundle adapters/rpg-maker/browser/YunshanCore.js`。


## 静态准备阶段原说明

# 异步 Worker 适配器（静态候选）

当前核心单 tick 可能花费数秒。DedicatedWorker 将真实内核运行移出表现主线程，避免一次同步调用直接阻塞主线程；它不会减少核心计算量，也不能保证实时、MZ 帧率或输入延迟。忙碌 Worker 的新输入只能等前面的请求完成，画面可以继续绘制，但人物和城市样本可能过期。不要把积压墙钟时间补成新移动输入。

本候选不包含 RPG Maker 官方引擎、素材或完整工程。生产 bridge、walker 和核心 `src/` 未改。Worker 加载已冻结的 `YunshanCore.js`，SHA-256 为 `b376c8480b707ef51f109e52b3c2469e41e6d132e217f080423df51b16cee2db`、核心提交 `6785ca7dcca09e8e97afd610cfd52176c7a1cfb1`。主线程仅加载 `client.js`；它不加载核心、不拥有 Simulation、不调用 step，也不另造616居民/金币/坐标或随机数。

## 宿主连接

通过同一可信来源提供三个普通脚本：`client.js`、`worker-entry.js` 和上述原 IIFE。`worker-entry.js` 为 classic DedicatedWorker，内部用 `importScripts(coreUrl)` 加载正式 IIFE；主线程不要再加载它。构建/交付方必须校验 IIFE 字节哈希（`frozen-binding.json`），运行时同时核 commit/version。运行时元数据检查不是网络字节完整性验证。Worker、脚本来源和 CSP 必须由宿主正常支持；尚未验证 MZ/NW.js 的本地 `file:` 环境，不能称其已可直接运行。

```js
// client.js 已通过普通 <script> 加载。
const city = YunshanWorker.createClient({
  workerUrl: new URL('worker-entry.js', location.href).href,
  coreUrl: new URL('YunshanCore.js', location.href).href,
  options: {seed: 20261001, layout: 'current-v4'},
  maxPendingRequests: 32
});
const opening = await city.ready; // 原 metadata / 616 actorCount / 实际 tick/clock
const world = await city.worldSnapshot(); // 每次成功加载城市后仅跨线程取一次；以后给副本
const frame = await city.advance(1 / 60, {x: 0, z: -1});
await city.queueCommand({type: 'purchase', targetId: 'river-b1', value: 1}, 'buy-1');
await city.advance(0); // 原合法命令 flush；不推进 tick
for (const row of await city.drainResults()) {
  // queue ack 不表示买到了货。这里只能按原 row.result.ok/message 呈现。
  showCoreMessage(row.result.message);
}
const sample = await city.sample('snapshot');
if (city.isCurrentSample(sample)) renderCopiedState(sample.value);
const save = await city.exportSave(); // 原 bridge 完整 envelope，不从 snapshot 拼档
const loaded = await city.importSave(save); // 必须检查 loaded.ok；失败保原全态/队列/余量
const final = await city.stop(); // 等已有 transport 请求完成，返回完整原 bridge 存档
```

所有业务返回 Promise，宿主必须 await 后才确认操作。`advance` 完全调用原 bridge：0..1真实秒、1/60子步，累计.25真实秒运行原十阶段，默认一秒=一游戏分钟。适配器不改速度/needs/工资/角色，不增加每帧或每秒新 tick。移动、门、楼梯、驾驶/航空控制都在唯一 Worker session 内交原权威规则校验；无 teleport/setFocus/裸 Simulation API。

## 顺序、背压与结果

每个客户端 epoch 有自动唯一 transport requestId 和实际发送时单调 sequence；它们与 `queueCommand` 的 core commandId 分开。只有一个已发送请求，其余在有界本地 FIFO 中。默认上限32包含在途请求，允许2..256。满时拒绝新增；已接受请求不丢弃、不合并、不自动重试。参数在本地接受前 structuredClone，响应再拷贝，表现层修改副本不影响内核。

Worker 对合法协议请求先发一次 `accepted`，再发一次 terminal `result`。这仅确认传输和 API 调用。`queueCommand` 返回 commandId 表示原 bridge 已入队；业务结果要显式 `advance` 后 `drainResults`。`useDoor`/`importSave` 等返回的 `ok:false` 是原业务拒绝，不能把外层成功响应当业务成功。未知方法拒绝且不调用核心；读接口仅有显式白名单。

原 bridge 的 pending 和 results 各有256上限，执行时会裁剪过多结果。外层在 queue 前限制 `pending+undrained<=256`；有效恢复档若已有更多两类记录，advance 会要求先显式 drain 再执行。它不偷跑 advance、不偷偷消费结果，避免丢弃已接受命令的尚未领取结果。正常 stop 保存未执行命令和未领取结果；它不会把 queued 命令变成成功操作。

`enqueue(method,args)` 返回 `{requestId,promise,cancel}`，适合需要本地取消的宿主。只有仍在本地、未 `postMessage` 的请求可取消；一经发送，即使还未收到 ack，cancel 也返回 false。取消成功的 promise 以 `REQUEST_CANCELLED` 拒绝且 `accepted:false/uncertain:false`。请求超时不是撤销：不能再次发送同一业务动作来猜测结果。

`stop()` 停止接受新请求，等待已提交 FIFO 清空，再导出存档并关闭 Worker；不取消已发送业务。`abort()` 是故障处理，报告已发送请求的结果未知及未发送请求清单。线程/浏览器崩溃同样不能保证未决请求未执行，外层明确 `uncertain:true`，不能称取消成功或自动重试。调用方应保存收到的最后确认存档，不把过期样本当当前权威档。

`sample(name,...args)` 返回真实读取值与 `{epoch,generation,sequence}`。成功 import 才增加 generation。任何更晚响应都会使旧样本保守过期，`isCurrentSample` 提供检查。表现层可继续绘制旧样本，但必须意识到它不是最新状态；不得把预测坐标或金钱反向写入。world 每 generation 只请求一次并在主线程缓存副本，加载成功后清缓存。桥接原查询包括 actorsSnapshot/playerLocation/floorPlan/canAccessFloor/atFunctionPoint/walkHeight/navigation/departures/eventsSince。

## 验证范围

目前只有静态候选，所有下列运行均 NOT_RUN。测试文件 `worker-thread-host.mjs` 是 Node **测试宿主**，在真实 worker_threads 里执行同一 classic worker-entry 与正式 IIFE（仅捕获 VM 自有标准 Math/JSON，不替换业务）。它不是浏览器 DedicatedWorker 或 MZ实机证据。

授权 CPU slot 后可一次选择一个明确范围，输出必须为新目录：

```sh
node adapters/rpg-maker/worker-protocol.test.mjs --scope protocol --bundle /absolute/YunshanCore.js --out /tmp/fresh-worker-protocol
node adapters/rpg-maker/worker-protocol.test.mjs --scope capacity --bundle /absolute/YunshanCore.js --out /tmp/fresh-worker-capacity
node adapters/rpg-maker/worker-protocol.test.mjs --scope whole-core --bundle /absolute/YunshanCore.js --out /tmp/fresh-worker-eight-ticks
node adapters/rpg-maker/worker-protocol.test.mjs --scope restoration --bundle /absolute/YunshanCore.js --out /tmp/fresh-worker-restore2
```

protocol 检查取消/背压、FIFO/一次ack和terminal、真实616/metadata、world只取一次/深拷贝、快照过期、远距购买拒绝、坏档完整原子拒绝及停机保留未执行命令。capacity 用真实256次命令入队验证不丢结果。whole-core 记录 Worker 推进八 tick 时主线程心跳，再关闭 Worker，顺序运行原 bridge oracle，逐步完整存档/RNG/队列一致；参考 oracle 从不在表现或心跳测量期间并行运行。restoration 从含真实.007余量和已入队命令的原档继续2步核全部 bridge 保存字节；本层不自动重复原桥已经验证的重型24步范围。

输出包含输入首尾哈希、transport记录、真实原档、receipt和失败栈。外围运行器须另绑定完整冻结源码、owned PID/startTicks/超时清理，并保留任何首FAIL。本驱动不会自行展开所有旧套、生成城长跑或性能 benchmark。未来浏览器验证必须使用真实 DedicatedWorker、同时核标准脚本加载/终止/主线程心跳和本桥业务；不能把 Node transport 成功误报为官方 MZ 或 macOS性能。
