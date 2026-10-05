# 医疗与政治子系统：当前工作树只读审查

范围：2026-10-03，本轮仅读取 `/workspace/yunshan` 的源码、提示词/AGENTS/备忘录及已有验证原件；只在本 `/tmp` 目录写报告。未运行 Node、Simulation、build、tests、浏览器、长程审计或性能比较，未创建 ZIP、调用外部服务、spawn、修改/回退共享文件。结论中的“静态缺口”不是已实跑复现。

HEAD `15550fd968023c4bd436a2f60022ff45d6c3d5da`，分支 `takeover-city-life`。起读工作树实际 dirty：controller/main、备忘录、需求矩阵及新的输入时间测试/验证目录；本轮没有改变它们。起读共享 `src/simulation.ts` SHA为 `ba289751a2990ae405538801561d6032c982148f15887c1c8745da2264a06f49`。报告写成后，另一owner并发写入零售即时付款修复，末读core SHA为 `dcf488259dd1b56abdbd55a982aa7687e14f10d4261bb6b915f296d6381e21d4`；9个选定source/tests中其余8个SHA不变。**不是冻结执行或首尾全部同源**。只读git diff显示差异为retail helper/customer付款/每批销售统计及其validator；下述医疗、公共/私人劳动审核、预算、政策函数本体未在该diff改动，但行号整体移动。所有源码行号按起读ba289版本给出。不存在共享food-distribution模块；隔离食品柜台候选未接入，不能把它的自然续班/饭休结果算作生产医疗或政治覆盖。末时新增retail-immediate目录/tests和core dirty属其它owner，本轮未改。

## 1. 医疗：已经实现的具体行为

* `clinical.ts:104–115`：存活患者、成年存活付款人、双方在真实诊所公共服务位置、至少有非患者的成年已任职医生，才可登记。实际30文钱包→订单escrow；未完成患者唯一订单与旧/新复诊期限独立检查。登记不增加健康；有医生任职只允许承诺等待，不表示医生已经出勤。
* `clinical.ts:122–136`：每60单调分钟重试，只买工业 `materials` 一单位；读取真实 producer报价与库存，保护供应者有限收款容量。实际源库存减1、托管扣gross、供应者实收net，emit wholesale让原finance收税；不是从公库再扣30，也不是免费造药。已有取消留下的clinic stock可真实复用一次。
* `clinical.ts:138–165`：8–17开放、患者本人在公共诊疗位置且有最低饥饿/体力、医生实际受雇/working/已登记attendance/在真实岗位且健康与needs合格，才累加20分钟。离场、缺料、无班次或容量不足保留等待。完成才耗1、健康增加25+已完成medicine等级、压力减8、余escrow作为真实服务费入公库并同步lastTreasury cursor；60分钟复诊。
* `takeClinicalDoctorSlot`：公共culture医疗先运行、付费clinical随后运行；同一tick每医生最多两病人、同一病人一个槽。它是现有并发容量规则，不应误写成一位医生可无限治疗或两个模块各自容量加倍。
* 取消/患者或付款人死亡：只退未购未赚escrow，已付采购款不返造；物料回clinic可用库存。钱包满则保留refundPending/escrow义务，银行遗产不能先抹债。订单超过192时可归档已终止、escrow0且结束满一天的项目；不是食品原型的257结算硬停止。未结订单256上限依然可能阻止接诊，记录等待不等于已有容量治理。
* `extensions.ts:157–161/432–436`：NPC health<60且本人≥30，到诊所后委托同一入口；玩家heal可替身边居民付费，但仍由临床入口检查双方实际到场。无钱NPC不再走旧30文即时公库福利，公共治疗须有culture已批准服务。
* 公共culture health：请愿订单采购最多6份材料，每病人真实20分钟耗1、增25+medicine（压力减2），使用上述共享医生槽和复诊期限；它与付费诊疗分属真实财政授权/私款托管两条付款来源。

## 2. 医疗：尚缺或需要精确验证的闭环

1. 没有独立疾病、伤型、诊断、处方、药物剂量/疗程/感染/耐药字段。当前是health标量受饥饿、疲劳、年龄、水质影响，工业材料提供通用治疗；不能称已有完整药病系统、药厂链或医师玩家职业/执照。
2. 采购直接从任意地区工业producer库存转到clinic/order。数量与现金真实扣减，但不存在载具、实际送达时间或在途药材。不得把有采购receipt称为药品物流已完成。
3. **静态场所配对缺口**：付费doctor与patient各自可在同诊所不同合法公共floor的服务点，匹配依据只有siteId；culture staffAt只要求同site isOnDuty，患者reader/atSite另查自己的公共floor。没有明确doctor/patient同一floor/诊疗station绑定。已有v4“真实服务点/禁止院落与错误房间”守卫不自动证明两人共用一个诊疗位置。尚未运行跨层反例。
4. 公共医疗没有默认独立临床救济预算/自动贫困病例议程。当前请愿由玩家10文备案、现场联署、一天答复再进入服务订单；NPC自然阅读/联署/到场会履约，但不能由此说贫困居民在无玩家请愿时有持续公共医疗入口。
5. 公共医疗受真实医生班次与饥饿/通勤影响，材料到货不代表服务覆盖。既有20分钟与退款/库存测试含受控医生位置/needs/role fixture，不能冒称生成城市自然临床供需稳态。
6. health制度指数会在extensions politics向 `62+medicine*1.8` 自动回归，所有人的health也有medicine被动增益。它们是模型参数，不等价于实际诊疗次数/覆盖率；应另报等待人时、到场医生时数、耗材/完成/死亡。

