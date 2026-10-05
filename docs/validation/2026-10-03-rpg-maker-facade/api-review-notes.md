# RPG Maker facade 只读 API／保存契约复核

复核对象：`/tmp/yunshan-mz-root06-20261003-01/source/adapters/rpg-maker`，后续只读复核最终 `/tmp/yunshan-mz-root07-20261003-01` 的 upper-door 定向原件／新测试／README。已读 `/workspace/yunshan/AGENTS.md`、完整 `提示词.md`、`开发备忘录.md` 当前 16:06 摘要及候选 AGENTS。仅源码读取、Python 与 SHA；未运行 Node／tsc／npm／浏览器，未制作 ZIP／上传／Git 变更，未写仓库。

## 结论

所查公开 API、空间量纲、door ACL、固定十相位与原核心保存委托路径一致，没有从这次静态阅读确认新的实现阻塞。ROOT07 已真实修复 upper-door 的几何定位fixture并独立定向 1/1 PASS，生产 bridge／walker／build 与 ROOT03 和 ROOT06 逐字节相同。保留 ROOT06 全轮 13 PASS／1 FAIL，加 ROOT07 定向 1 PASS 的独立事实，不能改写为同一全轮 14/14。现有 VM 证据不能称 MZ 编辑器／Mac 实机验收。

## 冻结与 SHA

`core-source-manifest.json` 声明 baseCommit `6785ca7dcca09e8e97afd610cfd52176c7a1cfb1`，列出 49 个 `src/` 文件。Python SHA256 实读候选全部 49 文件和 `/workspace/yunshan` 同名 49 文件，分别对 manifest 比较均 0 差异。

ROOT06 实读哈希：

| 文件 | SHA256 |
|---|---|
| source-manifest.json | 406b0f18d87980bc5106fe61995c59f3c3ebb78203f66a2da0ade21255fafbf0 |
| bridge01/inputs-first.json | 61e652b06549000e7c52d77bf8f531c41cec89d9fb902367cdb9e2074aad938e |
| bridge01/inputs-last.json | 61e652b06549000e7c52d77bf8f531c41cec89d9fb902367cdb9e2074aad938e |
| bridge01/raw.log | 43d6dc677d2164763f2f42a58616e22e7f4af566fee4fcc29545f3cd36bbcddc |
| source/adapters/rpg-maker/bridge.ts | 87ddfb0ce805f5f3a2643ef4c33d03fd323c9aab408604c5dfa09411a1d03927 |
| source/adapters/rpg-maker/bridge.test.ts | 2c7c5c1135497c4d8bf2870bf5db3b081a9aa5cd40d62e7459ea110f9ed525df |

## 公开接口与单位

以下行号均以 ROOT06 source 为准。

- `bridge.ts:12–22`：冻结 commit、bridgeVersion=1、1/60 真实秒固定帧、米／x东／y高／z南／0.2m voxel、地面 floor0／地下负数、步行4.8m/s／跑10m/s；MovementInput 为世界 x/z 轴，不是 MZ tile。
- `bridge.ts:26–48`：唯一 session 私有持有 Simulation/world/walker；新城显式可信 seed/layout，默认 seed20261001／原 current-v4；导档从可信 world 重建。
- `bridge.ts:52–54,149–160`：metadata、worldSnapshot、snapshot、playerLocation、actorsSnapshot、floorPlan、navigation、departures、eventsSince 均返回新对象／clone。canAccessFloor、atFunctionPoint、walkHeight 是原规则只读查询。没有公开任意位置写入或原 Simulation 引用。
- `bridge.ts:57–77`：queueCommand 拷贝入队、FIFO，pending 上限256；requestId 与 pending／尚保留结果之间唯一；flush 使用原 `Simulation.command`，原结果带 tick／clock；drainResults 消费结果。
- `bridge.ts:79–99`：advance 先验证 0..1 有限真实秒及轴[-1,1]／boolean sprint，验证成功才 flush；advance(0) 可只处理队列。每1/60步先合法 walker，再原 focus/tier 与 Simulation.step，没有第二套模拟。
- `headless-walker.ts:80–85`：斜向归一，移动速度只由真实秒与4.8／10m/s决定。`Simulation.step` 在 paused 时返回，但 walker 仍按原3D行为步行。
- `bridge.ts:121–130`：地面驾驶控制要求原 isDriving；飞机控制要求原 activeAircraftId，交原航空控制。`bridge.ts:102` 与 walker `:72–75`：乘车／登机／死亡不走地面 walker。
- `bridge.ts:162–198`：exportCoreSave、exportSave、importSave、createSession 是完整保存／恢复入口。

