# ROOT15 独立只读集成审查

结论：确认两处具体边界缺陷。两处均已由 parent 修复，本审查的纯选择器复核和同一17项服务唤醒回归通过。服务状态原缺口由真实 helper 和合法 scoped 订单夹具重现；没有以自然大城市或真实患者履约复现。其余已审范围未发现新的具体阻断缺陷。审查没有构造实际 Simulation、推进 tick、启动 GPU/performance、修改 shared、Git、CLOSED、Library 或外发。

## 发现与状态

**IR-P2-01：旧产品审计选项错误选择新策略。已修复，静态及纯表达式验证。** 原 `scripts/economy-audit.ts:58` 的 `--product-recipe archive-v4` 调用 `createCurrentProductCity`。该工厂已经显式加入 `continuous-upright-v1`、`nearby-food-v1`，所以原驱动会把带新策略的城市标为 ROOT14 原 archive recipe，污染历史对照的归属。`createArchivedProductCity` 才保留原完整 native4、双方 legacy、无材料调度。

原 driver SHA `28873d13cfbcfc6dae6d878bdb9aec094b25e5448094e4d2e6b2684f7b0d2440`；原文件和失败未覆盖。parent 的 selector02 现调用 `createArchivedProductCity`，并强断言双方 legacy 和 service absent；city-life 三项实际策略断言保留。修后 driver SHA `6b15e62718064d1da2d981bb65723e61fee486dec73435910b7cfef068ff4e28`。实际选择器表达式在 inert 工厂对象上执行：原版 archive 预期断言 exit1，修后 exit0，city-life 分支仍选 async 工厂；0 实际 Simulation 构造、0 step。该检查证明分支选择，未执行完整生产 factory/reader/audit。

**IR-P2-02：部分服务耗尽余料后，在 retryAt 前漏掉正库存唤醒。parent 已修复，原17项纯回归全部通过；未证明自然大城市发生，也未证明永久饥饿。** 原 `src/simulation/service-material-scheduling.ts:64` 只允许 `awaitingSupply`。`culture.ts:321–323` 采购到至少一份即可进入 active；`serve` 消耗最后一份后，未达六人目标的订单仍保持 active（179、197、215、217、295）。之后 `culture.ts:301–303` 在 `retryAt` 前只借该 helper 解除时间门槛，所以 active 缺料订单的新实货供应被跳过，不能获得 finance 中早于 upkeep 的采购机会。

最小合法 scoped 夹具：health、批准1440、授权40／已花4、采购1480、一份已收且一份已用、目标6、当前1512／retry1540、state active、held0。真实 `validateCultureState` 的 scoped 校验通过。原 helper 返回 false、连 quote 都不查询；同订单仅改 awaitingSupply 时返回 true。education、held0.8 的同一边界也失败。下一次正常 retry 如果仍无货且授权余额尚在，323行会转 awaitingSupply，故该证据支持最多近60游戏分钟的一次遗漏/延期，不能声称永久饿锁。

夹具里的单个健康耗料记录只用于合法状态形状验证，不是实际患者完成、工资支付、真实疫情或卫生闭环证据。原17项纯回归为12 PASS／5 FAIL；其中2 FAIL是合法状态唤醒缺口，另3 FAIL仅属合成畸形 quote（Infinity quantity／NaN 或 Infinity price），不计为自然供应商 bug。拒绝 active 余料≥1、awaitingBudget、未批准、旧 policy、transport、fulfilled、全部收料、无库存、NaN/零 quantity 的对照通过。建议的最小修复只对显式新 policy 的已批 education/health、active 余料不足一份且仍有采购缺口开放唤醒；预算、工资、真实报价、target 和原完整 reader 守卫仍由原路径执行。

