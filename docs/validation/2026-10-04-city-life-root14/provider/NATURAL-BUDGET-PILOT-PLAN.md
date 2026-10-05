# 自然追加预算有限参数试验方案（仅静态设计，NOT_RUN）

日期：2026-10-04。Owner：history_codec。本文件只读分析当前 candidate；没有修改 candidate，没有构造 Simulation、跑测试/build/browser/GPU，也没有实施本方案。当前 migration01 的运行结果不属于本文件的证据。

## 结论与证据边界

可以声明一个新的、constructor 前冻结的有限参数城，改善真实工业供给并安排一次有界的合法请愿试验。**单靠增加工坊不能保证产生追加 request**：材料足够且报价保持原 4 文时，六份教材只需 24 文，原 40 文不会耗尽，追加预算的合法触发条件根本不成立。必须让实际出勤、生产、库存上限及成本窗口自然产生较高报价，再由原消费路径实际花完 40 文；不得写入成本观察、改价或填 request 来制造这个条件。

根确认目前没有 fundedV2 正档。现 `tests/fixtures/budget-authority/provenance.json` 明确为 `ACTUAL_SOURCE_PAIR_NOT_FUNDED_BUDGET`：旧参数城原40支出为0、供应 BLOCKED，只有同厅两名真实在任者在 business clock6348 的实薪尾窗6344—6348。该原件证明合法来源存在，不证明 request、实际拨款、采购、服务或 funded pin。新参数城不能加载或改写这份原件来补货；其 world/fingerprint 不同，必须重新从 constructor 开始取得全链。

## 源码中的实际门槛

1. `culture.ts:112—133` 的居民自然教育请愿要求本人真实在公共大厅、成年人、education<1、mood≥65、stress≤50、hunger≥40、fatigue≥35、social≥30，支付10文并保留本人原收款前后值。原一天1440分钟程序期限和至少三人现场联署后才产生 order（`culture.ts:323—331`）。
2. `culture.ts:333—339` 的原部门路径仍是两名实际在岗、同机构人员批准40文；没有把这个原授权改成160。`SERVICE.education` 固定六份材料、每人60分钟（`culture.ts:48`）。
3. `supplemental-budget.ts:30—53` 仅在原40已实际花完、`receivedUnits<6`、存在正数真实剩余库存及有效报价时提出独立 request。原 request/order/quoteLots/receivedAtRequest/baseSpentAtRequest 均由生产路径产生；每单最多4份追加、全局64份、每份cap≤160，规则不改。
4. `trade.ts:85—90` 报价为

   `ceil_to_cent(max(4, (实际 earnedLaborCost + actualUtilities) / 实际 produced / (1-taxRate)))`。

   窗口为最近180游戏分钟、10分钟bucket。未观察到正生产量时回到4文；不能把已有库存标价8文误当此采购报价，也不能从工坊数量直接推断它必然超过40/6。
5. `supplemental-budget.ts:91—103` 自动 politics 联审只取**本 tick** `currentCivicBudgetSignature`，且必须在08:00—17:00。同一区、同一个真实厅、两名不同在任者，各自当前原官员职业、原雇主、实际工作点和正实薪窗口均满足，才走 `authorizeCivicSupplementalBudget`。过去签名 capture、普通官员标签、市长/旧 council 身份或泛型 emitEvent 均不能替代这个过程。
6. `budget-authority.ts:149—164` 授权还需真实 pending V2 request、匹配教育/医疗 order、实际财政available≥cap、两份当前签名及256授权上限。批准只保留额度，不立即付款或生成库存。
7. `culture.ts:298—315` 后续 finance 才按新增预算ID真实采购；原 order.spent/authorizedCap/approvedBy 不重写。采购还会与核心运维和其它承诺竞争，下一相位是否有料不能由批准本身保证。

## 最小首轮参数：四个普通工坊，保留原目标厅和课堂

首轮建议 `K4`，**全部以下变化只在新 world 对象 constructor 前一次声明并冻结**：

