# 实际卸货节点与 FIFO 货权批次：隔离首步

这是独立 `/tmp/yunshan-located-freight-prototype-20261002` 的可审查补丁，基于原 `/tmp/yunshan-empty-freight-production14-20261001` 的 32 个生产文件（31 TS、1 CSS）。共享 `src`、`types`、模拟存档和现有测试未被本任务修改。本件尚未集成正在开发的 v4 楼体，也没有开设食品柜台、新增工作人员、现金或货物。

交付 [located-freight.patch](located-freight.patch)，仅含四个文件：`src/simulation.ts`、新 `tests/located-freight.test.ts`、测试世界 helper、从未修改的旧源码实际捕获的 gzip 存档。`git apply --check` 和实际应用在另一独立基线目录成功，四文件内容 SHA 全等，见 [patch-apply-check.json](patch-apply-check.json)。补丁基于旧 coherent05 核心，合入 v4 时需要按现行接口人工协调冲突；不能覆盖 city 代理的楼层、路线或权限改动。

实现首次**原生车辆真实卸货**才启用 tracking。事件保留实际 `nodeId / vehicleId / fromEdgeId / direction / arrivedAt / position`，车辆货物在通知外部监听者前已转出，固定十阶段和驾驶/上下车/乘位/货运资格逻辑保留。公开 `emitEvent` 的伪造或重放不能再次入账。相同货主到达不同节点的货物保持独立、按到达顺序的 FIFO 批次。

旧货仍在原区域、由原 `shopId` 或公共空货主持有：首次新卸货时仅登记稳定 ID 和 `legacy-district`，没有节点、车辆或时间猜测。真旧档在新卸货前导出逐字节不变。tracking 是 `runtime.freightTracking = {version:1,nextId,origins}`；现有 `freightLots` 增加稳定 `freight-lot-N` ID。顶层独立声明 `freightTrackingVersion:1` 在所有货物售空后继续保留，计数不重用。FIFO 消耗只扣实际数量，耗尽批次才删对应 origin，保留小于 `1e-7` 的正实物残量。

读取存档逐项核验独立声明/主体双向存在、整数序号、全局唯一批次 ID、origin 与实时批次一一对应、货主/区域一致、剩余量不超过收到量、区域批次和等于原 `runtime.freight`。新节点批次必须引用可信世界的节点、原生生成车辆种类和实际路段终点，位置符合实际卸货车道偏移、时间不超单调时钟。错误在替换运行状态之前拒绝。原固定实体、身体数、债务、资金与存档 fingerprint 校验保留。

实际验证：

- 新局部测试 **7/7**；新测试包含 **21 种坏档**及状态完全不变断言。双节点原生卸货、真实农场提货再送达、旧档延迟迁移、普通现金采购按 FIFO 耗尽所有批次、空 tracking 声明保护、伪造/重放拒绝、旧/新各 24 Tick 逐字节续演。见 [located-freight-tests.log](located-freight-tests.log)。FIFO 耗尽测试设置受控合法价格 4，仍只使用现有玩家钱包，不涉及生产补丁自动改价或宏观供给结论。
- 相关新卸货/经济/核心模拟/贸易/持久化五文件合计 **131/131**，无失败、取消或跳过，约 153.36 秒。新 7 项已包含在 131 中。见 [related-tests.log](related-tests.log)。已有真实驾驶员加九名付费乘客、空/载货 24 Tick、旧载货巴士不得获得原生货运资格等断言全部保留并通过。这是规则回归，不是 CPU benchmark。
- `npx tsc --noEmit`、补丁 `diff --check` 均 exit 0；见 [final-strict.log](final-strict.log)、[diff-check.log](diff-check.log)。复制进来的两份非生产分析脚本仅在隔离目录修复了可选 `route` 读取；该修复不在交付补丁。
- 真实默认城市（seed 20261001，原 coherent05 世界，显式 8×）**80 Tick / 160 游戏分钟**，没有位置、现金、物料、人员、政策注入。初始存档逐字节等于原源码；80 个每步比较将新 tracking 元数据移除、分开的货主批次按旧算法合并后，与原源码逐字节一致。这是明确的规范化对照，原生新存档包含新增字段，不能称两版原始存档相同。真实新存档 import/export、现有 partition/assemble 及随后另 **24 Tick** 逐字节续演通过。另对真实原源码 80 Tick 的旧保存验证：14 个既存批次，其中 3 个私营货主，在随后第一笔原生卸货启用 tracking 时保留实际数量、货主，origin 仅有 legacy 字段且没有猜测节点，迁移保存精确。80 与后 24 的事件数量单独冻结，见 [located-freight-city-check.json](located-freight-city-check.json)。80 Tick：63 次卸货共 1,828 单位、4 次提货共 112 单位；货运/食物残差均 0，现金残差 `2.3283064365386963e-10`。后 24 Tick 另卸 28、提 28，不混入 80 Tick 计数。学院/官署/星港这段实际卸货仍分别为 140/168/172。

[base-source-manifest.json](base-source-manifest.json)、[source-validation.json](source-validation.json) 记录原 32 个文件 SHA 与隔离验证起止核验：仅 `src/simulation.ts` 改动，整个相关规则运行期间生产源和三个新测试输入不变。城市观察保存自身 32 源起止 SHA，并在续演结束再检查。不能把这些 32 文件证据称为根代理的 81 文件或 v4 全量冻结。

失败原件保留。首次严格编译有两份复制诊断脚本 `route` 可空与新增事件 direction 的类型错误；修后严格通过。首次局部测试把 people 阶段正常新登车误算为卸货改变乘员，已改在实际卸货边界核对人数，原驾驶/九人付费测试仍通过。城市观察首次绝对 import 少 `.ts` 导致 ESM 载入失败，未执行模拟；之后首次输出又因继续 24 Tick 向共享事件数组追加、console 使用后续累计而混合时点，已保留原 JSON/log/script，并用深复制冻结 80 数据、独立记录后 24 后复跑。模拟规则源与实际残差/规范化比较/续演断言未因此改变。旧 capture 报告的 `bytes` 实为 JavaScript 字符数，独立 [legacy-fixture-evidence.json](legacy-fixture-evidence.json) 给出真实 UTF-8 字节和 SHA。

当前边界：普通保存校验不能认证恶意同步删除全部声明、主体和每个 ID 的 raw JSON，也不能证明所有被同步重写的合法字段曾发生于真实历史。有限声明和引用保护没有被称为签名认证。实际有来源的批次现在仍放在 global opaque runtime；旧 partition 可以逐字节往返，但尚未按新节点归入空间块。原 8 MB 存档限制仍在，tracking 上限为 65,536 个存活 origin；长期元数据容量未测。

此次没有重跑 14/30/60 日，也没有 GPU、默认帧率或长期稳态结论。分开到达批次会恢复实际 FIFO 顺序；旧按货主合并算法曾可能把该货主后到的货提前，未来交错货主的收款顺序可能因此改变，不能把 80 Tick 对照扩展为所有长期行为等价。缺粮区依法开柜、既有工班实际搬运/服务、有限零售支付及真实跨区食品需求配送仍是后续工作；现有日粮生产约 196/日对需求约 853/日的长期缺口也没有在这里解决。
