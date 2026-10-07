# 云山巨城 · Unity 工程

用户选定 Unity 作为原生引擎（2026-10-07）。本目录是 Unity 6 LTS 工程；任何 Unity 6 LTS 版本都可以打开，`ProjectSettings/ProjectVersion.txt` 只是建议版本。

## 架构

- **权威模拟**：城市规则（居民、交通、经济、治安、教育、医疗、政治等十阶段）只有一份，就是仓库 `src/` 里的 TypeScript `Simulation`。Unity 启动时会开一个 Node.js 子进程运行它（`src/native-host/sim-host.ts`），双方每行交换一个 JSON 请求或回复。存档格式与网页版相同。
- `Assets/Yunshan/Core/`：不依赖 UnityEngine 的 C# 内核（`noEngineReferences`）。包括：
  - 世界生成、楼层平面、通行权限：从 TypeScript 移植，用一致性测试保证结果完全相同。
  - 第一人称行走（`PlayerWalker`，对应网页的 `controller.ts`）、居民外观（`CitizenAppearance`）：同样经过一致性测试。
  - 模拟宿主客户端 `Host/`：JSON 读写、子进程管理、帧解析、Node 路径查找。
- `../dotnet/`：用 .NET 8 SDK 编译同一批 `Core/*.cs`，运行 xUnit 测试，其中一项会真实启动模拟宿主子进程。不需要 Unity：`cd dotnet && dotnet test`。
- `Assets/Yunshan/Runtime/`：负责显示、输入、界面和 glb 加载（glTFast），只读取权威数据。
- `Assets/Yunshan/Editor/`：菜单「云山/复制体素工坊资产到 StreamingAssets」，打包前使用。
- `Assets/Yunshan/Resources/Shaders/`：顶点色、实例色、水面和叠加线着色器。放在 Resources 下，打包时会被包含，`Shader.Find` 才能找到。glTFast 自带的着色器需要按 glTFast 文档加入打包（Always Included Shaders 或它提供的 ShaderVariantCollection）。

## 运行前准备

1. 安装 Node.js 22 或更高版本。macOS 上从 Dock 或 Finder 启动的程序不会读取终端的 PATH，所以会按顺序查找：环境变量 `YUNSHAN_NODE`、`StreamingAssets/yunshan-sim/node/node`、`/opt/homebrew/bin/node`、`/usr/local/bin/node`、nvm 和 volta 的安装目录，最后才是 PATH。
2. 在仓库根目录执行 `npm install`。
3. 可选：执行 `npm run build:sim-host`，生成 `Assets/StreamingAssets/yunshan-sim/sim-host.mjs`（约 1.6 MB，已加入 gitignore）。如果没有生成这个文件，编辑器会直接用 `node --import tsx` 运行仓库源码。打包独立程序时必须先生成它。

## 打开与运行

1. 在 Unity Hub 选「Add project from disk」，选本目录 `unity/`。首次打开会自动安装 glTFast 等包。输入使用旧版 Input Manager；如果 Unity 提示启用新输入系统，请选择 Both 或 Input Manager。
2. 打开任意场景（新建的空场景也可以），点 Play。`CityBootstrap` 会自动完成以下步骤：
   - 启动模拟宿主。若 `Application.persistentDataPath/yunshan-save.json` 存在，就读取这份存档。
   - 按模拟宿主报告的布局生成同一座城市。
   - 搭建地形、路网、水系、楼宇和体素工坊资产。
   - 绘制居民、载具、车站信号、航空器、体素和导航线。
3. 操作说明：
   - 点击画面锁定鼠标；WASD 行走（4.8 m/s），Shift 冲刺（10 m/s）。
   - E：开关门、使用楼梯、下车、登机、降落，与网页的 `interact()` 顺序相同。
   - F：暂停；B/X：放置或回收体素；V：航空器返航；T：视角回正；H：隐藏提示；Esc：释放鼠标。
   - 右侧面板列出附近场所、居民、载具、航空器可执行的操作，按钮和启用规则来自 `src/native-host/context-model.ts`，是网页面板的无 DOM 版本。所有按钮最终都交给 `Simulation.command` 判定。
   - 右上角可以暂停、调时间倍率（1/2/4/8×）、保存、读档。每 30 秒自动存档一次。
   - Tab 打开城市总览，共六个页面：
     - 生活：身份、资产、行囊、工班、课堂、事件。
     - 城市：各项指标、城区、案件。
     - 交通：城区和各类场所的步行或公共交通导航、班次。
     - 人脉：关系、记忆、社群组织。
     - 设置：视距、阴影、近景范围、灵敏度、新开城市。
     - 地图：点击城区或建筑即可规划行程，封闭道路显示为红色。
   - 城市中还会显示：
     - 市集柜台上的实际库存样本。
     - 道路封闭路障。
     - 室内任务灯，按供电和窗门采光调节。
     - 夜间窗光。
     - 近景楼宇的名牌。

## 在你的机器上自检

在 Unity 里打开菜单 Window ▸ General ▸ Test Runner，切到 EditMode，点 Run All。`Assets/Yunshan/Tests/Editor/YunshanSmokeTests.cs` 会检查以下几项：

- 能否找到 Node.js 和模拟宿主。
- 宿主能否打开城市、返回第一帧。
- 楼宇网格能否生成。
- 面孔立方体的面是否朝外。
- 着色器能否通过 `Shader.Find` 找到。

这些是容器里无法验证的部分。

## 验证情况

- `dotnet test`：18 项测试实际通过。包括数学库、两种世界布局、资产排布、居民外观、第一人称行走路线（穿过街道、门、房间、楼梯，与网页控制器逐字节相同），以及真实子进程中的模拟宿主。
- `node --test tests/sim-host.test.ts`：模拟宿主的请求处理和 stdio 协议测试通过。
- `dotnet build Yunshan.UnityCheck`：运行层代码用 Unity 2021.3 的引用程序集和 glTFast 签名桩编译通过。这只是编译检查。

以下各项都**没有**在 Unity 6 编辑器里实际运行过，需要在你的机器上确认：渲染效果、性能、子进程启动、macOS 下的 Node 路径查找、打包后的 StreamingAssets 路径。

## 已知限制

- 目前只支持桌面平台（macOS、Windows、Linux），因为需要 Node.js 子进程。
- 权威模拟经过优化后（逐 Tick 存档与原版完全相同），稳态每 Tick 约 0.22–0.24 秒，略低于 1× 实时所需的 0.25 秒；偶有尖峰到 0.4 秒左右。新城开局的前几个 Tick 需要 2–5 秒，因为要为全体居民规划初始路线。见 `开发备忘录.md` 中的 PERF 条目。
- 居民的脸部贴图、商铺立面招牌与站点导向牌还没有从网页渲染器移植过来。
- 楼层权限按帧里的玩家身份判断。道路封闭由模拟宿主在每一步校验，被拒绝时会把玩家拉回原位置。

## 数值确定性

`JsMath` 逐行移植了 Node 22（V8 12.4）实际使用的 fdlibm `sin/cos/exp/atan/atan2`、V8 的 `Math.hypot`，以及 ECMAScript 的 `Math.round`、`max/min` 和数字转字符串，与 V8 结果逐位一致。

注意：用 IL2CPP 构建时，特别是在 ARM 平台上，C++ 编译器可能把 `a*b+c` 合并成融合乘加，导致结果改变，需要在目标平台上运行一致性测试确认。