| 项 | 固定选择与理由 |
| --- | --- |
| 基础城 | 原 `budgetAuthorityFixtureWorld()` 的11区、seed20261004、616名普通 constructor 居民；不增加区、人口、现金、年龄、资格或任何运行时记录。 |
| 目标链 | 仍固定 `civic-0-hall` → `civic-0-school`。原厅、school、clinic、原 `civic-0-workshop`、原 spawn、原 functionPoints/ACL/道路均保留。这样不重新排列目标区六个 jobPool 项来挑选当选者。 |
| 增加供给 | 在 civic-1、civic-2、civic-3 各加一个无facility的普通 workshop，总工坊数4。独立ID可为 `civic-N-budget-pilot-workshop`，seed固定401/402/403；不得加 council/mayor facility。 |
| 新工坊形体 | 每个 center=`(district.center.x-72,0,-60)`，door=`(center.x,.6,-54)`，width/depth12，height6、floors1、rotation0、capacity120。使用原普通单层工坊路线/劳动规则；没有捏造工作点、到场、stock 或 canonical event。单层减少与本次目标无关的垂直通勤风险。 |
| 有限连接 | 只接本区现有 home-door anchor：anchor → `(anchor.x,.6,-40)` → `(center.x,.6,-40)` → door。长度由全部点实际距离计算，原路容量100、station=false；不加跨区连接。静态这条 commute约132m、低于原500m jobPool门槛；运行时仍须证实到场和实薪，不能把图可达算成出勤。 |
| 初始实物/资金 | 新工坊各自获得原 constructor 的90份初始库存；合计4×90=360份，是**新试验配方的有限开局来源**，不是给旧城补360份料。原 treasury80000、taxRate.08、policeBudget.3、每人的seeded钱包不变；原 shop开户仍从实际owner钱包转移既有钱，不新增经营资金。 |

这些新增工坊没有独享库存。核心运维和公共采购取全局工坊，路径不按道路可达性过滤；断开的区也不会保护或 earmark 某家库存（`simulation.ts:698`）。本方案不声称证明实体货运闭环，只证明当前原采购/实物账路径。

为什么首轮选4而非2或3：核心运维每分钟累计 `(.9+.3×1.8)=1.44`，实际采购数量为累计/4，即**.36份/分钟、518.4份/日**，夜间也消费（`simulation.ts:899,1918—1925`）。生产只来自实际已资助出勤，向120库存上限补充 `labor/30×district.energy/100×(1+technology×.12)`（`simulation.ts:1865—1869`）。

在这个明确不跨区的图中，静态 constructor 轮转使目标区工坊对应8个普通成人，其余新增各14个普通成人，共50个潜在工坊员工。其它三区到唯一school不可达，因此 `student` 的轮转flag没有可达school，不会把其普通工坊员工改为学生；这个结论依赖本方案的图和jobPool顺序，不能挪用到另一个world。人员是否实际受雇、获得480分钟资金、真正到场仍全部**未验证**。

以energy=.9、manufacturing level0、每人实际480分钟为条件的上界算式：

| 总工坊数 | 潜在工坊人数 | 条件生产量/日 | 对518.4运维的含义 |
| --- | ---: | ---: | --- |
| 3（原目标区+两个新区） | 8+14+14=36 | 518.4 | 已是理想出勤上界，无教材、其它采购、通勤或缺薪余量。 |
| 4（首轮K4） | 8+3×14=50 | 720 | 有201.6份条件余量；维持运维和一个6份order需实际劳动约17480分钟/日，而全员480为24000分钟。 |
| 5（唯一可选下一独立scope，K5） | 8+4×14=64 | 921.6 | 若K4真实出勤/资金导致缺料，允许**新城重新开始**再加civic-4工坊；不在原运行中补店或库存。 |

以上是资源尺寸估算，不是已产库存或保证产能；private现金、合同分钟、饥饿/休息、天气、库存cap都会压低实际产出。K4的360份即使完全无生产也仅够1000游戏分钟的运维，不能拿开局库存宣称四日可持续。只允许K4首轮及事先列明的K5一个后续参数版本，禁止无限调参筛选成功。

## 报价窗口与一个合法议程

