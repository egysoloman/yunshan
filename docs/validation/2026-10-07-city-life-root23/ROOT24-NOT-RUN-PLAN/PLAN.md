# ROOT24 默认主档下一日经济因果审计 — NOT_RUN

本阶段只有只读准备和此新私有方案。没有修改 ROOT23 冻结的 src/tests/scripts，没有执行 Simulation、test、tsc、build、browser、安装或性能实验。ROOT23 当前验收与收尾优先；ROOT24 新 adapter 编制及唯一重 gate 必须另由 root 启动。当前源码数 404 是 root 正在验收的冻结范围，不代表 ROOT24 已验证。旧 14 日钱包下降 65.14% 属于 8c263e 历史源码，已有工资经营账户别名与循环裁员修正，不能把旧比例当当前故障，也不承诺这个一天窗口建立长期稳态。

## 原件与精确时间

首选 World 为 `/workspace/yunshan-work/ROOT23-ledger-scaling-20261007-01/native-plan/static-inputs/WORLD291.original.json`，1832308B，SHA256 `2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512`。主档为 `/workspace/yunshan/docs/validation/2026-10-05-city-life-root20/ROOT20-PRIMARY-1700.save.json`，3443220B，SHA256 `4610ab1059b52cfd4bbfa17badf209a7a33ab986735d83b8a5da8c8a9e5ddf6a`。两原件均与 ROOT22 SOURCE ZIP 的 original-inputs 成员逐字相同，原件只读，不以 ROOT23 新声明水电的大图或六建筑另城替代。

主档是原 **version4 / civic-local-v1 / motion2 / civic-history-pages-v1**，worldFingerprint `b85fa6ec`；连续站立、nearby-food、原道路食品提货/交付与成人课程政策都完整保留，不再调用 new-city 工厂、不升级或降级。实际 612 建筑、674 路节点、691 边、11 区、616 居民、344 车、210 shop；World 与 state 均无 powerGrid/hydroMaintenance。保存 tick1710、day2（第3日）、hour17、clock3900、speed8、pausedfalse；原 payrollAt5340、commerceAt3910、financeAt3902。

未来只使用一次公开 `command({type:'speed',value:16})`，并保留命令原入参/结果/前后整档。原完整 import 后立即 export 必须逐字等 4610，基准钱粮在 import 后、speed 命令前取得。保留原 focus/mode/detail/player position 与 NPC 身体；不 setFocus、不 setTime、不写钱/需求/岗位/身份/库存/政策/储水，不造新城市居民或雇主。

每次只 `step(.25)`，成功调用只能推进一个原 tick 和4游戏分钟，严格核十阶段：time→environment→energy→traffic→people→commerce→finance→security→politics→feedback。完整下一日是 **360 成功窗**，到 tick2070、day3/17:00、clock5340；第360窗 people 原工资 flush 后原 finance 实付，全部 feedback 完成再读完整终档。无额外未来步或新实例分支混入这360分母；恢复未来另阶段如需执行另列预算。资源/墙钟/磁盘/业务失败提前停止就是 FAILED/PARTIAL，完整保存实际 frontier，不能给不足一日的窗口写“一日通过”。

## 现金保管与财政

逐 phase 稳定结束点以及每整 tick 核完整现金 `C`：treasury + runtime.taxes + player.money + 所有 citizen.money + 银行实体 cash/legacyInvestmentCash（有 banking 时不再加 bankBalance 和 deposits）+ 未绑定公司的独立 shop.cash + 全部 company.capital + 全部 organization.funds + playerLabor/roadworks/education/familyEducation/residentEducation/power repair/clinical/hygiene/transfer/pregnancy 等真实 escrow + family household balance + shopLifecycleHeldCash；hydroMaintenance.job.escrow 只在真实存在时列项，本主档没有，不创建。

