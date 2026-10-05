# 已付尾史归档：待评审契约，尚未实施

当前实际第257结算回调会抛错，且ledger记录全部公共工资，不限于柜台人员。候选必须保证已赚工资仍进入原队列并可偿付；不能把容量错误留在people→finance之间。现任务、库存、交班、预算、材料和销售是互相引用的账，直接slice前256或重编号会破坏它们。

本契约只承诺 **已结清、无活跃引用的尾史有界**。所有未清债、当前劳动、活跃货权、等待交班与预算强引用完整保留。固定字节容量、无限新增独立欠款、逐条保留全部欠款，三者不能同时成立。若以后要求全状态固定容量，须在新承诺前预留全部结算槽或外部必需档案页；不能截断过去债、阻断已批准劳动，或在17点抛错。现原公共工班没有这样的容量准入，本轮不擅自添加。

候选应明确新版本，例如v3。v2继续严格验证后仅作元数据迁移，v1先沿现保守迁移；legacy null epoch不代表已证实付清。原legacy任务集合本身有旧格式上限，保留全部未知前缀，不把它们折为“已付”统计。absent柜台主体的旧档仍不新增任何柜台/归档字段。新版本独立runtime声明、manifest和body双向存在；归档清空活跃数组后也保留声明/nextId，缺主体不得当旧空初始化。

建议数据形状如下，只是接口草案，不是生成源代码：

```ts
payroll: {
  epoch: number;                 // 永久绝对序号，不受裁剪重编号
  openedAt: number;              // 当前期真实开启边界
  periods: PayrollPeriod[];      // 按period.epoch查找；保留所有未付或有强引用的期
  archived: {
    periodCount: number;
    paidGrossByCreditorEmployer: Totals;
    earnedMinutesByActor: Totals;
  };
  dayUsed: DayUsage;             // 当前单调日、未知legacy日及仍有强引用的日
  archivedDayUsageByActor: Totals;
  legacyDue: RealLegacyDebt;
  legacyTaskIds: string[];
  legacyBlockedDay: number | null;
}

counter: {
  responsibilityHead: TaskRef | RetiredBoundary;
  tasks: CounterTask[];
  handovers: Handover[];
  stock: CounterStock[];
  history: {
    completedTaskCount: number;
    allocated: WorkKindTotals;
    earnedGross: number;
    paidGross: number;
    receivedThroughput: number;
    sold: number;
    returnedThroughput: number;
    salesGross: number;
    supplierGross: number;
    saleTax: number;
    supplierTax: number;
    publicMargin: number;
  };
  archivedSoldByStillLiveOrigin: OriginSoldTotals;
}
```

上述Totals的精确键应由现真实creditor/employer/actor集合决定，不能用摘要抹去未清合同的原雇主、rate、minutes、principal或时期。dayUsed用于防同单调日重复480分钟，不随visible clock重置。paid累计是历史事实，不是一笔可提现现金。货物流量throughput也不是可用库存；同一份归还再取可以产生多次吞吐，不得将其累计当新产量。

必须保留的根与依赖：

| 根 | 不能裁掉的依赖 |
| --- | --- |
| 未清工资与原queued/arrears | creditor、public雇主、原period/claim、合同费率和分钟、gross−paid |
| active/paused任务 | 原工班、epoch/current边界、当天累计分钟、路线、pickup、装卸进度 |
| live库存和待搬原区货 | 原lot、null/真实货主、冻结H、node/native vehicle origin、现保管人 |
| pending交班 | from/to完整任务、真实位置、stockIds、两方分别已赚分钟 |
| 当前责任人 | 最近有效责任任务；不能由未完成incoming任务接管 |
| 当前/未来正式计划 | 原public-shift assignment/cap、两个真签署者与原岗位 |
| 柜台、预算与材料 | 原预算双向引用、真实采购收据、已收到/耗用材料、装配劳动 |
| 尚有引用的sale/queue/stock | FIFO allocation、供货实款/税、真实服务分钟与买家完成状态 |

