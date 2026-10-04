# rpg2d-v1 只读合同交接

状态：计划 / 未实现，纯文档独立 CLOSED 组。

主合同：`SPACE-CONTEXT-CONTRACT.md`；NPC / 到场分钟 / 医疗 / 教育 / 科研 / 存档复核：`review-own/REPORT.md`。

当前 CitySession 仍使用 createWorld / Simulation / HeadlessWalker 的 3D 身体和完整 coreSave。独立 MZ 需要自己的空间权威与独立档案，不能直接复用未改动的空间运行合同。业务规则、钱物、身份、关系、需求和稳定 ID 可共享语义，空间位置、实际路径游标、碰撞和通勤由 MZ 承担。

下一步唯一接口：协调 SpaceContextV1（复核名 CitySpaceAuthority 是同一候选边界）的一名 actor / 一个店铺用途锚点的实际实走→presence→post-arrival-window 收据；核心持有唯一时钟、有限账本与分钟核验。其余交通 / 航空 / 改造 / 服务系统依赖详见主合同。

本组核对 64 件 source 文件前后 bytes/SHA 相同，复核 12 件引用源哈希一致；这只是只读观察，没有运行测试、构建、模拟、MZ GUI 或浏览器。没有修改 core/MZ/source/已 CLOSED 组，没有 Git、推送、MZ 升级或 Library 上传。私有 MZ ZIP 未读取。父任务可另独立收录本组，不能声称它已在旧29组附件或具有 LibraryID。

剩余阻碍：生产 Simulation 仍绑定 WorldDefinition/Vec3；新2D Session、业务/空间 schema、锚点 DTO、实际预算与原子2D读写均待实施。旧3D档与兼容候选保留，不直通2D，不用假XYZ或菜单免费到场。