先运行全自动居民路径，记录真实第一份education order。若其自然40已尽、料未满，直接观察它自己的 request；不另造议程。

若原40以4文买满六份并正常 fulfilled，这是合法结果，记 `ORIGINAL40_SUFFICIENT`，不能把spent改成40或删两份库存。若根的后续scope明确包含一个普通玩家请愿输入，可在此order已经fulfilled后，由仍在原constructor公共spawn的玩家，在原命令前置条件全部满足时调用**一次** `filePetition`，支付10文、保留正常标题和20—400字诉求，等待居民三人实际联署及原1440分钟答复；命令会拒绝仍有同类active议程的重复备案（`culture.ts:413—420`）。此模式必须标记“合法玩家备案输入、其后自然NPC联署/审批/采购”，不能标作全自动居民备案。

建议只观察D4—D5下午14:00附近一个真实报价窗口，再依法备案，让原一天答复落到次日下午同一成本时段。工坊接近120上限、仍有真实已付劳动时，180分钟内的真实produced可能少于劳动对应的潜在产出，报价因此可能升高；这只是源码允许的因果条件，**没有实测其必然出现**。不得持有调价/stock/world开关等到所需时刻再打开。

最小需要条件为采购有效平均价>40/6≈6.6667、采购时有足够货使原40确已花完、尚有正库存可quote。若希望同时证明“新增单份额度本身超过旧40”，建议**观察**实价14—30文区间：按不变报价计算，六份总价84—180，原40买约1.33—2.86份，缺额约44—140，单份cap≤160可覆盖。实际报价会变化，这只是区间诊断，不是写入或保证；真实追加cap≤40时仍可证明V2消费与总支出>40，但不能宣称复现“单份新增160”的旧primitive基线失败。

若报价始终4、第一议程没有fulfilled、没有三人签名、没有正剩余stock、只剩受保护财政，均保留实际结果并停止相应目标。不能为请求这一个 funded 原件改变法律、时钟、截止时间或财政。

## 有界时间与实际观察条件

建议每个新scope只用原speed16命令和普通 `step(.25)`，business clock正常每tick约4分钟。**最多2520 ticks（七个正常游戏日）和根分配的单进程墙钟上限；先到即停并封存失败/未达状态**。这不是当前CPU任务的扩容请求，也没有启动该scope。

| 时段（仅计划） | 可观察进展；不作为已达证据 |
| --- | --- |
| D0开始 | 冻结world/recipe/source hash，导出原constructor开局；普通工坊员工通勤、实际私薪及生产；原60实薪资格、登记120文、双见证、一分钟表单正常发生。 |
| D0—D2及之后 | 正常教育请愿一天答复、原40授权/采购；逐张完整投票、每poll原两日2880分钟，不改quorum/opinions。 |
| 约D4—D5 | 同目标厅两名真实不同在任者可能具备；旧一工坊原件在6348才有当期实薪pair，只能用于时间参考，不保证新K4相同actor/时间。若有自然pending request，在08—17真实同tick双paid时自动politics联审。 |
| D5—D6及之后 | 如一份合法次日议程达到较贵采购窗口，finance原40尽→真实request→原politics V2审批；下一tick/正常retry后真实追加采购；六个现场学习者完成实际课堂服务。 |
| 到D7上限 | 若任一环未出现，记录对应FAIL/BLOCKED/NOT_REACHED和全档。不得补资料把时限失败写成PASS，也不继续到十四日期满。 |

观察器必须固定目标D0，不用另一区早到的pair冒充D0授权。当前 `civicSameHallTerms` 可找到任意厅的pair，直接把它返回值用于D0 order不构成本地权限证明；D0必须实际满足term、同hall、同district、原职业/雇主、alive及本tick两份正paid窗口。没有 PublicLabor body时仍走原信任constructor profession0和真实canonical wage，不构造就业历史。

## 公共教育、个人课程与家庭课程的边界

