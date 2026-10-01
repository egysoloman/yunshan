# 宏观候选第二轮：5 个固定诊断视图

2026-10-01T20:08:38.499239Z 将 67 份完整源码/脚本/测试/配置复制到 `/tmp/yunshan-phase2-visual-macro2`，原源码复制前、副本、原源码复制后三方 SHA 一致。严格 TypeScript 与构建通过。本次实际入口 `/assets/index-B7uS5R_k.js`，SHA-256 `c3ceb4cd72da96eae7ec778d328622d5dc05f1e83d8f499f76a8f9086951b65c`；没有沿用此前 `CHTzswDW` 的构建身份。67 份文件和本次入口运行前后哈希保持一致。

五张原 PNG、逐图 JSON、合并 capture JSON、源码 manifest、原 build/capture 日志、实际 wrapper 均原样归档，校验见 `archive-checksums.json`。使用原 `scripts/visual-review.mjs` 的固定相机与原生选择参数；独立 wrapper 增加真实驻留/释放、GL 错误和一次强制 shadow 刷新计数，保留全部源与入口哈希检查，不修改冻结产品或原脚本。wrapper SHA-256 `12b4e377194ce7fd78a8c837ff9914b1910e6a10d41ffa4c02858403619a681e`。

| 固定视图 | 主 pass calls / triangles | 一次强制阴影刷新总 calls / triangles | 实际近景区块 |
| --- | --- | --- | --- |
| core-waterfall | 533 / 496,360 | 533 / 496,360 | 0 |
| market-street | 416 / 532,648 | 481 / 681,138 | 7 |
| residential-first-person | 146 / 288,362 | 227 / 424,108 | 7 |
| bridge-structure | 147 / 290,310 | 212 / 380,680 | 7 |
| bridge-walk-center | 193 / 306,504 | 261 / 391,202 | 9 |

技术 capture **5/5，通过、exit 0**，页面错误、控制台错误/警告与每图 GL 错误均为零。启动实际 11 个近区 Group、104 个 Mesh、18,974 个实例、17 栋建筑 interior refs；元数据共 482 块，运行最大近区 11 < balanced 容量 12，没有一次性创建全城近景 Group。切高空后 11 块实际卸载；观察器安装后创建的资源在后续切景实际触发 139 个 geometry dispose 与 139 个实例 dispose 事件，第一批启动资源不在这个事件监听范围内。far 矩阵隐藏不一致与驻留失败都为零。浏览器和 Vite 结束后核实无进程，GPU 交给车辆负责人进行同产品入口的独立真实步行。

根代理与集成审查者都实际逐张看过这五张原图。**技术错误零不能代表画面符合参考图。** 根像素结论：core、market、home、bridge-center 记录可用，画面仍未合参考；market/home 的开放门洞、窗木框和灯笼有具体改善，仍有裸墙、黑整片屋面、住宅前景切面及两岸秃台地等问题。宏观主景仍有粗褐色岩面、孤立树冠、平天空和重复盒塔；未来返工继续保留这些实际不足。

**bridge-structure 是失败构图**：原固定相机仍位于房体内，画面被地板/房体占满，不能标记桥结构验收成功。该原图保留，不替换或隐藏，不删房、移动真实身体来伪造修复。bridge-walk-center 画面已无此前交叉道路甲板穿入身体高度的遮挡，侧栏开口和桥面可辨；它是明确新增的中心线诊断视点，不能冒称旧旁移 2.6 米视点的同镜头改善，也不能代替真实 W 行走及交叉道路双向身体通行。

本次为 Linux Chromium SwiftShader、1440×900、balanced 诊断画面；使用 debug 固定光学机位，不能作为普通玩家旅行权限或 macOS 实机性能证明。影子总数是单次强制刷新，不是每帧开销或 FPS 比较；逐图 pixelRatio 在 JSON 中记录。正常 r5 实际购物、租房及暂停保存证据与本次完全独立，profile 未覆盖。后续生产修改不在本次冻结快照的结论范围。

后续仅 CPU 计算的公共观察点候选另见 `bridge-public-viewpoint.json`：真实道路 `road-river-quarter-3-river-station` 的身体点 [-664,18.6,1052]，眼点 [-664,20.32,1052]，目标 [-638,23,1040]。同一冻结产品的真实 PlayerController 半米步进到位，身体没有落入建筑；实际近/远建筑与网络实例 ray 在中心无近房遮挡（首建筑 342 米），下方视线可见 38 米处实际桥侧栏。该 CPU 记录尚未包含地形完整光学图、尚未生成新 PNG，也不证明普通玩家已到达此地或新构图合格；保留原 bridge-structure 失败图不变，未来可以另名新增公共观察点诊断。
