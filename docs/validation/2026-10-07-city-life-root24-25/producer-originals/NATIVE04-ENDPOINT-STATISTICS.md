# ROOT24 下一普通日前后只读统计

本统计只解压、读取既有原件并聚合字段，0 Simulation、0 import、0 step，没有执行应用代码、测试或性能门。完整数字与来源逐文件SHA见同目录 `NATIVE04-ENDPOINT-STATISTICS.json`；可复核生成器为 `extract-terminal-metrics.py`。

| 原保存字段/观察口径 | 原主档3900/tick1710 | 完整344窗5276/tick2054 | 最终5340/tick2070 |
| --- | ---: | ---: | ---: |
| 居民数/存活人数 | 616/616 | 616/616 | 616/616 |
| 616居民钱包合计 | 197979.68658032897 | 190398.46115909424 | 200845.9284787359 |
| 钱包低于20的人数 | 0 | 0 | 0 |
| 饱足字段 `needs.hunger` 均值 | 81.50742795194515 | 68.99673251533112 | 69.50809615169476 |
| `needs.hunger <30` 人数 | 14 | 134 | 115 |
| 食品商铺库存（farm/dock/market） | 13883.241185989757 | 13409.982228300692 | 13385.340939019552 |
| 居民随身食品 | 251 | 296 | 308 |
| 公司数量 | 12 | 13 | 13 |
| 公司资本合计 | 556.5703556336549 | 885.2029267320213 | 949.2038162962212 |
| 保存的商铺employees合计 | 265 | 265 | 265 |
| 原district就业率按该端点552成人加权 | 0.8079710144927537 | 0.8260869565217391 | 0.7463768115942029 |

全段1440游戏分钟的端点钱包净增2866.2418984069373；274人增加、300人减少、42人不变。公司资本净增392.63346066256634，其中新增company-13终值267.03303073684157；共同公司的变动逐项保留在JSON。国库端点减少5016.651354851005，玩家钱包无变动。这些差值是原保存字段的变化，不能单独归因为工资，也不能单独判定资金注入或资金守恒；守恒与真实事件的结论应引用root原custody/ALLbus回执。

`needs.hunger` 是饱足值，越高越不饥饿。最终比初始均值下降约11.9993、低30人数增加101；仅新cold suffix64分钟内低30人数134→115。食品商铺库存全段下降497.90024697020453，随身食品增加57。最终115名低30且无随身食品居民均买得起某个有库存且营业的食品报价，但**路径可达、权限、实际抵达未观察**。工业workshop库存单列，不把工业材料或公司inventory冒食品；货运、材料/菜肴及公司独立库存未被此食品快照纳入，寄售权属lot不重复计库存。

就业栏保留不同量的含义：district.employment是原commerce保存的输出，265是shops.employees字段，工作身份/在岗状态/当日shift名额/劳动时间与剩余额度分别在JSON给出。此读取没有重新构造内部workforce或执行`isEmployed`；保存率与端点成人数的加权只说明该保存输出，不是完整端点就业再验证。原存档未序列化publicLabor不等于旧公共工作不存在。初始与最终workId无人改变，citizen-386的role发生变化；不宣称全部工作名额固定76或初始农场120库存构成普遍招聘禁令。

资金统计不重复记账：公司capital是经营账户；`src/simulation.ts:438`的shopFunds优先取仍绑定公司的capital，否则取shop.cash。公司资本不能再加到已经含其capital的shopOperatingFunds合计。居民钱包、玩家钱包、国库、经营账户、银行与税款保管分别列出。

原件来源与关键SHA：

- 原主档：`/tmp/ROOT24-economy-next-day-20261007-01/native03/frames/0001-imported-main/whole-save.json.gz`，解压完整save SHA `4610ab1059b52cfd4bbfa17badf209a7a33ab986735d83b8a5da8c8a9e5ddf6a`。
- 原344完整窗：`/tmp/ROOT24-economy-next-day-20261007-01/native03/frames/0346-ordinary-344/whole-save.json.gz`；与native04 `frames/0001-imported-main/whole-save.json.gz`解压全save字节exact，SHA `f0ea97daef48d4e2357536a3d1ce4b9222dbcbaaa4d5205677bde9483c5a95b6`。
- 最终完整save：`/tmp/ROOT24-economy-next-day-20261007-01/native04/frames/0017-ordinary-016/whole-save.json.gz`，解压SHA `6e4812acde393a9436dfe09f4b3994a3721ccaba6ddb972c9623a9e369d02d48`。
- 最终原观察：`/tmp/ROOT24-economy-next-day-20261007-01/native04/TERMINAL-OBSERVATIONS.json`，856290B，SHA `5c49821c5dc99ec30ccb0c7df1e386a18b6d5ad963f69a1046a3853ccb674330`。重算foodAccess每个可重算字段与该原件exact；616居民现金/needs/岗位/身份/食品/位置、210商铺原保存字段与完整save逐项匹配。
- 原World291：`/workspace/yunshan-work/ROOT23-ledger-scaling-20261007-01/native-plan/static-inputs/WORLD291.original.json`，SHA `2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512`，实际building.kind仅用于食品与工业分类。

原末端观察的438笔全结算支付/58餐（50counter+8stored）、产出17.358710718860554属于**native04这16窗/64分钟suffix**，不能当整段1440分钟总流量。全段360 canonical窗由344原prefix+16新suffix覆盖，两Sim/两imports/361物理调用含345重放；原native03失败四缺phase没有补填。上述端点变化未证明14日稳态、完整长期供粮/财政或38域全部通过。
