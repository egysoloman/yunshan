# 云山巨城 · Unity 工程

用户选定 Unity 作为原生引擎（2026-10-07）。本目录是 Unity 6 LTS 工程；任何 Unity 6 LTS 版本都可以打开，`ProjectSettings/ProjectVersion.txt` 只是建议版本。

## 结构

- `Assets/Yunshan/Core/`：不依赖 UnityEngine 的模拟内核（`Yunshan.Core.asmdef` 设置了 `noEngineReferences`）。它从 `src/` 的 TypeScript 版本逐模块移植，并用一致性测试保证输出与 TypeScript 版本相同。
- `../dotnet/`：用 .NET 8 SDK 编译同一批 `Core/*.cs`，并运行 xUnit 一致性测试。不用 Unity 也能运行：`cd dotnet && dotnet test`。
- `Assets/Yunshan/Runtime/`：（待建）显示、输入、glb 加载（glTFast）。只读内核的权威数据。

## 数值确定性

`JsMath` 逐行移植了 Node 22（V8 12.4）实际使用的 fdlibm `sin/cos/exp/atan/atan2`、V8 的 `Math.hypot`，以及 ECMAScript 的 `Math.round`、`max/min` 和数字转字符串。它和 V8 的结果逐位一致（见 `dotnet/Yunshan.Core.Tests/JsMathParityTests.cs`），因此在各平台上一样，不依赖平台自带的 libm。

注意：用 IL2CPP 构建，特别是在 ARM（Apple Silicon、移动端）上，C++ 编译器可能把 `a*b+c` 合并成融合乘加。合并后结果会改变，需要在目标平台上运行一致性测试确认。