parent 新冻结 helper 对 `active && held < 1 - 1e-7` 增加供应唤醒，并保留同 epsilon 的原消费阈值；仅合资格已批准服务可进入原采购。有限且正 quantity/unitPrice 的额外守卫拒绝畸形桩。修后 helper SHA `2b874514406c89bcfa80d7206eb321f3e0a3e72cea5196e865b84fd35c0d868f`。未修改原17项断言，以 SERVICE_REVIEW_SOURCE 绑定新冻结源后17/17 PASS（raw SHA `9e49fa4ae88fda047386ebaa2558809a36fec20a3a8011bc380256f894a1ab75`，0实际 Simulation／0 step，318 SHA前后完全稳定）。`SERVICE-WAKE-STATUS.json` 记录修复与原FAIL；本报告不将 parent 后续大 Simulation 结果写成独立已验证。

## 源码与证据归属

工作树基线 branch `takeover-city-life`／HEAD `f1e26ff6d8d440f2e35b4a67337364bb61cd8f77`。四个冻结源逐318个真实文件 SHA 独立复核，均无漂移，均78个 src；selector02 相比原 integrated318 的唯一输入变化是审计驱动；final318 则仅有审计驱动、材料唤醒 helper 及其2项新增纯测试三个输入变化。

| 冻结源 | 318输入图 SHA256 | audit driver SHA256 |
|---|---|---|
| integrated318／原37规则、build、browser11 | `5a519d7ad1a6dc02d4179830862d5f8859e4cb3c42d55deac19482acb9577f43` | `bb5f175cb63bb9b4421aea1565f12996d20872d715f48dfcf4fcd5b423f17e96` |
| default01／原选择器 | `172f79aec243d3f8065699dd871becba79bb34b2fc8070d54e326fa1dd6808df` | `28873d13cfbcfc6dae6d878bdb9aec094b25e5448094e4d2e6b2684f7b0d2440` |
| selector02／已修选择器 | `76907cf6c2375cea4ce5894ad5c5894b926b5307adf6f67078acc847ac09b7d2` | `6b15e62718064d1da2d981bb65723e61fee486dec73435910b7cfef068ff4e28` |
| final318／两项修复 | `7e3e32e4e01d99da59954950caaea87d4c2ed9c8a6a43e0437d8d295fbc64989` | `6b15e62718064d1da2d981bb65723e61fee486dec73435910b7cfef068ff4e28` |

独立回读现有 integrated-rules01、frozen-build01、browser01 的 receipt、原 raw SHA、前后318图：均匹配5a519d图，分别37规则PASS、buildPASS、browser11 PASS。这些是 parent 已运行结果，本审查仅核实来源；不能将它们改称新审计驱动、材料唤醒修复、新自然日/长期或 Mac 已执行。

## 已审合同及验证范围

三项 host 升级均先完整生产 validate，实际 WebCrypto SHA 必须匹配精确小写64位参数；await 后重新 export 核对原完整字节，随后无第二次 await 地单次 import 提交。reference/meal 各只增 envelope/runtime 双 marker；service 增显式 body/version/唯一 manifest 及原 v4 SHA。普通 command/event/load 没有自动升级入口。新 async factory 先建立 fresh current4，再求初始完整 SHA 并执行 service host；main 显式 await。旧档 import 整体替换 state/runtime，缺 marker 继续原 policy 合同，既有 autosave 保护仍在。

新碰撞只替换普通 NPC reference 段的同时间 Y 圆柱扫掠谓词；屋顶、权限、支撑、柜台、楼梯 cursor、planner、玩家和原速度没有改写。meal 在原食物获胜时比较同分有限真实 travel，并仅在原 decisionAt 到期时允许餐路重新选择；不创造饭、现金、路线或速度。材料调度只改变已批 edu/health 的 finance 采购顺序与供应唤醒；publicBudgetSnapshot／purchasePublicSupplyReceipt 仍保护工资、已承诺预算与必要运维资金，实际库存和税款仍按原 receipt 转移。追加报价估计以现有实货报价的最高单价估计剩余需求、cap≤160；不是预算批准或现货保证。同厅、当前任职和实际工资分钟的签名 authority 路径未放宽。

