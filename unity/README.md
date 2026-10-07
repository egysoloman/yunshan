# 云山巨城 · Unity 工程

用户选定 Unity 作为原生引擎（2026-10-07）。本目录是 Unity 6 LTS 工程；任何 Unity 6 LTS 版本都可以打开，`ProjectSettings/ProjectVersion.txt` 只是建议版本。

## 结构

- `Assets/Yunshan/Core/`：不依赖 UnityEngine 的模拟内核（`Yunshan.Core.asmdef` 设置了 `noEngineReferences`）。它从 `src/` 的 TypeScript 版本逐模块移植，并用一致性测试保证输出与 TypeScript 版本相同。
- `../dotnet/`：用 .NET 8 SDK 编译同一批 `Core/*.cs`，并运行 xUnit 一致性测试。不用 Unity 也能运行：`cd dotnet && dotnet test`。
- `Assets/Yunshan/Runtime/`：显示、输入和 glb 加载（glTFast），只读取内核的权威数据。
- `Assets/Yunshan/Editor/`：菜单「云山/复制体素工坊资产到 StreamingAssets」，打包前使用。

## 打开与运行

1. 用 Unity Hub「Add project from disk」选择本目录 `unity/`，用任意 Unity 6 LTS 打开。首次打开时会自动安装 glTFast 等包。
2. 打开任意场景（新建的空场景也可以），点 Play。`CityBootstrap` 会自动创建：在后台生成城市（和网页版逐字节相同）、采样地形，然后搭建地形、路网、水系、楼宇远景，并加载体素工坊资产（柜台、桌子、课桌、值班桌、吸顶灯、站台、候车棚）。
3. 在编辑器里直接读取仓库里的 `public/studio-assets/` 和 `src/rendering/studio-assets.json`。打包成独立程序前，先执行上面的复制菜单。
4. 操作：点击画面锁定鼠标，WASD 行走（4.8 m/s），Shift 冲刺（10 m/s），Esc 释放鼠标。脚下高度由 `World.GetWalkHeight` 计算，墙体和家具碰撞由共享楼层平面判定；走近楼宇时自动切换到可进入的近景细节。

## 当前范围

已有：确定性世界、地形、道路桥梁轨道、河流瀑布、全部楼宇（远景外包络 + 近景墙板、玻璃、楼板、楼梯、坡屋顶）、体素工坊资产、第一人称行走与昼夜光照。

还没有：模拟十阶段（居民、交通运行、经济、政治、治安、教育、医疗等）尚未移植，所以 Unity 版的城市里暂时没有居民和车辆；灯具发光暂不随供电变化（需要等供电模拟移植）；current-v7（市集站前坪）也还没移植。

## 验证情况

- `dotnet test`：内核的一致性测试（数学库、世界生成、资产排布）在容器里实际运行通过。
- `dotnet build Yunshan.UnityCheck`：运行层代码用 Unity 2021.3 的引用程序集和 glTFast 签名桩编译通过。这只是编译检查，还没有在 Unity 6 编辑器里实际运行过，渲染效果和性能需要在你的机器上确认。

## 数值确定性

`JsMath` 逐行移植了 Node 22（V8 12.4）实际使用的 fdlibm `sin/cos/exp/atan/atan2`、V8 的 `Math.hypot`，以及 ECMAScript 的 `Math.round`、`max/min` 和数字转字符串。它和 V8 的结果逐位一致（见 `dotnet/Yunshan.Core.Tests/JsMathParityTests.cs`），因此在各平台上一样，不依赖平台自带的 libm。

注意：用 IL2CPP 构建，特别是在 ARM（Apple Silicon、移动端）上，C++ 编译器可能把 `a*b+c` 合并成融合乘加。合并后结果会改变，需要在目标平台上运行一致性测试确认。