`continuationOf`当前构成传递链。仅保留所有祖先会无限增长；候选应将已付、无其他live引用的旧前缀转成 **一个当前边界凭证**，区分完整task引用与retired边界引用。凭证保留原演员、岗位、费率/工资/分钟、完成期/时刻、结清状态与实际责任人。不要创建无限tombstone表，也不要先删指针。原装配劳动仍需以“历史allocated.assembly＋完整任务assembly=实际assemblyMinutes”对账，真实材料收据不得遗失。

已关闭queue、sale、耗尽stock和完整已完交班须按依赖成组处理。销售服务分钟改为“历史sales分钟＋完整tasks销售分钟≥历史已售服务分钟＋保留sales服务分钟”。gross、供货款、两类税、公账margin均是原已付事实，只做累加，不再次入账。

同原lot尚有区货、柜存或pickup时，保留其已归档sold累计与同一origin。约束仍为“原区货剩余＋柜存剩余＋保留sold＋归档sold≤原received”。归还已回原区货，不能把returned又加进余额。只有原source完全退出所有live引用，才可将其明细并入全局吞吐统计。nextLot/nextTask/nextStock序号永久单调，不复用旧ID或凭归档重新造node收据。

结清判定需强化当前工资cross guard：现validator只要求ledger outstanding≤原core dues。若存在真实未付债，单改paidGross为满额会降低outstanding，这个下界不足以排除伪结清。**本轮没有非零未清原件实际复现这个篡改**，不能将静态风险冒报为已复现漏洞。候选应对真实legacyDue＋所有未付claims按原creditor/公共雇主汇总，与原queued/arrears要求相等；current未到期accrual另外验证，不能混进已到期债。还需由真实payment callback累加独立已付锚点，归档累计＋保留paid与锚点相等。新收款/清债/继承规则须接到同一真实账，不允许public wage-paid事件造回执。

摘要hash只能检查局部损坏，不能认证raw JSON历史。用户同步改body、声明、核心债务与完整资金历史时，普通marker/FNV不是数字签名；本候选不声称防这种一致伪造。没有原支付来源的legacy仍保未知证据，不从外部观察日志自动认证为已付。

实现顺序应是：原onPayroll始终完整记录已赚、结束本劳动段，再由原finance支付；真实onPayment更新FIFO paid。此后在确定的post-finance边界，只对验证成功且无强引用的完整已付记录原子压缩。onLoad不基于可变clock再次压缩新版本，以保持新档import/export字节精确。压缩不改任何wallet、treasury、库存、角色、合同本金、原rate、分钟或剩余预算，也不清空坏的历史profit。

生产前需要真正执行的验证清单：

1. 第257个真实已付/无引用period顺利完成原工资结算并压缩，绝对epoch不重编号；当前原件是反例FAIL，不是候选通过。
2. 真正最旧非零未清债保持；后续全付期可以独立压缩。删债、伪付满额、改已付锚点均原子拒绝，原债权和现金不丢。
3. 超256个实际劳动/交班任务后，已付无live引用前缀可释放；责任人、当天480 cap、原工资、原岗位保持。当前只有源级cap确认，未实跑该压力场景。
4. 携货、pending交班、未完服务、材料/预算/来日计划强引用阻止压缩；未付容量不导致已有劳动冻结。
5. 有售出/归还/再次取货的原lot，压缩前后库存、供货net/tax、公账margin、服务分钟恒等；不得用累计吞吐当库存。
6. 新档marker/body/required archive页双向presence，错epoch、缺边界、缺live-source累计或重复lot原子拒绝；真正旧v1/v2迁移保全部未知/债务/货权。
7. 归档边界完整保存和24tick clone逐字节一致，含17点真实支付与visible clock回调；当前自然观察的保存通过不能替代归档器此项。

如果无可压缩记录，允许已赚记录完整增长并显示“未清/强引用档案占用”，不能在结算路径抛错。以后若需要严格物理容量，再按真实公共授权协议限制未来新增承诺；这影响全体公共班次，须另评审，不可只限制柜台staff。source/current-v4功能点及默认食品供需是另两项阻挡，不能以完成归档替代生活覆盖。