绑定 company 与 shop 只有一个经营现金账户，使用原 `shopFunds`/`transferShopFunds` 规则；绑定店的 cash、company.bank、company.inventory 等镜像不得再加。存款、贷款本金/利息应收、欠薪、利润、营业额、股数、预算 cap/承诺、研究 job.budget 都不是额外现金。绑定释放的公司与独立店按实际字段重新分桶；任何新持款状态必须匹配现源码 writer 的 custody，不靠余额差塞一个“其他”项。全部钱袋具名完整快照及所有别名判定保留，不能只保全城合计。

静态入口 `C0=280736.1579367216`：公库63983.18759107223、居民197979.68658032897、玩家600、bankCash700、nonaliasedShop16880.71340968675、company556.5703556336549、residentEducation escrow36，其余已列现金池与税队列0。该静态数值用于校核原件，不由 adapter 写回。`C_end−C0` 每个稳定边界容差 <1e-6；若发生合法外部货币来源，先按实际 writer/原事件明确合同，不临时放宽残差或补项。

财政另核 `Δ(treasury+taxQueue)`，由本窗实税、票款、utility/fees/service/退款等原公共现金收入减实 publicNPC 工资、实公共采购与其他已证明公共支出闭合。每笔记录真实 payer、供应商原 `shopFunds`、净额、税、引用的 budget cap/spent/reserve/remaining。玩家/道路等工资若从已 funded escrow 支付，公共初始 reserve/refund 已记，不再把其 gross 当第二次 treasury 付薪；公共材料实采购也不能将同一 procurement 再从 ledger 重减。

初档已有253 publicLedger 行，必须在初始 import 后 seed seenLedger；只收本轮实际新增原 writer 对象，保全被512原上限自然滚出的本轮行。以实际源 event/ledger 身份分类，排除“城市…”汇总和已有 event 证明的重复 sourceEvent，不能重放 inherited ledger 做本日收入。未知直接收支必须作为未解释差异失败，不能拿现有 ledger amount 再凑一个抵消总额。每个 finance 前后、security 后、politics/feedback 后都有稳定现金与财政账，避免只终态平账。

## 出勤、工资与岗位链

按保存雇主 shopId（null=public）分别核 `L=arrears+accruals+wages`：`Lend−Lstart=本窗新 canonical NPC wage-earned−本窗实际 NPC wage-paid`。本原件三队列初始全0，但公式保留初值；任何后续恢复支要重新取自己的初值。到薪期只是 accrued→queued 转换，不是新赚一次。保存所有具名债权、雇主、冻结 rate、minutes、原 interval，转岗不会转移旧雇主债。

捕获 original bus 对象并原样 forward 一次；在复制落盘前，以 `isCanonicalNpcWage(event,sim)` 验证当前 owner/state/tick/clock 的真实 earned 来源，保存 site/workpoint/真实 start/end/分钟/金额、审批 assignment cap/worked 与到岗身体。earned 是有资金许可的已赚工资债，不是当时钱包到账。

原17:00每个 positive wage-paid 必须证明：实际雇主经营账户或 treasury 扣 gross、实际原 citizen 钱包加 gross−tax、taxQueue 加 tax、paid≤requested；保该 actor/雇主所有旧债和本期明细。`getCanonicalNpcFullSettlement` 可记录真实 fresh/full/no-old-arrears 来源；partial 或旧债已付没有此 receipt 仍可合法实付，不能把 null 当自动失败或拿 fresh receipt 代证明旧欠薪结清。未付余额留在原 arrears，不能删债、改原工资额/支付时点或重复扣 profit。

审批和招聘分别记录实际调用及原结果：雇主真实6–17现场复核、公共原8–17双官员/有限余量、owner/employee 到岗与真实分钟、保护旧债/承诺/运营及生命周期资金、自然接受岗位的零 cap/zero worked，再到后续现场合法签 cap。观察 wrapper 只调用原实现一次，不能重新审批或人为触发 choose/review。

