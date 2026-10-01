# 第六批固定镜头与白洞修复实证

完整不可变源 `/tmp/yunshan-phase2-root-coherent-02`，81个文件拷贝三方及运行起止 SHA 相同。实际入口 `/assets/index-BZMcZl-r.js`，SHA256 `d4f43364e7f5bb52bdb18b7c9e1445714361e858cfb18be0b2f2c2387d9309ba`。根严格构建通过；与 coherent01 唯一生产差异是 terrain.ts 中 T-junction 闭合修复。六相机及独立 shadow/residency/shader wrapper 保持原版，wrapper SHA `214cbd98199a90f92ed64c2494a98c1fb843c5093bc5e236556cd87c8919f6fb`；未修改冻结文件或旧失败图。

技术 **6/6**，GL/page/console/warnings/shader 错误零，源与入口起止不变。初始真实驻留11组、104 Mesh、19034实例、17建筑refs；切六景实际释放25组，观察到243 geometry和243 instance dispose，far-hidden mismatch零。与根 CPU 全套含不创建 CityRenderer/canvas 的持久化 fixture 并发，不能作为独占帧率/计时或 macOS 性能证据。

根代理与独立审查员均已实际查看全部六张原图；根确认白洞修复，但其余视觉仍 FAIL。核心原白洞的10个精准采样像素 RGB207/218/220，修复后全为实体土岩约 RGB140–152/143–152/107–115，实际几何闭合进入 GPU，见 `core-whitehole-pixels.json`。core可见提交574340→575388（+1048），与owner全地形代理增加1276的范围不同，不混算。五个精确原空ray与5904内部未配边原因保存在 macro5 和 terrain-seam-fix 的原件中。旧失败证据不覆盖。

**整体参考视觉仍 FAIL**：核心重复盒楼、宽素坡和方冠林带仍粗；market/home实际门窗可辨，但大片无细部墙、深黑大檐和home前坑切面保持；旧bridge-structure原相机依旧被房内地板占满，是失败构图。centerline通路清楚但远端裸岸大墙，独立bridge-public-road可见桥柱/悬索，仍缺完整桥下水景。独立公共路视点不能冒称旧structure同镜头改善。未重复NPC：renderer/atlas与上一批完全相同，上一批真实成年/老人原图及灰鬓弱的失败保留。

| 固定视点 | 主 calls / 三角面 | 一次强制阴影总 calls / 三角面 | 实际驻留 |
| --- | ---: | ---: | ---: |
| core-waterfall | 564 / 575388 | 564 / 575388 | 0 |
| market-street | 433 / 594398 | 498 / 744580 | 7 |
| residential-first-person | 145 / 298864 | 226 / 436590 | 7 |
| bridge-structure | 141 / 293702 | 206 / 385116 | 7 |
| bridge-walk-center | 195 / 313110 | 263 / 399140 | 9 |
| bridge-public-road | 719 / 758874 | 785 / 838400 | 9 |

原 PNG/逐图JSON/汇总/日志/81源manifest/实际wrapper按字节归档，SHA与大小见 `archive-checksums.json`。六图 Chrome/4198 preview已结束。随后原样执行完整 `npm run test:browser` 的独立结果另存，不将相机诊断或技术通过称普通玩家旅程。旧 r5 current-v2-r5 profile 在本轮宏观上下文未访问。