## door、楼梯与 ACL

- `bridge.ts:107–114`：门 ID 先映射真实建筑，玩家须能步行，真实脚位到 door 的 **x/y/z 三维**距离≤6m，然后才调用 walker.useDoor。拒绝路径不调用 queue flush、Simulation.command 或推进时间。
- `headless-walker.ts:88–108`：门跨原入口，进入时执行原 `canAccessFloor(building,0,player)`；v4 入口仍过实体墙／支持几何与 mayWalkTo，旧布局仍过原地面门／道路许可。bridge 三维门限补足 walker 仅 x/z 的内部入口门限。
- `src/access.ts:19–38`：楼层范围、地下角色、publicFloors、public permission、core-main观景层及角色包均来自原共享权限函数。
- `headless-walker.ts:111–127`：只在真实 inside／近原楼梯触发，循环到下一个可访问楼层；不能由 facade 指定任意 floor。沿用原E交互，不是连续阶梯完成全部路径的证明。
- `headless-walker.ts:163–205,249–253`：真实支持盘／墙洞口、楼层与梯级 ACL、运输／摊柜、体素与道路关闭守卫继续执行，door也受mayWalkTo约束。

## 固定十相位与唯一时钟

- `src/simulation.ts:26–29`：ORDER 为 time→environment→energy→traffic→people→commerce→finance→security→politics→feedback，TICK_SECONDS=.25。
- `src/simulation.ts:602–603,647–655`：通过原事件总线订阅每相位，累计.25真实秒后依次emit；每tick游戏分钟为`.25*state.speed`。`src/simulation.ts:677` 原 time 更新tick／关系时钟／day-hour。
- `bridge.ts:14,79–99`：session唯一帧入口；bridge余量与原runtime.accumulator分别保存，不替代内核时钟／RNG。
- `bridge.test.ts:84–99` 的 .24+.01／完整4tick／1游戏分钟／完整core字节和ORDER断言，在 ROOT06 raw.log:2 实际PASS。

## 保存原子拒绝及续演

- `bridge.ts:162–163`：coreSave 原样导出；桥接 envelope额外保存冻结commit、1/60余量、pending／result与自动序号。
- `bridge.ts:165–183`：10,000,000 字符外层限制；桥接版本／commit／余量／队列／序号／requestId与receipt shape校验；随后 selectSavedWorld 生成可信配方，构造新 Simulation 并用原 importSave 验完整核心，成功之前不触碰原 session。
- `src/persistence/world-layout.ts:45–61`：核心档上限8,000,000字符；从五种代码拥有的world配方按真实seed重建并匹配原指纹，不信任档中geometry/layout标签。
- `src/simulation.ts:1838–1841`：完整state／runtime、routeEncoding／routePool、模块manifest原样保存。`:1843–1920` 验format／world／安全结构／模块合同／原NPC及building／shop／vehicle引用、钱／库存／needs／真实顺序、rng／accumulator／工资等；`:2064–2067` 最后跑模块validator并原子交换，loadHook失败回退。
- `bridge.ts:186–194`：parse新核心完成后才替换世界／模拟／bridge状态并重建walker。核心原档导入时bridge余量=0、队列空、自动序号=1；桥接档恢复原队列／结果／余量。不是从snapshot复建。
- `bridge.test.ts:171–187`：坏JSON／null／原runtime负余量／缺原vehicle／错误commit拒绝，原完整envelope逐字不变，再24步完整envelope一致。ROOT06 raw.log:7 PASS。
- `bridge.test.ts:190–209`：有待执行命令／未消费结果／.007余量，立即完整桥接档逐字同，+24逐步核心档及完整envelope同、result与下个自动ID同。ROOT06 raw.log:8 PASS。
- `bridge.test.ts:212–221`：真实legacy布局及原城市完整core／+24逐字同，ROOT06 raw.log:9 PASS。

## 真实 raw 范围与未验证事项

ROOT06 `type01/receipt.json`：16:28:20–16:28:25，exit0，171输入稳定，owned PID退出，空raw SHA e3b0c442…。

