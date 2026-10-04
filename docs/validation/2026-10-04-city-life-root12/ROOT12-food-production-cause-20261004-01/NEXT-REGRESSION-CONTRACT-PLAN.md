# ROOT12 食物回归最窄合同（PLAN，未运行/未实施）

本轮授权只有纯JSON/源码审查。以下是可接续的最小工程边界，不代表已运行的新回归，不把库存目标自动判成bug，不新开14日/benchmark/GPU。未来须 parent 分配NEW隔离源和CPU窗口，与motion/视觉独占源协调；不能在本封存组生产修改。

## 先完善只读观测，不先改生产量

待改首先为 `scripts/economy-observations.ts`、`scripts/economy-audit.ts`、`tests/economy-observations.test.ts`。保留现 `flows.food.productionMinutes` 的正产量批次语义，新设平行的分kind **fundedAttendanceMinutes**，由原 canonical `wage-earned` 的具名、分钟、shopId分类记账；无分钟的legacy结算事件不冒充出勤。farm/dock/workshop独立计数，保留原正产量统计；不得把已付/已赚/承诺分钟混成一个数。

若需精确判定每个生产批是否达到库存上限，先在现audit宿主可用event/phase hooks范围核原事件时序；只能增加无状态、无RNG的原批次观察，保留固定十阶段顺序。不申请大Simulation/MZ API迁移，不靠强行消费`shopLabor`读取，不把wage-earned这一实际分子当成各生产批已消费分钟的完整分母。

强验证：observer开启/关闭的两份同一初始真实save，24 tick全 export/RNG逐字节相同，观察前后查询save完全相同；每条新增attendance记录有原actor/shop/kind并与 canonical earned event 相符；正production里 minutes>0、amount>0不弱化。再产原审计原件时记录逐kind observation；源hash、scope、请求/实际ruleSet（未来新规则）都明确。原FAIL组保留，不能改`saveValidation`为PASS绕过reader。

## 默认 farm160 生产合同补缺

既有 `tests/food-hiring-fixture.ts:18,34–35` 用 **dock90**，已有 `food-hiring.test.ts:36–48`证明该受控招聘场景的付薪生产/销售/原币守恒；不证明默认 farm160。`economy.test.ts:79–90`是预置 workshop0 与摆到工作点的受控回归，也不能替代默认31farm自然到岗证明。

最窄新增场景必须保留原 **farm160** 和 **target120**，不通过改farm为dock/改库存为0来让断言变绿。两段合同：

1. 原居民、岗位、老板和有限账户能现场授权真实工资；员工原路走到合法work点后才记赚取工时。库存仍≥120时，合法已赚工资可以>0，但新增生产须=0；这一段检验准确观测“库存缓冲已足的劳动”，不能把无正产量判成失踪。
2. 真实具名消费者经过原路到合法sale点，用原有限钱包购买足够原库存，或经已存在的合法有限货运/采购出库，使该farm库存实际<120；记录每次收据和来源。然后真实已获准、未耗尽480日上限/雇主资金的到场劳动触发生产。每批 `amount = min(max(0,120-stockBefore), consumedLabor/30 × actualEnergy/100 × actualAgricultureFactor)`（原浮点容差），上限/缺能/缺资金/未到场分别保持拒绝或0。不消除已有工资债，不增钱粮，不重写受雇身份，不抽公共最后医生教师。

自然默认城验收不能提前摆消费者、覆写饥饿、库存、班表或route。若采用受控小world fixture，parent必须明确其唯一初始前提（例如沿用旧fixture92名需求者的受控hunger54、原老板钱包有限资本转账），把该测试报告标为**受控规则回归**，而非默认城自然闭环。所有角色/钱包/原岗位来自其真实constructor，工时/出库/授权仍必须从真实原路及现场事件发生。首段生产0是合法合同，不制造预期FAIL；若第二段自然前提没出现，则记录BLOCKED/未证，不修改输入或缩小断言绕过。

强断言：未到work功能点不赚分钟；原route在途晚到只能计arrival尾窗；同分钟不得复用多份劳动；产量不得来自employees计数、薪水结算、预测quota；farm完整库存变化逐笔=开场160+真实产量−实际sale−实际出库+合法原货返还。币值为原钱包/雇主/税/应付债/实际utilities的完整守恒，工资实际支付与原已赚款+债闭合。source/selftest/old18预期SHA原样，原core事件十阶段不变；正销售、第一真实生产、工资支付各保存原件并做exact export+24 tick续演。

## 单独验证取食到场，不扩大成全城重做

待验证文件首先是现motion owner的 `src/simulation.ts` native routing方法、`src/simulation/npc-stair-motion.ts`，其次 `chooseFacility`/committedNeed；第一合同只给读证据，不在这里修改。现15 `physicalWaiting` IDs和全部249意图已在JSON，先择一具名最窄真例：必须保存其原position、encodedroute、cursor、role/权限、world/sourcehash和原始clock；读取等待段碰撞/支持面原因，只有实证失败后才由独占owner出NEW failing regression/patch。

真实居民欲食→合法离开原楼→沿原可通路/真实车次→进入营业有货且可付柜台→customer→sale→hunger/携粮/雇主钱/税各变更，全部具名时序一致。等待或在车上必须保持无sale，不得瞬移/重选近店隐藏原阻塞。读档reader失败由motion已有scope修复，本组仅携带原失败，不将修reader说成已修居民饥饿。

即使一条路线补好，也只称一条通路已证；249的合法通路、长期经济稳态、14日和macOS仍另需授权资源及后续真实验收。本轮没有实施以上生产或模拟。