“自然job76缺聘”列为待具名观测的问题标签，不能硬写当前 jobs76。原4610 runtime/state.publicLabor 均不存在，civicStaffing也无 jobs；citizen76是星港官员而非已证私营缺聘者。按原 review 谓词当前公共候选287；3天 forecast 门槛45434.774471578785小于 treasury63983.18759107223，因此未创建 registry 是当前原守卫合法路径。若一天内自然财政触发，就保第一原创建事件、jobs完整 IDs、旧 standing/日班许可和实际 privateMoves；若未触发就记 NOT_TRIGGERED，不制造欠薪、裁员或倒闭。

## 食品完整库存与累计因果

入口食品 `F0=15814.241185989758`：实际 kind 为 farm/dock/market 的 shop inventory13883.241185989758、所有居民 food251、player food0、车辆食品426、district freight1254。来源分类用原 World 的 building.kind，不能用“workshop-bXX”等 ID 前缀；16 正 cargo 全是具名 farm/dock 来源（dock230/farm196）。runtime.freight 与 freightLots 是同一库存/货权两种表示，每区必须等量，只计一次；全部原 lot.shopId=null 是已继承库存，不补造原生产者。trade consignment/ownedLots 与绑定 company.inventory 是已计 shop 库存的货权/镜像，不叠加；释放公司的真实独立库存另按 actual kind 列项。

`Fend=F0+ΣfoodSite原positive production.amount−Σstored-meal.amount−具名NPC食品柜台sale实际即食份数−Σplayer food-consumed.amount`。每笔 NPC 购买 quantity 拆成1即时餐和 quantity−1携粮；买给家人、父母向孩子交粮、批发、装货、到货、FIFO入店、寄售/退货是保管转移。材料与食品分账：工业 procurement 不能算食物消费；材料来源/未知 cargo 不能默写食品正生产。原 cooking=null、player只有block库存，唯一speed命令不会创建 cooking；逐帧仍核无ingredient/dish/job，如真实出现则必须读取原配方与食材/菜品完整库存、明确转化，不能忽略。

重要原事件时序：`cargo-arrived` listener 先加地区 freight，emit 返回后 vehicle.cargo 才归零。原 bus 回调内全城 F 暂时双计，不能以这一个微步骤宣布增粮或强行设cargo0；完整 food mass 在 traffic 原 phase 返回后、其他 phase稳定结束及整 tick 后核。逐货 owner/quantity/source/destination 原 FIFO 过程另存全原事件与前后车辆/货池/店库存；quote/offer不当成交。

每个 farm/dock/workshop 原 commerce batch 同时记录其取走的 shopLabor、生产前库存、真实 siteEnergy/technology、原 positive production 与零输出原因。`commodityObserver.productionMinutes` 只含正产批次，不能替代完整 funded attendance。原 farm target120：入口26/31场库存≥120，允许付薪真实工作但生产0；31场总粮4351.118394550422，min69.4888079255587/max160。120同时仅阻“无既往 sold 的 shortage hiring 特支”，`sold>0` 的普通 offer仍可合法招聘，不能说全部招聘被120禁止。

自然招聘观测保全部守卫：public registry/零公共 allowance、8–17、adult/health/needs/craft/decision、无他项任务；店营业、有限经营现金扣保护工资、headcount/容量、home到店≤500与真实 sold 或 shortage。shortage另要库存<120、owner实在work点、review次数<150、候选可在17前到岗、具名买家在20前可到且人数>库存。若无法满足就记录当时原操作数与原因，不搬 owner/买家、不降低 hunger、不给身份或粮钱，不把一日无自然招聘自动当 bug。

## 原件、保存容量和 root owned gate

每个成功步、初始导入、speed 命令后及失败 frontier 都保独立完整 gzip UTF8 save，原字符串字节/UTF16长度/raw SHA/encoded SHA/写读解码逐字一致；同窗完整 ALL bus 也立即gzip，保十阶段前后稳定现金/食品完整账、债权与原 causal receipts，最终保整支完整bus，不用摘要替代原 save 或 event 参数。保存源码/原World/原主档/计划/命令和所有输入SHA before/after；输出只能新绝对目录、wx、不可覆盖旧FAIL，不自动retry同目录。终档保完整真实分片落盘/读回/原 native assemble exact，可只读操作不新增 Sim/future步。