最小候选M1：统一一个只读 `clinicalStationPresence(actorId,siteId)` 返回实际floor/服务点，然后两条医疗路径都要求医生与患者同station（旧unmarked保持旧契约），不改30款项、20分钟、1物料、2槽和复诊。必要验证是跨层/错误服务点不增分钟不耗料、移到合法同站才继续、公共/付费共槽、完整save+24ticks和现金/库存恒等。该候选未实现/未运行。

## 3. 政治/公共财政：已经实现，门槛须分开

| 路径 | 当前真实门槛与资金/分钟 | 不能混同的规则 |
|---|---|---|
| reviewPublicShifts (`simulation.ts:358–396`) | 公库不足覆盖三天时才激活publicLabor；保留当日standing。每60单调分钟找8–17两名合身份、needs稳定、存活、同实际hall/core/bank岗位点官员，按未付/已赚工资、既承诺班次、必要物料与授权余额，批准当天/来日有限cap与固定rate。没有钱可真实签0cap。 | **不要求isOnDuty、working或既有attendance**，故不能概括成“没工资永不能班审”。当前只有现场快照，没有会审累计分钟。 |
| isOnDuty (`398–403`) | 当前workId一致、working、成人实际受雇/剩余工时、attendance>0、身体在岗位与v4work point。 | 医生/老师服务资格、NPC采购签字另用此门槛；不是公共班审条件。 |
| authorizePublicBudget (`421–441`) | 实际有限available；唯一id、当前时间、法定签署。NPC须isOnDuty；市长现场，或两议员，或同署至少两签且cap≤40。仅保留额度，不凭空加钱。 | 这里的“签字出勤”确实不同于来日班审。culture自审只用同请愿site两名官员cap40；不能据核心API的更宽权限推称已实现任意议案。 |
| purchasePublicSupplyReceipt (`450–478`) | 护工资债、未来工资承诺与其它授权；工业materials有限供货与动态报价；公库gross→供应net+税queue；budget.spent真实累计。 | essentialOperations是材料资金预留，不包含议会审核工资/人分钟，不能当财政提供了会审劳动。 |
| privateLabor (`258–280`) | 实际店主/公司owner健康、现场work point，保护过去工资债+未来承诺+必要运维，再批准真实有限劳动分钟；新现金可追加但旧rate/min不改。 | 它是私人雇主用工；不能作为医生公职或公共议会授权替代。 |
| culture petition | 玩家公开现场10文备案；自然成人现场联署，一单调日后公开回复；≥3签且本区有真实设施才建独立订单。未审批不采购；两在岗官员routine40或市长真实决策层40–160/驳回。材料+工作人员+病人/学生实际分钟才完成；成功关闭预算释放未用额度。 | 回复不是拨款、服务、法律修改或已达到效果。缺设施回复明确无订单，不虚构设施。 |

真实工资：registerAttendance受480/day与已签allowance限制，accumulate immutable雇主/rate/amount，earned公共债与private debt继续保存；无付费工时则offDuty，不用未付劳动充服务。publicLabor.jobs是激活时公共来源表，历史shift的assignment引用此表；不能直接随appoint覆盖该表毁掉旧债/过去班。

## 4. 政治具体缺项（源码事实，非本轮runtime复现）

* **部分供货后的批准死路**：culture authorizedCap40，若实际6份报价总价>40，可真实花完40但少于6份，履约一部分后进入awaitingBudget。politics/reviewPetition只审批agenda/awaitingReview，不能给这个已经批准的订单补额度；filePetition又挡同topic未完成订单。因此公库后来恢复不自动解除这种等待。既有dynamic quote测试证明保留未完成部分，不证明后续能依法补批。
* **0cap/低cap班次不能当天补审**：reviewPublicShifts一旦该day有shift就跳过，真实新入库现金没有additive补班入口。privateLabor有追加，public没有。未批准的时数必须继续休班，不能靠放松isOnDuty填补。
* **任命与雇主来源未闭合**：appoint即时改role/workId并公库-100；源码没有这100的实际收款账户、有限培训材料/训练minutes，publicFunds只调treasury/cursor/ledger。publicLabor.jobs仍旧source，后续assignment可能不匹配新workId，既有岗位审批/读档来源要版本化。这是static path缺口，不称已跑任命坏档。
* **政策审核简化**：policy只查mayor身份/真实合法hall/core位置与参数，直接写pending；120游戏分钟后必然apply。没有两署会审记录、表决人、同意/否决/法定决定与预算影响票据，通知“议会通过”强于实际机制。重复合法提交还能替换pending，没有稳定议案ID/历史。
* **选举简化**：120真实登记费入公库，两小时后按登记时冻结support+声望+affection的分值阈值62授mayor。没有真实个体投票/参选竞争/任期/复议/罢免；测试证明资格、时限、fee与保存，不证明选举制度完整。
* **政治历史容量**：culture petitions终身16、reports32，没有已答复/已履约归档；publicBudgets关闭后仍留array、终身256。到上限拒收，不能把clinical已有归档误套这里。压缩必须保active服务、实际spend、物料与签字交叉引用及老工资债。
* **审计司法简化**：公共职务贫困/压力可实际挪公库到钱包；真实ledger线索→举报60min→有身份调查120min→证据阈值/追回现有钱包→撤职。并非法院/律师/申诉/监狱/证人完整流程。追回不足时diversions按原diverted全部减去，没有独立剩余追偿债；publicLabor旧来源/shift随撤职同样不能冒称已处置。