公共order材料保存在该order的 `receivedUnits−consumedUnits`，财源是原40及各真实追加授权。个人40文课程用 `education.stock` 和自己的escrow；家庭40文课程用 `familyEducation.stock` 和监护人的独立escrow。三者同买普通工坊真实库存，但不互借库存；cancelled课程只能把reserved教材还回自己的模块库存（`education.ts:281,315—324`；`family-education.ts:102,153—166`）。

各课均需08—17、真实same station、成年教师、health≥45、hunger≥40、fatigue≥35、原雇主、working state、供电和当前已资助到场区间。原课堂每teacher/tick最多四名不同learner，一名learner占一个共享slot，哪怕这次只有少量有效分钟；actor实际分钟也共享，不能借用付薪前缀、其它课程或research claims。

culture公共服务先分配，之后才个人课程、家庭课程。**只有一份公共教材不等于给个人课程留下三席**：公共材料到某learner累计60分钟才消费，多个learner可先累积partial progress并占完四席（`culture.ts:178,194—196`；`education.ts:105—108`）。本首轮只验证public order，暂不开始个人40文课；若后续需要个人课，应在公共order实际fulfilled后用合法到场/原study命令开始，另计一份真实教材与40escrow，不编辑teacher/learner位置或slot。

**家庭付费教育不能并入这个七日自然正档**：原constructor所有NPC profile年龄都是20+i%45，包含label为学生者（`extensions.ts:97—99`）；`family.children` 初始为空，`studentGuardians` 不是儿童出生记录（`family.ts:176—185`）。原家庭课要求6≤age<18，新自主offer只枚举children。自然出生先需原270日孕期，再需六个实际游戏年到入学年龄；world几何参数不能使这条年龄规则在七日内满足。标记 `BLOCKED_NATIVE_ADMISSION_AGE / NOT_RUN`，不用fake child、调age、压孕期或补监护关系混成自然通过。

## 有限实物与资金守恒

实物总账需记录四工坊初始360、每次**真实** production、运维实际quantity、公共/其它订单receipt.quantity、个人/家庭课程实购quantity、工坊结存，以及各消费端的received/reserved/available/consumed。单public order严格满足：

`receivedUnits = Σ该order全部base与追加receipt.quantity`；

`receivedUnits = consumedUnits + 该order尚存实物`，最终fulfilled需received=consumed=target6。

追加报价不是received，cap不是货，production潜能不是货，缺库存不得从累计requestedOperation反推“已供应”。原public upkeep已消耗的材料不能改归课堂。全球选供不等于物流已经建模。

逐笔采购必须满足 `gross=quantity×unitPrice=net+tax`，supplier库存实际下降，采购gross从公共treasury扣除（或个人/家庭escrow扣除），net进原shop/company同一个真实账户，tax进原runtime.taxes后正常汇回treasury。工资earn/accrual是负债/费用，不再加一份现金；shop开户是原owner钱包→shop现金转移。每次授权只增加authorizedRemaining，不转钱。

public：`order.spent=ΣbaseReceipt.paid≤40`，各`request.spent=Σ其receiptIds对应paid≤cap`，runtime预算spent与culture对应值一致；base approvedBy/authorizedCap/原receipts保持。原publicWagesDue/publicWagesEarned/reservedPayroll/essentialOperations及其它authorizedRemaining继续优先，不能为实验削减policeBudget或调低reserve。

可选个人/家庭40课程：`40=escrow+purchasePaid+serviceFees+refunded`；earned serviceFees只能随真实workedMinutes按`(40−purchasePaid)×workedMinutes/60`增长。全城现金复核需计入treasury、queued taxes、NPC/player、shop cash或绑定company capital（同钱不双计）、organization funds、bank真实cash、所有已存在家庭/劳动/临床/道路等escrow及household余额。先核对全custody字段再声称总现金守恒，不能直接挪用遗漏某模块escrow的旧测试cash helper。

## 必须生成的真实验收原件（全部待运行）