此主档 v4 使用**原** live8,000,000 UTF16字符、civicHistory archive16MiB UTF8、完整上界24,777,216字符、全树2,000,000 visited/depth24；不可把所有原档误裁成8M，也不能把其他活跃账塞 archive。每帧先完整原件落盘，再生产 validateSave，只读 preview 前后完整 live 不变，保实际 live/archive/full三项成本。原数组/页/预算/字段限额全部保留，不删 routes/NPC/shop/debt/civic history或降断言来跑满360。全域保存没有通用未来原子预算保证：若 writer/reader某步容量失败，保实际已推进或已拒的完整 state/runtime/bus/phase，分别报告 BEFORE_STEP_REJECTION 或 POST_STEP_READER_FAILURE，不伪称全部失败都未推进。

拟定独立 caps（root启动时再次冻结确认）：360成功步、最多361尝试（只允许最后一次明确拒绝，不重试），leaf wall1800秒；ordinary 工作在1740秒停止，拟留60秒收尾；原件/完整日志总512MiB，Node `--max-old-space-size=3072`，不提高生产保存限制。已有同档 gzip515552–519589B仅给估算：363整档按519589为188610807B，约179.9MiB，phase/receipt/ALLbus/分片等费用另计。不能引用新水电小图 gzip 比例作为此主档压缩率。

失败原件预留目前标 **RESOURCE_PROOF_PENDING**，不能以8MiB或旧压缩率宣称足够。合法 v4 完整24,777,216 UTF16字符的保守UTF8界已是74,331,648B（约70.89MiB），尚未计gzip/ALLbus/phase/receipts；已越界的 poststep frontier 不受合法reader界保护。60秒也只是墙钟规划，尚未证明能完成最坏档的序列化、编码、写读。未来 NEW adapter 开 gate 前必须从原实际writer证明“一普通窗可能增长的完整frontier＋该窗全部事件＋完整失败收尾”的有限上界，并在每次 step 前按该界预留磁盘与时间；所有写入另做实际 encoded bytes 硬检查，失败写入不可被 ordinary guard 短路。若不能证明，root不启动ROOT24，保持RESOURCE_PROOF_PENDING，不把后置写失败说成已保全、也不通过提高生产保存限制补偿。512MiB不足时须在已证明的安全步前停止，保全此前全部原件并报PARTIAL。

若未来实际执行仍发生未覆盖的系统/编码/写读失败，必须保留原失败及已写件，逐件列明缺失或未读回原件，状态为FAILED/PARTIAL＋EVIDENCE_INCOMPLETE；不能用摘要替代完整save/bus或写PASS。本准备阶段尚无此类执行结果。

复用现 root run-phase.py 的NEW run目录、原argv、完整raw、递归源hash、PID/startTicks/递归 ancestry owned 后代、独立 wall、TERM→KILL只清本scope、receipt/activeDescendants=[]；当前 ROOT23 PID 和其他用户进程不触。root唯一执行；执行前ROOT23必须完成并记录最终源码/兼容/build结果，ROOT24再冻当时实际源及新adapter，不继承一个旧PASS算当前运行。

成功只证明这个主档下一日的钱、食品、工资、审批与保存实际闭环：360窗和真次日17:00、全部强守恒/原采购实付/原薪酬/reader检查、source稳定和owned清理均PASS；存活守卫保持原616基准无新增死亡。NPC现金趋势、贫困/饥饿/休息、迟到、零产/缺聘、库存地理与商业状态按真实结果报告，不以研究必须新增/农场必须产粮/必须倒闭作为一日续档强造事件。14日稳态、默认水电投运、自然设备施工/灾害、全艺术与Mac均未在此计划完成。
