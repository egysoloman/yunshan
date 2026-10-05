# ROOT18 owned geometry draft 05 — not ready to install

此目录为隔离候选，未编辑共享实现、未提交或推送、未上传 Library。当前状态是 **DRAFT_NOT_READY_DO_NOT_INSTALL**。严格所有权组在 candidate03 的 120 秒边界真实超时；不能把 earlier02 的 12 项 PASS 或最终类型 PASS 移写为最终几何、默认保存或性能 PASS。

本候选基于 final ROOT17 performance06 的 source327。其 architecture-floor-plan.ts 基线 SHA256 为 `7f71e74408f226d891fd86ec6950ef9505fa5ea624948621d58f56cdbb78f458`，原 shared325 source graph 为 `0c7aea22807f69ac83450ecd201d5ee6e933dff816e937cf18b0728e97d7a0da`。候选共 330 功能输入，30 个旧生产文件有改动，另加 owned-data.ts 与 2 份测试。所有原测试与 fixture 字节保留。INSTALL-DRAFT.json 包含逐文件 before/after SHA 与 patch SHA，root 应显式合并 import 和工厂入口，不得以这份旧 source 覆盖 ROOT17 的电网、物流、医疗、课程遗产修复。

## 已写实现，验证范围有限

- createWorld 仅在其模块私有函数中登记自身刚生成的完整参数图；公开只有只读检查，没有允许任意调用方 mark trusted 的 setter。启用前逐对象先查私有 membership，再看当前 descriptor。未知根、替换成员、克隆、自定义地图及透明 Proxy 都保留原 world 路径，不依据 Object.isFrozen、公开 flag 或相似 descriptor 自动信任。
- 几何模块另登记 makeBody 及其自有 panel/slab/roof 图。公开缓存插入未知成员、getter、custom iterator 或跨楼栋深层对象别名时，整个 world 继续 legacy。深共享检查覆盖 body 与公开派生缓存，不只检查相同 FloorPlan 根。
- 工厂将参数及当前缓存图联合复制，保字段顺序、共享引用及已预热的 panel/slab/roof/route-grid 寿命；只冻结副本。caller 原对象、预持有 body 与缓存引用不冻结、不注册。参数或缓存指向参数的异常别名在冻结和登记前拒绝。
- getBuildingBody/getBuildingFloorPlan 和原 public panel/slab/roof/fixture API 仍给稳定可变 view。第一次 escape 联合复制该楼栋图，并永久退出该楼栋 canonical cache；内部旧只读 handle 通过 reader 查询映射到当前 live view。公共墙牌、roof region、market host rect 的别名出口保 mutable helper，renderer 使用单独 borrow。
- 内部 27 类读取路径改用显式 read reader。canonical 的 near-plan、stairs、local-solid、support footprint 和 stair JSON 文本可缓存；未登记或已 escape 数据保持逐次原值检查。精确碰撞、支撑、步高、头部、体素、ACL、道路和预算规则未降精度。
- createOwnedCityLifeProductCity 是新显式入口；兼容 createCurrentProductCity/createCityLifeProductCity 等保原 World。main 拿 simulation.worldDefinition 给 controller、renderer 和 UI，从同一参数快照读取。没有改变保存格式或把私有 generation 写入保存。

世界快照冻结是这个显式入口的新契约。任意地图仍通过 legacy 工厂运行；本阶段没有可信外部 importer。未来 CityPatch 必须有权威图的 generation 替换与 renderer/controller/simulation 同步合同，不能直接向这个被冻结的建筑集合 push，相关动态城市合同本轮未实现。

## 实际运行

1. candidate02：12 新纯测试 PASS，03:24:13.051532—03:24:26.780667 UTC，13.729135 秒/cap120，330 输入稳定、active[]。当时 Proxy 只证明 descriptor 快照不调用属性 getter，不满足严格 live fallback；该 criterion 已由 03 严格登记替代，不能借此认证 05。02 tsc FAIL：原候选未完的 array descriptor typing 与 cached 可空错误原件保留。
2. candidate03：tsc FAIL，数组 descriptor 的类型签名不匹配；随后在 04 修复。严格纯组 03:32:18.448681—03:34:19.018266 UTC，**TIMEOUT_PARTIAL**，固定 cap120 不扩。Node 3 个 copier case PASS，geometry 文件取消，未完成 ownership case。330 输入前后稳定，owned active[]，raw SHA256 `ad595371a125b2e9d7cb4dbd80aa0e09506fa6f606e329530420737f3395dcb9`。过程观察曾约 90 秒、RSS 1.8GB；没有 CPU profile，所以注册遍历分配只能列静态怀疑，不能写成已证明因果。
3. candidate04：tsc PASS，03:37:33.160187—03:37:54.842267 UTC，21.682080 秒/cap120；无 World 的 3 copier case PASS，1.722848 秒/cap30，raw `96ca0a2434ab163fe2b5a50d06fde3244129ae8562b872b5ca5e93313e65e4b8`。两阶段 330 输入稳定、active[]。
4. 最终 candidate05：tsc PASS，03:42:30.547938—03:42:45.846328 UTC，15.298390 秒/cap120，330 输入稳定、active[]。copier 实现及测试与 04 SHA 完全相同，未无故重复运行。05 增加非数组 floorPlans 结构拒绝，并使 stair floor-set map guard 读取 prototype descriptor，避免为判 guard 执行继承 getter。

05 为工厂内部新生成图减少 descriptor 分配并用私有 WeakSet 跳过已经登记的图；未知源图仍完整 membership/descriptor 检查。这一改变尚未运行 World/geometry 组，不能声称已解决超时或提速。

**0 Simulation、0 step、0 GPU、0 benchmark、0 新保存/未来轨迹证明。** 原 ROOT17 performance06 的 27 pure 与真实 16 步 f4b9076c…证据保留原作用域，不覆盖 ROOT18。05 的严格 13 个 ownership/copier case（只有 3 copier 同字节在 04 运行）、原几何回归、默认建筑全部 JSON/指纹、renderer 及实际保存/步进均 NOT_RUN。ROOT18 没有 Mac、FPS 或全 suite PASS。

## 接续入口

root 已要求本阶段结束后 HOLD 重型造城、默认复制和真实运行窗口。先在窗口中区分 createWorld、ownership graph walk、joint-copy、freeze 的真实耗时与数量，保持 default612 世界和原 616 NPC，不能以小城结果代替默认表现。再完成严格纯/原几何组，核对完整默认参数和全部楼栋原 JSON，之后才做原 EDF 的 16 步逐 tick full-save 等价和原终档 f4b9076c…，以及 mid-riser/whole/partition 后续 24。

重要：JSON.parse 的旧 World 文件从未私有登记，传给 owned factory 会保 legacy 路径。要实际检验 owned 模式，必须由生成器重建完全相同的参数 World，先和冻结 WORLD-ORIGINAL.json 做逐值及规范化 JSON/字段顺序比较，再确认 owned generation 真正启用；不能运行 legacy fallback 后宣传 canonical 提速。

原 .25 步长、速度、身体、需求、钱粮、RNG、阶段、policy 与所有断言不变。类型或无 World copier PASS 只说明这些范围。完整美术、经济稳态、动态城市、真统计区/流式加载与 macOS 验收仍由 root 继续。