最小候选P1（优先解除现有合法服务停滞）：新增immutable补充授权tranche，保留原cap/spent/签字，按真实当前可用现金追加，不重扣已付支出/不改已赚工资和旧rate。小额部门**累计cap仍≤40**，不能多次40规避原限额；超过40须已有更高合法权限（实际mayor/议员规则）审批。单独记录pending/rejected/approved与金额/见证，不改policy税率。culture部分医教订单和公共低cap班各用其自己的生命周期，不能共用同一guard。必要测试包括实际报价涨价部分履约→合法补批→完工、无权限/无钱不变、真实新收入追加工时、旧欠薪不丢、坏档原子拒绝和完整24续演。

候选P2：版本化任职来源（active source与已冻结past assignments并存）并将100培训从无收款支出改成明确受款/材料/现场training escrow；任命成功与岗位合法班审衔接。须先固定预算/培训成本/时间合约，不能直接改publicLabor.jobs或把旧源删掉。

候选P3：独立有限civic review session / 政策议案ID、共同presence slices、法定批准/否决、politics phase原子commit。会审是否公共付薪、具体minimum minutes是待审设计参数，不可从essentialOperations臆造。minutes须有唯一用途，不能同时追加医生/柜台/普通工班出勤。未批准不得自动调税。当前不实现该session。

## 5. 科研交叉边界（完整能源/教育科技由另一代理审）

extensions research有7sector、玩家scientist/education与实际lab工作点资格、个人100–2000现金投入公库，NPC真实自身200且留100生活费；每sector至多一job。120单调分钟timer完成才level+1，medicine提高上述实际治疗gain及被动health参数；库存生产技术仍须真实attendance。**完成timer不要求研究者持续在实验场/存活/研究labor/消耗实验materials**，投入即时成为公库钱而非独立实验采购/用工托管。不能把科技存在、timer经过和医疗20分钟守卫当同一“实验出勤”闭环。

## 6. 已有实际证据与本轮验证边界

1. `docs/validation/2026-10-01-phase2/clinical-lifecycle/` 记录原21clinical+29family+15culture=65/65、strict0；真实ee3旧heal导出/deadline迁移、资金/有限materials、20minutes、离场暂停、退款、死亡/银行债和public/paid slots。result.json明说SHA在成功后记录，**不是首尾冻结**；clinical当时SHA `dd85e9…` 与当前 `7faaa1…` 不同。不能把65称当前dirty树新通过。测试使用受控人物role/position/needs，单元scope保留。
2. `docs/validation/2026-10-02-v4-root-coherent-04/` 原完整465/465、exit0、99冻结输入首尾同。clinical/culture/extensions及相关tests的SHA与当前相同，但当时core是 `fea9a937…`，当前是 `ba289751…`，且共享geometry、controller/main又有后续变化。它是真实旧整体证据，不证明当前dirty综合源已重验。raw rules.log有真实clinical service点、paid/public、petitions、未来public shifts、medicine research等PASS。
3. `docs/validation/2026-10-02-system-coherent12/`：106冻结输入build0、28相关规则PASS、正式编译浏览器11/11/errors[]；原生住宅W目标FAIL，后续住宅业务0项。其browser含受控交易准备，不能代替本轮普通clinic/议会完整玩家旅程。
4. coherent13 build receipt仅timing-only实际build0；本轮未运行任何新检查，也不从其build推得医疗政治PASS。root/retail正在独占自然31+24 CPU，未读取/修改其运行快照或发signal。此报告不声明它已结束。
5. 历史old-instantheal的14日健康指标不能当新clinical/default医疗覆盖；食品196/day与853/day、自然医生/官员饥饿及失班、默认财政30/60稳态仍独立未完成。新地图缺设施/电网/道路诊断是后续范围，本轮没有生成/修改新地图。

建议下一轮先只实现M1同诊疗station配对与P1补充授权这两个可短回归闭环；再审P2/P3。所有候选必须另记源码、测试与原失败，不能把本报告的只读推断当通过或完整项目完成。
