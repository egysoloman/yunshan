# 仅冻结6785的已验空支撑补丁

本目录不是新版MZ工程。共享49个src原文件保持6785冻结；本独立提交只提供可选择接合的源补丁与实际验证证据，不含其他道路、美术、F1候选或官方MZ引擎/素材。

- 原 `src/architecture-floor-plan.ts` SHA256：`b4d0c35fb868deedfb10e14128c2f3255a1f3a5f3b54f2f853afb0d2656a4d42`
- 最终替换 `candidate/architecture-floor-plan.ts` SHA256：`27431000d8f47ad5c5ece0e8c9319362c0610efda53559854a317995f1fc5f08`
- `architecture-empty-support.patch`：仅正半径且choices为空的early return，保公开wall-all/upper-slab-all缓存priming、null/undefined/holes回原抛错；不跨调用缓存失败，不改居民/时钟/分级/几何或碰撞有效结果。

实际原件：`comparison-32.receipt.json`（exit0、328输入稳定/owned退出），`comparison-statistics.json`；initial与32个tick完整state/runtime/RNG/routepool/模块档逐字同，原616/seed20261001/current-v4/speed1，世界JSON不变。几何范围15/15及完整npm build另已实际PASS。ticks17–32median218.744→134.377ms、P95263.428→160.343；前4仍25.744秒、9–32候选max2555ms，不能声称MZ已流畅或FPS达标。

复现（在含此目录的仓库根、Node22+）：

```sh
npm ci
node docs/validation/2026-10-03-core-performance/reproduce-32-ticks.mjs
```

复现只在新的tmp工作区从Git原6785归档src，copy本候选，执行已验同一`equivalence.mts`，不修改当前工作树，输出64份逐tick原保存和完整rows/result。新一轮时长不能冒原回执。接合时先核原SHA，再应用patch或逐文件替换；旧MZ52输入/bundle必须有新冻结/构建/同seed本机性能验收，不称本补丁已进入先前私有ZIP。
