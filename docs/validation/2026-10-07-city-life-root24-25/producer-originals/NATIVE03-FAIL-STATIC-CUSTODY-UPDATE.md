# native03 FAIL：业务元数据分类静态补充

原wrapper实际07:21:27.949648→07:44:40.522416UTC、1392.572768s，415输入stable/active[]，FAIL、raw SHA `ce21c380f37b87a711881f7c6528c4c20b7ee69d1314d048594de3fb784f3590`。driver原 `FAILURE.json` 为FAILED/EVIDENCE_INCOMPLETE：345returned、344审计complete，clock5280/tick2055，347reader，结果前原件640270370B，2GiB实验cap没有触及。四个缺失稳定phase是finance/security/politics/feedback；原fullsave与ALLbus仍留，不等于完整十phase捕获或360目标完成。

首个缺失error为 `CUSTODY_UNKNOWN_FOOD: player.inventory.businesses: unclassified inventory commodity`；原helper白名单在 [economy-resume-custody.ts:253](/workspace/yunshan/scripts/economy-resume-custody.ts:253) 没有定义`businesses`/`business:*`。第一失误产生后其余三个稳定phase同条件失败，最终driver十phase数组只有time/environment/energy/traffic/people/commerce。observer未修改游戏原writer；原FAIL及四missing不会因后续修helper成为PASS。

只读完整解压并解析 `/tmp/ROOT24-economy-next-day-20261007-01/native03/frames/0347-ordinary-345/whole-save.json.gz`：gzip493429B/SHA `91fe9514cec8315663af99593c9491cb13079959473186bc97cafdc30443462c`，原UTF8 3380291B/SHA `f6eab08842ca758d0d8484bd9b8fb99aa21dab0d72618fa77c75b3c1e892b624`。实际字段为：

```text
player.inventory.businesses = 0
player.inventory['business:market-b11'] = 0
runtime.playerBusinesses = []
shop-market-b11.buildingId = market-b11
shop-market-b11.ownerId = citizen-386
```

原游戏 [simulation.ts:539](/workspace/yunshan/src/simulation.ts:539) 的 `transferBusinessOwnership` 完成真实shop.ownerId与runtime经营列表修改后，在545/546行无条件写入上述业务数量/建筑标记；合法商租模块 [shop_lifecycle.ts:242](/workspace/yunshan/src/simulation/shop_lifecycle.ts:242)、330、346调用该writer。这里两个零值有真实来源，不是食材、资产赠送或隐含粮食。

后续明确分类建议：仅将这些有合法实体引用、有限整数/0或1、符合runtime/产权及已存在业务writer合同的字段识别为业务元数据；保未知背包字段和食材/菜品变换的原拒绝，不能使用`business:*`任意通配来隐藏未经分类物品或把数量计入食物。这是静态候选建议，不是修改或通过声明；具体支持旧历史标记的合同须按原reader/业务writer实际定义，不另造与产品矛盾的资格。

该报告没有创建Sim、importSave、step或运行测试/类型/构建/浏览器；仅读现有完整原件和source。后续修正/继续必须使用新冻结输入、新目录和实际回执；旧缺失不猜补，不把前344窗口外推为整日稳态。现金4.831235855817795e-9、食品5.4569682106375694e-12、债9.640643838793039e-11、财政4.751029791805195e-9是原FAIL报告最大残差，各自范围保留，不凭小残差否认证据缺失。
