# 2026-10-01 阶段验证记录

本目录保留首次推送之前的实际原始结果，日期按用户 Asia/Shanghai 时区记录。代码中的经济平衡等剩余范围见根目录开发备忘录；这些记录不表示完整项目已经完成。

- `tests.log`：157/157 规则测试，0 失败、0 跳过。
- `browser-results.json`：生产构建 `index-C-rbdlOs.js`，10 项实际 WebGL/输入/交易/保存/权限检查，错误为零，含源码哈希。
- `ui-results.json`：真实 UI/Controller/Simulation 的 15 项集成检查，错误为零。
- `renderer-verification.json`：610 普通建筑支撑、8,582 地面路点、地下与跑道几何复核。
- `benchmark.json`：独立 CPU 测量、明确 8× 的 10,000 Tick、全状态保存恢复和 24 Tick 一致续演，含 GC 后内存范围。
- `economy-audit.json`：相同观察路径的约 14 日实际公共资金、工资、税费、票款、生命与科研记录，核对残差约 4.44e-8。

模拟/经济源码 SHA256：`0947998dbc3b56471d8a3ee18f2a04a331d0ae042f5ee1625f3db828eb15da24`。macOS 硬件与跨浏览器长期游玩未测。居民现金下降 65.14%、岗位减少和七家企业资本归零仍待继续修复。云端软件 WebGL 与 Node CPU 记录不能作为 macOS 帧率证据。

后续运行脚本仍写入 `artifacts/`；重要阶段再另存记录，以保留前后对照。