1. 新world全文、代码/recipe/hash、未tick的constructor全文、所有外部正常命令列表与真实时间；保留K4/K5/旧一工坊各自独立身份。未复制旧paid capture到运行体。
2. 同一order的pending前档：原40实际spent40、0<received<6、原完整base receipts、quote前真实库存、180分钟真实cost buckets、完整quoteLots以及自然创建request。若无法达到此状态则缺少funded目标的前因，不补档。
3. 自动批准后的完整正档：culture request与runtime.publicBudgets均有**真实signatureVersion2**、相同两份完整签名、批准clock/tick、same hall/district、term→完整poll→application→proof→enablement→原profession闭包、本tickpaid区间，以及available/reserve计算。历史pair capture文件本身仍不得算此正档。
4. 原追加budget ID实际正spent与至少一张真实新增采购receipt：库存/treasury/supplier/tax前后值一致、receiptIds精确、没有重放付款或免费补料。授权但spent0只标 `APPROVED_NOT_PROCURED`，不标材料服务完成。
5. 实际公共服务结果：完整六个真实课堂60分钟，teacher工资/到场/共同station/learner activity claims与credential receipts对应，received=consumed=6、order真实fulfilled。若只完成一人，必须检查消费数量是否已超过base单独购得的quantity，不能把base材料提供的课程误算成追加材料履约。
6. 真实fulfilled关闭原预算和每份追加预算；两份V2签名全字节一致，原追加receipts引用保留。此时才能称为实际funded pin，且新v4冷proof/application/poll与仍热active term的权源链完整；term尚未真实结束不能归档它来“测试到期”。
7. 正档生产完整reader、immediate export、完整partition/assemble、两独立恢复体future24；均固定本试验显式trusted world。参数world不在生产 `selectSavedWorld` 的标准生成recipe集合中，不能把直接world恢复PASS宣称默认selector/browser/bridge新bundle已经验收。
8. 在真实funded原件上独立clone作变异拒绝：丢/改真实signature/term source、改cap/spent/quote/receiptIds、删cold source、缺页/混代/伪费用分钟等；失败live bytes不变。普通官员无term、只有一名、不同hall、过去capture加载无当前paid、保护财政不足也应保pending。不能用空request正档代替这些 funded 正档验收。

七日scope不覆盖十四日期满续任、自然死亡/转岗后历史预算权限、未来全部模块长期cap、默认城、macOS、浏览器/GPU或真实货运闭环。request64、publicBudgets256、每order4追加和档案页/byte上限均仍存在。任何这些边界或墙钟/CPU失败保留原始记录，不宣布无限持续。

## 静态读取输入SHA256（不是run provenance）

| candidate相对文件 | SHA256 |
| --- | --- |
| src/simulation/culture.ts | 4383c4b98420f63fd3ff63fdbdf0eac76316fc4ffc609de3ec829a1f9caf14b9 |
| src/simulation/supplemental-budget.ts | 64b12d7fee1441811b1de0651ba340453168d0491ddc338d6fabc45015ee6329 |
| src/simulation/budget-authority.ts | ab14d14f6cf5dd3406e52d3ebdfdda43f46a14c598c1f3a6877a9671593f53ef |
| src/simulation/education.ts | 4f776ad61a78deba289ab7f5de7fc6969f21c522a7b79ed42a15991ebbc360c7 |
| src/simulation/family-education.ts | 1a0f86b640d1b9252b554707389779a96827f7d13111cf54e8d38a3989774557 |
| src/simulation/trade.ts | b0ee4ddca2693188553dac7f443196c07a84ea07d5e0bc2adde0df6bd72a6fd7 |
| src/simulation.ts | 1da2602858baceca45e2e4b5f8122cac1b75453051c3bf4ffbddd94cfcd53569 |
| tests/civic-staffing-fixture.ts | f072f6e97645abf4423d50dab4b4891b4a2de41b51fb23b7a8815eca24ebb6fd |
| tests/budget-authority-fixture.ts | d0bac2f99e2718ac1159aca3396e4fed3f269a694b3cf71d2c6cafbfecd607e0 |
| tests/fixtures/budget-authority/provenance.json | 07656752e235983ab0f5499d49da9c01e4edee7735146830a02582deee0a6a57 |

**计划状态：NOT_RUN。candidate未改。没有fundedV2新正档产生。**