ROOT06 `bridge01/receipt.json`：16:30:24–16:39:14，exit1，171输入首尾同，owned PID退出。raw.log:16–23明确 **14 tests／13 PASS／1 FAIL／0取消／0skip／0todo**。含ride与drive两个子测试，所以不把top-level个数误当14独立父case。

原raw实际通过 IIFE无Three／DOM／Node／MZ宿主且同seed原完整core、固定十相位、clone隔离、FIFO／zero tick、远售拒绝、近售原钱／库存、坏档原子拒绝及+24、完整桥接续演及+24、legacy+24、原乘车／权限驾驶不被walker脱离、非法advance在flush前拒绝。

upper-door原FAIL明确停在 ROOT06 `bridge.test.ts:269` 的 generated locator前提；raw.log:29–38为 actual undefined。`useDoor`拒绝断言原在`:276`，未执行，不能据该原轮声称门测试PASS或门行为FAIL。

ROOT07 实读定向原件已闭合：

- `type01/receipt.json`：17:04:23–17:04:29，exit0，171输入稳定，owned PID退出；空raw SHA e3b0c442…。
- `upper-door01/receipt.json`：17:04:24–17:04:42，exit0，171输入稳定，owned PID退出。`upper-door01/raw.log:1–9`：1 test／1 PASS／0 FAIL／0取消／0skip／0todo，raw SHA `f54e81063cbe5b780a44f6be1f9e3694fff109041c1134d9ee264e8c54b4a16b`。
- 输入first／last均SHA `bf162f05db67608346fdf9c765da62ca56277d1f13e9f33937c5e442bc2ace3b`；Python解析171条逐当前source SHA比较0差异，49条核心冻结清单比较0差异。
- 最终 `bridge.test.ts` SHA `08e8f1300930f5ec988312b59404c56d0e7b871ea846dfce3bc63d5ed29bcef0`；最终 README SHA `1edbde7ca3507a0cd1e390cd8dbe541e49774a4428bce7b49e748f0762b7f671`。
- ROOT07 `bridge.test.ts:263–282` 明示受控原几何开场脚位：用原bank floor1楼面，筛选原权限可访问、x/z近门≤6m但三维>6m、真实0.35m支持盘且原实体墙不相交；未加权限／改几何／改钱或模拟速度。`:283–295`保留floor／三维距离、门拒绝、完整envelope逐字不变、远门拒绝及队列不flush强断言，raw证明这些定向断言实际执行成功。它是原真实几何的受控开场，不称玩家自然步行抵达。
- ROOT07 `bridge.ts` SHA `87ddfb0ce805f5f3a2643ef4c33d03fd323c9aab408604c5dfa09411a1d03927`、walker SHA `c40553f2489fb19ce30b323c330d386264301451e9287f1b2dc22f8d51b52414`、build SHA `99aa10e3f8fd167091a716b3a95d6f96da7de114d406e33f835d2a523a38f2d6`，Python实读与 ROOT03／ROOT06 的对应文件逐字节均相同。生产不改，只有fixture修验；两范围仍不能合称单轮14/14。

限制／接合风险：

1. +24已通过范围使用默认静止advance／已乘坐载具的原控制；未覆盖每个连续步行、楼梯中途、门、屋顶状态的完整保存+24。walker内部支持/inside等从core脚位重建，不能把当前case推广成全空间续演证明。
2. pending／结果各256有界，结果超256丢最旧；原events只保留100条。宿主需及时drain，eventsSince不是完整审计日志；原 README:40,46 已说明有界。
3. advance只收0..1真实秒，失焦由宿主重置帧起点；宿主须保证唯一session每帧一次调用，不能同时启动第二Simulation或双tick（README:26,42）。这些是集成责任，当前VM不验证MZ Scene/DataManager接线。
4. snapshot／world／actors完整JSON拷贝可昂贵，README:40已要求按显示需求采样；无本次Mac性能证据。最终 ROOT07 README:73 进一步如实记录Linux Node／隔离VM首个完整tick约8–11.5秒与原plain VM中止，没有证明实时性能；正式IIFE字节与生产不因fixture定向改变。
5. raw只证明真正浏览器IIFE在隔离VM运行，测试宿主并无真实MZ引擎。MZ完整工程／资源／本机打开及macOS验收仍由父制作集成完成。
6. 父任务提供的私有 Library ZIP `libfile_3c0d4a37cd0081919db55fa1cee3f5b1`仍使用旧Simulation＋CityUI＋PlayerController；本复核没有读／写该ZIP，不能说该ZIP已采用新facade。
