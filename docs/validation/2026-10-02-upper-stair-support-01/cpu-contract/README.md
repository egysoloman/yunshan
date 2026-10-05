# 上层楼梯支撑修复 CPU 证据归档

当前已整合源码的独立根验证为 **相关测试 26/26 PASS、`npm run build` exit0**，实际运行时间 2026-10-02 06:58:46–06:59:15 UTC。原件见 [root-verification.json](root-related/root-verification.json)、[related.log](root-related/related.log) 和 [build.log](root-related/build.log)。构建包含严格类型检查。**新源码 full-suite：`NOT_RUN`**；旧冻结04的 465/465 属于旧 source/entry，不能移作新修复的全量结论。

补丁 [upper-stair-support.patch](upper-stair-support.patch) 的 SHA256 为 `ad798b94a68bf2c82276e1f70ee0bac28966f65da56f94eef2f556d33c501ea3`。当前 provider 为 `0a7d728e2714b2465002f509ff7ce8f389c4505cd3ff05070961336bd3a9ba78`，控制器回归测试为 `5be022e68a1a4490342a9963d14c79577d15152fca794feb58156dd9b6b56e09`，均与隔离候选及根验证首尾源一致。控制器本身未变。

原隔离 [provenance.json](provenance.json) 和 [README 原件](isolation-README.original.md) 按字节保留。[archival-verification.json](archival-verification.json) 核对其实际 14 条命令、24 份 artifact 哈希、补丁和当前源码；归档没有重启测试或 GPU。空 strict/dry-run 日志的执行状态来自历史 provenance，不能仅凭空文件判定成功。

原 [精确 FAIL](artifacts/baseline-exact.log)、[从零层连续 W 的 FAIL](artifacts/baseline-continuous.log)、[三项可合入回归 FAIL](artifacts/baseline-production-regression.log) 与修后证据同时保留。隔离原件包含 18 个唯一 CPU 案例（首15项与新增边界3项）；最后 soffit 重查是其中一项重复验证，不能另算第19项。10 栋实际楼体全层上行和原路下行记录为 **30,540 个正常 W motor 样本**。旋转和地下室案例是明确的边界克隆。

这些正常 W 原件使用**单栋身体投影**。保留原山、水、路、交通数据及实际建筑几何，但移除其他楼体会改变地形 fallback；不能声称整个世界的普通旅程已通过。连续楼梯每个 motor 姿态依赖真实 provider 完整盘支撑。封闭立面案例也同时受窗台阻挡，不能单独证明玻璃渲染。原连续失败步存在不足10微米的横向调整，前进和升高均为零；归档保留其真实 before/after。

[兼容契约原件](artifacts/contract-protection-final.json) 保留共享 body/slab/wall/roof/usePoint、near/far/detail 相等和四个旧 recipe × 三 seed 的 7,344 栋旧楼保护；v4 保存指纹前后均为 `80cd31e2`。native r5 存档身份保护原件另存，未进行 restore/tick。`diagnostic-code/` 和 `source-variants/` 是原源码证据，保留历史路径，不是独立可运行项目；合入补丁的生产回归没有 `/tmp` 或巨大外部 world 依赖。

`source-variants/baseline/` 对应原 FAIL 执行组合：旧 provider `9e3b35a9` 加新增回归测试 `5be022e6`。旧的未加强测试 `bcb62d43` 另存 `source-variants/frozen04-original/`，不能误认它执行了原三项 FAIL。

本归档不包含新 GL、美术通过、NPC 自然旅程、长期模拟或硬件性能结论。全成员哈希见 `sha256-manifest.json`；清单自身的 SHA 在归档交付记录中报告，避免自引用。无凭据模式扫描结果见 `secret-scan.json`，报告仅包含类别计数，不输出任何匹配值。