完整／分块重排对访问的每个 object 核实完整、唯一、字符串 keyset，补充账本及未知 extension 字段不能由 layout.order 被删除；重排前后均校验显式城市 envelope，旧v1立即原字节回环保留。新 audit 保存实际 terminal parts，assemble 必须 literal 等于原 UTF-8 save；full 与 partition 两恢复实例在未来24步逐步全档相等，同时原资金、工资、存活、research 断言保留。此处仅静态核实驱动断言，没有运行这三个城市副本。

architecture-bodies 变化是实有物体配色，未改 box 尺寸／开口／楼层。finish/window/roof shader 的粗糙度和法线细节只作用于相应 architecture instance tag，未移顶点或写世界状态；原站棚与交通标记仍区分。静态审查无法判定艺术目标达成；原 Linux 软件 GPU 可运行与 ART FAIL 同时成立。

实际独立补证：policy-host 19个纯 helper/codec 用例 PASS，另三 host 共6个 mock 事务用例 PASS（真实 digest 与等待期间快照变化）；service-causality 10项纯 helper/scoped validator/静态表达式检查 PASS；另保存17项原 wake 回归失败和原 selector 失败；同17项在 final318 修后全PASS。均0实际 Simulation、0 step；mock 未运行生产完整 reader。没有执行全 npm、GPU、browser、性能或长期审计。

## 必须保留的边界及最必要后续

14不同居民真实购餐与饥饿恢复已经有原因果账本；其中新23即时收据与继承旧2收据分别归属，不把旧2归新 meal policy。教育 actual03 为6个完整实际消费者；原 actual01/02 的4/5人与 deadline失败原件保留。1患者医疗当前属于准备及驱动原FAIL／修复继续，不写完成；租户256自然观察未发生第三次困难／再开，不写完成。ART FAIL、无 Mac、本轮新自然 default 日/长期财政、完整 npm 未由本审查完成。公共 docs 的旧 GPU pending 文本由 parent 更新，本审查没有写 shared docs。

最必要后续是：在最终冻结新 source 上串行完成默认自然日审计及 terminal full/partition future24；再以既有资金、工资、存活原 guard 检验长期财政，不把原非稳态当已解决。真实患者要有在岗医生共同20分钟、实际一份耗料、健康变化与唯一卫生来源账本；Mac／艺术各按原目标单独验收。不会恢复用户排除的四阶段优先体系，也不降低门槛制造 PASS。

## 完整阅读与自含材料

主审完整读取并冻结 AGENTS 1726 bytes／SHA `f98729175106aeb60651166555d03c7a0d53c119c33371adc9956928c7f830f7`、提示词25038 bytes／SHA `4ec0aa0731002723c49d580c8a2e90c828e4292ea9ca79fe59be8c825cfe8d89`、备忘录427889 bytes／1461行／SHA `9dda3c4f6f24d42639824504a6313040242bbba6a3096ae4a76693beae4e484d`。分块字节起止、SHA 和连续全覆盖在 `root-evidence/required-document-read-ledger.json`；截断读取已补读。审查期间 parent 只在备忘录前加3465字节，新增全文已读，旧体逐字仍为 suffix；最新读到431354 bytes／SHA `bb74b8a3d4aa8f77166bce1a6ca1130919ab94afe2d7ac7396fc7d2619c07dda`，原件及 supplement 留存。相关本地 `.agents/.codex` 与 repo 未发现 SKILL.md；普通正确性审查未调用云安全、Library、Pages技能。

`EVIDENCE-INDEX.json` 为本目录各材料 SHA 索引；`root-evidence` 保存原驱动、修后驱动、源码图逐文件清单、工作树观察、历史回执和原失败，`policy-host` 和 `service-causality` 保存各自源码快照、驱动、raw、回执和专项报告。原 selector instrumentation 提取曾有 SyntaxError，错误日志也原样保留并标明工具夹具错误；修正提取后的真实分支断言独立失败记录用于 IR-P2-01，未把工具错误计作产品 bug。
