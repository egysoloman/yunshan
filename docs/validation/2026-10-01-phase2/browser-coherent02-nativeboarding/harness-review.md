# 航空浏览器脚本只读核验

2026-10-01 核对共享脚本与 coherent02 冻结旧脚本的差异，未修改生产或任何测试。当前脚本 SHA256 `cd7c4d616753d2c74233ca7afdc761760cfc0b4fba4096f758d22ea5cc0c95d5`，`node --check scripts/browser-test.mjs` 实际 exit 0。

两处原有 60 秒返航限时和原飞行、位置、耗能、速度存档、落地、退出与租金守恒断言保留；检查数仍为 11。近处城市战机按钮在双身份条件下仍严格要求 mode=jet、activeAircraftId 为真实战机 ID，E 键是额外入口，不是按钮失败的兜底。旅行者、只有驾驶员、只有卫士三种缺资质组合均以真实 KeyE 触发拒绝，并检查身体未移动与许可反馈。

实际读档诊断看到合法 autosave 恢复道路驾驶员：vehicleId 非空、driving=true、车辆 moving。修订没有清空 vehicleId 或伪造机舱状态，而是以 Space 真刹停，在距离真实交通节点 45 米以内 KeyE 合法下车，然后设置明确的诊断身份和机坪旁身体起点。租用、按钮/KeyE 上下机、R 飞行和落地仍走生产规则与主循环。

独立 external harness 已在不改变 coherent02 的 81 文件及 BZMcZl-r 入口条件下实际 11/11、errors=[]、exit0；起止源码、入口及外部脚本 SHA 均相同。`aircraft-city-button-probe.json` 记录合法下车后距离 4.04475 米、driver+soldier、parked、电量100、供能66.315，原生按钮成功进入战机。旧 8PASS/第9FAIL 保留在相邻 browser-coherent02；不能称冻结旧脚本通过，不能将受控身份/身体场景称从普通入口走到机场或 macOS 性能验收。
