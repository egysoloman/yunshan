# 宏观候选第三轮：六个固定诊断视图

2026-10-01T20:31:23.167928Z 冻结复制 69 份完整源码/公共资源/脚本/测试/配置至 `/tmp/yunshan-phase2-visual-macro3`，原源码复制前、副本、原源码复制后三方 SHA 完全一致；严格 TypeScript 和构建通过。本次实际入口 `/assets/index-C3-cLk6c.js`，SHA-256 `b43821a99d8af080a618bc03495dcec8617d215f728623d97f9a1555aa0c68ee`，不是此前共享工作区 `index-0auT1rUC.js`。全部 69 文件和实际入口运行始终哈希一致，后续医疗与商品修改不在本次源码结论范围。

六张原 PNG、逐图/合并 JSON、源 manifest、build/capture 原日志、外部 wrapper 均原样归档，文件 SHA 和大小见 `archive-checksums.json`。原 `scripts/visual-review.mjs` 的相机与源/入口检查完整保留；wrapper 只加真实 near 资源/释放观察、GL/着色器错误及单次强制 shadow 刷新，SHA-256 `214cbd98199a90f92ed64c2494a98c1fb843c5093bc5e236556cd87c8919f6fb`。未修改这次冻结产品或脚本。

| 固定视图 | 主 pass calls / triangles | 一次强制影刷新总 calls / triangles | 实际 near 块 |
| --- | --- | --- | --- |
| core-waterfall | 686 / 598,472 | 686 / 598,472 | 0 |
| market-street | 534 / 617,148 | 599 / 765,998 | 7 |
| residential-first-person | 185 / 314,574 | 266 / 450,320 | 7 |
| bridge-structure | 153 / 290,806 | 218 / 381,176 | 7 |
| bridge-walk-center | 218 / 325,192 | 286 / 409,890 | 9 |
| bridge-public-road | 838 / 775,308 | 904 / 853,502 | 9 |

技术捕获 **6/6，exit 0、errors: []**，页面、控制台错误/警告、每图 GL 错误均为零；没有 shader program 编译错误。启动实际 11 个 scene near Group、104 个 Mesh、19,034 个实例、17 栋 interior refs，而非全城 482 元数据块全部生成。后续 create 34/release 25，最大 near 11 < balanced 12；观察到 243 个 geometry dispose 和 243 个 instance dispose（本次包括启动 11 块的监听），far 矩阵隐藏不一致和创建失败均零。浏览器/Vite 结束并核实无进程，GPU 交给临床界面验收。

**根代理实际逐张 view 六张原 PNG，视觉仍未符合参考图。** 根像素结论原意记录：core 的真实 hip/gable、瓦与云天空有改善，仍有巨大裸坡、稀木和条纹式三维表面；market/home 的黑屋面、大片缺细部墙及 home 前景 0.2m 坑切面仍粗。旧 `bridge-structure` 相机仍在房内，地板占满，继续记为 **FAIL 构图**，没有删除或替换。中心线桥视图真实开口无遮挡，但远端仍有巨大裸墙。

新增 `bridge-public-road` 是独立合法公共道路机位：eye [-664,20.32,1052]、target [-638,23,1040]，对应此前 CPU 核验的真实道路身体点 [-664,18.6,1052]。本次原 PNG 确实能看清桥侧柱、悬索和桥面，但右上大片檐板、裸岸和孤零碎石仍粗，未展现完整桥下水景，不能称参考桥形完成。该机位不属于旧 `bridge-structure` 的同镜头 after，不隐去原失败，也不证明普通玩家已经走到这个位置。

主景提交从上一 B7 候选 533 calls / 496,360 triangles 增至 686 / 598,472；市场影总从 481 / 681,138 增至 599 / 765,998。画面变化有实际几何开销，不声称本轮下降。单影刷新计数不是每帧耗时，逐图动态 pixelRatio 不同（1、0.92、0.65），不能作固定分辨率 FPS 比较；软件 GPU 检查不代表 macOS 实机性能。

本次 debug 固定光学检查与正常 r5 玩家生活旅程分开。r5 原成功存档/profile 不用于截图，后续学校、驾驶与公共服务需从真实保存经普通 UI 核对后继续；本次六图技术通过不能扩充成完整生活或视觉验收通过。
