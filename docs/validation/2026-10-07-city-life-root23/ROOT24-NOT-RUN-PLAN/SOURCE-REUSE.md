# ROOT24 续档 adapter 的静态复用点

全部是 read-only 规划，NOT_RUN。旧文件不改，未来若 root 授权编制，只新增续档 driver/observer；本阶段未编制产品脚本。

- `scripts/economy-audit.ts:57–60,92,301–306`：现CLI只create新城，直接改tax/police policy及setFocus，不能作为4610续档入口。
- `scripts/economy-audit.ts:283–297`：全现金保管/公司绑定别名可复用；新增 hydroMaintenance escrow须仅在真实存在时列入。更完整版本在 `scripts/hydro-maintenance-actual.ts:51–67`。
- `scripts/economy-audit.ts:106–114,136–162,197–231,237–242`：原税/工资/采购与ledger观察可复用，但 seeded oldLedger、initial wages/accruals/arrears、initial escrow差额必须按续档改；317–325新城零起点终式不可照抄。326–327强制新研究也不适用这个一日目标。
- `scripts/economy-observations.ts:13–57`：commodityObserver按真实kind与canonical wage-earned记到场/正生产；callback应闭包到当前sim owner；zeroOutputBatchDisposition本就NOT_OBSERVED，须另读真实batch，不把productionMinutes当所有劳动。
- `scripts/economy-observations.ts:62` 与 `src/simulation/food-access-observations.ts`：foodSnapshot/具名路径与服务分布适合诊断，不是全库存账，也不证明真实到店。只在原实现真实调用周围透明观察，不再执行choose/review或用规划可达代成交。
- `src/simulation.ts:398–427`：attendance→原冻rate wageAccrual→canonical earned，真实前段cap/到岗分钟；`438–444` shopFunds/PayrollDebt/CommittedPayroll/ProtectedFunds是别名与保护基准。
- `src/simulation.ts:464–486,661–706,714–729`：原现场private审议、公共三天门槛/实际review、财政reserve与available；`1482–1548`原缺粮/可达招聘，保所有原predicate。
- `src/simulation.ts:1986–1999,893–905,2135–2177`：17:00原工资flush→队列→实现金writer和税队列。fresh/full来源不是所有欠薪付款证据；保partial、requested/paid与旧雇主债完整。
- `src/simulation.ts:2024–2038,2063–2111`：真实foodsale/携粮、batch取走shopLabor、target120正生产、有限FIFO/批发/原utility cash；不能新增产量/工资或重新调用writer。
- `src/simulation.ts:910,1117`：cargo-arrived事件先入freight，随后清cargo；稳定phase结束再核全food，原微步骤内双计不可误判。
- `src/simulation/family.ts:441–447,567–579`、`src/simulation.ts:1845`：家庭交粮/代买是转移，stored-meal才消费。
- `src/persistence/save-resource.ts:3–21`、`src/persistence/partition.ts:30–65`、`src/simulation.ts:2626–2629`：原v4 live8M/archive16MiB/完整24,777,216chars/全树2M/depth24、原始分片与字段顺序；不把全档8M误当v4合同。
- `/workspace/yunshan-work/ROOT23-ledger-scaling-20261007-01/run-phase.py`：复用已有NEW目录、PID/start-time/递归后代 owned、完整raw、源hash与失败不覆盖。ROOT24 leaf与ROOT23正在运行scope独立。

因果背景完整读取：ROOT12 `CAUSE-REVIEW.md`（农场库存目标与正产分钟口径）、ROOT16 `ROOT16-FOOD-CAUSE-REPORT.md`（真实长期步行/原229后续全部成交，不能把报价当到达）、ROOT05 `ECONOMY-NEXT-ENTRY-original.md`（原公共审核/补给循环，不把旧终档原因直接移植当前）、当前memo ROOT20/22/23。历史FAIL和PASS各保持所属源码/路径/窗口；当前缺聘与稳态尚待实测。
