# ROOT15 extensions 原全套超时只读诊断

结论：**原 full suite 的结果仍是 TIMEOUT_PARTIAL，tests359 / pass280 / fail0 / cancelled79 / skipped0。唯一可定位的运行中范围是第39个文件 tests/extensions.test.ts，文件记账耗时1839894.004504ms（30分39.894秒）；现有 raw 没有35个内部原测试名，不能确定当时执行哪条回调。** generated city 科研是重负载候选，不能写成“实际卡在1479”。本报告没有运行任何 Simulation、测试、构建、浏览器、GPU、外联或共享代码/文档写入。

## 范围、身份与读取规则

- 主要对象为冻结 source 图 b5b126b81c81726c85e6c6d7ac1ff486c2ede464aa5deb2825ba405ff861eff3，见 [FREEZE-RECEIPT](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/FREEZE-RECEIPT.json:1)。原运行的318项 inputs-before/after 字典逐项相等；本报告所涉 source 文件 SHA 均与原 input map 一致。证据、当前 test/package 对照及保存的 Node 源码 SHA 在本目录 sourceSHA.json。
- 当前共享 tests/extensions.test.ts 与冻结原文件 SHA 都为93d3f77a390a820114011e8be994c15bfde438aa4c93b4a8fbacaaa88fde764f；package SHA 都为5c354ed4cc632ced189e9dd93f40e29c03a7725c136d955d31a27c50fafc5c57。父任务正在改其他生产文件，本报告不把 b5b 图等同于父任务后来正式图。
- 已完整读 AGENTS.md、提示词.md 和开始时439743B的开发备忘录.md，包括截断后补读的区间。父任务随后更新共享备忘录；没有捕获原439743B快照的SHA，所以不声称当前 memo SHA代表最初所读快照。遵守原断言、原seed、原fixture和十阶段顺序，未替换为新增资金、抬高needs、较小人口、较短天数或跳过修改。
- 原35个顶层测试名、顺序、源行及“是否出现在raw”的只读清单为 original-test-inventory.json。独立子审计交叉核对保存的 AST inventory：全部117个 test 文件 SHA 与冻结 source 一致，extensions 顶层 bindings 为空；没有执行 AST 扫描脚本。

## 已发生的事实（FACT）

1. 原 none 模式不是本次 timeout：旧图7e3e32e4…的 [package:10](/workspace/yunshan-work/ROOT15-final-integration-20261004-01/source/package.json:10) 是 test-isolation=none，旧 [receipt:2](/workspace/yunshan-work/ROOT15-final-integration-20261004-01/full-rules01/receipt.json:2) 记20:33:19至20:45:19、exit134、timedOut=false、FAIL；旧 [raw:113](/workspace/yunshan-work/ROOT15-final-integration-20261004-01/full-rules01/raw.log:113) 有约4GB Mark-Compact及 FATAL ERROR heap out of memory。旧318输入与 b5b318输入之间唯一差异为package.json；原 tests/production/seed/fixtures 都未改变。这证明实际发生OOM，不证明其占用全部来自 extensions。
2. 本次 [package:10](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/package.json:10) 是 process隔离、test-concurrency=1。[receipt:2](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/full-rules01/receipt.json:2) 记20:51:09.686700至21:51:10.132658、exit−15、timedOut=true、TIMEOUT_PARTIAL、318 inputsStable=true。raw SHA为da45819587d5569cf5a0014fcead7367eaf22afb676fbeedabe970c90e8bbb79，receipt SHA为37ee7bcb2e41eb182b5a58d6c6698192a3d4d4cb124c8236078814c004fe8705。
3. [raw:300](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/full-rules01/raw.log:300) 最后可见PASS属于 education-saved-time；[raw:302](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/full-rules01/raw.log:302) 中断列表只有 extensions 文件在运行，后面78个文件取消。静态117文件排序中 education-saved-time为38、extensions为39、family-fee-education为40，与原日志吻合。
4. [raw:384](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/full-rules01/raw.log:384) Node摘要为359/pass280/fail0/cancelled79，原3599685.073591ms。[raw:395](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/full-rules01/raw.log:395) 重印取消文件与 Promise resolution… 错误。该79包含当前extensions FileTest和未执行的78文件；中断列表与末尾 failing tests 的重复展示不是另79个业务失败。原 receipt 末尾 activeDescendants=[]，finalOwnedMembers保留Z态成员；只证明 wrapper 观察范围内没有活跃成员，不宣称系统全部进程或僵尸均清空。
5. 以父Node记账总耗时减 extensions文件耗时得到1759791.069087ms（约29分19.791秒）。这是前面文件、启动和其他开销合计的时间差，不是独立计时的纯前置测试耗时。原全套一小时到达该文件时，只剩约30分40秒；原文件独立获一小时会是另一个明确 scope，不能回写原全套PASS。

## 原文件的构造、循环和高成本候选（静态 FACT；排序为工作量推断）

[extensions:1](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:1) 仅直接导入 simulation、world、types与node:test/assert，没有导入其他测试或fixture文件。[fixture:8](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:8) 创建seed1977的两区42建筑、4节点/3边紧凑world；[create:50](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:50) 每次调用在回调内构造新Simulation并设speed8；[restoredFrom:156](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:156) 构造同world的另一Simulation、原样import及deepEqual。所谓“小图”仍按 [initializeCitizens:262](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/src/simulation.ts:262) 至少创建384NPC，不能以两区 population 字段当成少量NPC。

[step:842](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/src/simulation.ts:842) 同步累积0.25秒tick，每tick游戏分钟为0.25×speed，并同步依次执行十阶段；[advanceUntil:109](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:109) 大多有4000次或显式上限，条件未达会assert失败，未出现递归异步等待。下表只算原源码可推导的tick/step下界和上限，**不是本次测得的耗时排行，也没有profile/heap样本**。

| 原顶层测试 | 原工作量及证据 | 静态成本含义 |
|---|---|---|
| #30 generated city 科研，1479 | 默认 [createWorld:432](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/src/world.ts:432) seed20261001、[layout:10](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/src/world.ts:10) current-v6；[districts:450](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/src/world.ts:450) 由11项plans生成，v6的commercial配方只改既有建筑（[59](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/src/commercial-district.ts:59)），按人口公式616NPC。原speed8，每步2游戏分钟；[loop:1522](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:1522) 至少3×1440分钟即2160ticks，未完成研究可到6000ticks；随后24×2=48步恢复未来。 | 大城几何/寻路和616NPC全部十阶段，重点候选；没有证据它已被调用或实际耗时多少。 |
| #35 两周有限/有界/恢复，1680 | [1684](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:1684) 原14×1440分钟、speed16每步4分钟，满足时正好5040ticks，原limit6000；[1696](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:1696) 再100×2=200步并严格save相等。 | 紧凑图384NPC长循环；不得缩短成几小时以宣称原两周通过。 |
| #7 七技术计时，421 | [436](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:436)、440–441每sector原60+60+恢复60分钟，共90ticks；7sector共630ticks、7原Sim+7恢复Sim。 | 重复构造、恢复完整state、逐sector业务断言。 |
| #8 七技术系统效应，451 | [464](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:464) 每sector原Sim+control；[504](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:504) 两个sector各142分钟、其余122分钟，双城共894ticks（71×2×2 +61×2×5）。 | 共14Sim；原控制fixture真实雇主资金/劳动合同/产量断言仍保留。 |
| #16 fractional恢复，749 | [766](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:766) 原.13余量存档，再240帧×双Sim；[772](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:772) 每帧全量exportSave严格相等；[777](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:777) 再60×双Sim逐tick save比较。 | 600次step调用与至少600次完整save序列化；fractional step不等于600ticks。 |
| #18 failed-load回滚，806 | [818](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:818) 原load hook先step再故意throw；[829](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:829) 120帧×双Sim及每帧完整save比较。 | 构造/候选load/回滚/后续确定性，不能删save比较变成较轻回归。 |
| #22 corruption，999 | [1047](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:1047) 转移上限500；[1023](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:1023) commerce每tick完整save+JSON.parse；后续原调查/恢复/360分钟撤权观察。 | 高频序列化附加在十阶段内，audit cases满128压力仍是原断言。 |
| #23 civic role矩阵，1122 | [1189](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:1189) 同一384NPC城先运行720分钟=360ticks，再15原subtests；[1168](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:1168) 每commerce完整save+parse。 | 不能从subtest个数猜每个单独运行城；重活在注册/核对子测试前。 |
| #28 scholar，1383；#31创业，1549 | [1405](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:1405)、[1574](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:1574) commerce完整save+parse，均有原有限advanceUntil与双Sim恢复。 | 原控制位置/needs/既有股权fixture需要保留；这是财务/劳动断言，不是自然整城证据。 |

generated 原前件与断言集中于 [1495](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:1495)：实际居民、职业/教育/skill、活着、真实实验室现场、hunger/fatigue≥40、个人保留100、实际200投入、120分钟job、公共账本与个人准确扣款；[1524](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:1524) 原按1000ticks切换focus/walk/drone；[1529](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:1529) 原三天/真实研究完成/skill增长；[1538](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:1538) 原restore和未来24。它直接new Simulation(world)，不是其他 product recipe 工厂，不能改成城市新recipe再称原测试通过。首个generated诊断直到1537、即循环与核心断言之后才发出；缺少该诊断不能反证该回调尚未开始。

特殊循环：原 [1070](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/tests/extensions.test.ts:1070) while(evidence<60) 没有显式次数上限；但每轮advance30分钟后必须ok(audit)。生产 [audit:553](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/src/simulation/extensions.ts:553) 审计冷却30分钟，对同案追加至少35证据；[createCase:142](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/src/simulation/extensions.ts:142) 将existing.evidence加上传入值。原pending案没有在该循环中执行结案/追缴。因此成功重复审计的路径是单调增证据，常规前件下可很快达60；command失败会使ok assert抛错。**“有while”不能据此认定无限循环，当前也没有实际loop-progress数据。**

## worker与顺序污染边界

**FACT：逐文件新进程，不是复用编号池中的长期worker。** 保存的Node v24.19.0 [runner:517](/workspace/yunshan-work/ROOT15-full-suite-import-review-20261004-01/runner-timeout/internal--test_runner--runner.js:517) 对每文件spawn(process.execPath,args)，[560](/workspace/yunshan-work/ROOT15-full-suite-import-review-20261004-01/runner-timeout/internal--test_runner--runner.js:560) 等待child exit及stdout结束；[WorkerIdPool:137](/workspace/yunshan-work/ROOT15-full-suite-import-review-20261004-01/runner-timeout/internal--test_runner--runner.js:137) 仅循环编号。concurrency1会重复worker编号，但不共享上一文件的JS堆、module cache或顶层world。extensions不导入 market-shopfront 等有顶层Simulation的测试，前38文件对象不能直接作为其worker的JS存活根。

**FACT：文件内每例仍可持有两个world/Sim和大量save；生命周期没有实测。** [Simulation.bus:120](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/src/simulation.ts:120) 是实例私有， [EventBus:65](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/src/simulation.ts:65)、[onPhase:867](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/src/simulation.ts:867) 记录handler，无unsubscribe；world [WeakMap:42](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/src/world.ts:42)、commute [WeakMap:63](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/src/simulation.ts:63) 按world对象身份缓存。普通Sim→bus→闭包→Sim循环本身可被GC回收；没有外部存活root/heap证据不能称泄漏。原restored与sim在同一回调内同时保留；各create产生不同world对象，恢复同world有意复用弱缓存。每文件进程退出最终可释放该文件进程内对象，不能保证长同步回调内GC时机或峰值。

**推断：OOM模式切換合理切断跨文件保留，仍不能将本次超时归为已证实泄漏或顺序污染。** 前置38文件不会继承JS状态；文件内顺序、全局模块缓存、构造成本、GC压力仍可能影响耗时。现有raw没有同一原case在新worker与原文件前序后对照的数据，没有已证实的顺序污染案例。

## 为什么没有内部PASS仍不能定位回调

保存的Node源码说明可见raw不是同步callback进度探针：[runner:499](/workspace/yunshan-work/ROOT15-full-suite-import-review-20261004-01/runner-timeout/internal--test_runner--runner.js:499) 子进程为child-v8；[utils:277](/workspace/yunshan-work/ROOT15-full-suite-import-review-20261004-01/runner-timeout/internal--test_runner--utils.js:277) child选择v8-serializer，[403](/workspace/yunshan-work/ROOT15-full-suite-import-review-20261004-01/runner-timeout/internal--test_runner--utils.js:403) compose/pipe；[tests_stream:182](/workspace/yunshan-work/ROOT15-full-suite-import-review-20261004-01/runner-timeout/internal--test_runner--tests_stream.js:182) 消息emit后push或buffer；[test:1380](/workspace/yunshan-work/ROOT15-full-suite-import-review-20261004-01/runner-timeout/internal--test_runner--test.js:1380) 同步callback先执行、之后才await promise race；[954](/workspace/yunshan-work/ROOT15-full-suite-import-review-20261004-01/runner-timeout/internal--test_runner--test.js:954) 连续待执行测试await test.run，没有显式I/O yield。父 [runner:539](/workspace/yunshan-work/ROOT15-full-suite-import-review-20261004-01/runner-timeout/internal--test_runner--runner.js:539) 必须先收到stdout data才parse。

spec [79](/workspace/yunshan-work/ROOT15-full-suite-import-review-20261004-01/runner-timeout/internal--test_runner--reporter--spec.js:79) 打印pass/fail/diagnostic/stdout等；start只入stack，enqueue/dequeue/complete没有可见文字。中断 [harness:295](/workspace/yunshan-work/ROOT15-full-suite-import-review-20261004-01/runner-timeout/internal--test_runner--harness.js:295) 查父FileTest树，只能列extensions文件。因此“同步工作让child reporter管道暂未推进或未flush”是静态允许解释；保存材料缺少serializer/通用stream完整实现和实际child进度，**不能确认本次正是flush，也不能认定第一个test没完成、整个文件尚未运行或卡generated。**

## 最小可验证的下一步（全部 NOT_RUN）

由父任务安排资源独占后，以 b5b冻结 source、原输入map和原Node/tsx环境运行；先核对sourceSHA/318输入，不在共享活跃树上执行，不加heap额度。外层每个scope的3600秒预算必须在开始前单独声明和落receipt，不改原full3600秒历史。原文件首选命令：

    node --import tsx --test --test-isolation=process --test-concurrency=1 tests/extensions.test.ts

该scope是完整35个顶层原测试及原subtests，不是完整117文件npm test。若需直接判定主要候选、以最少独立原callback定位，可各在新worker原样筛选：

    node --import tsx --test --test-isolation=process --test-concurrency=1 --test-name-pattern='^the generated city autonomously funds and completes research through actual trained residents and laboratories$' tests/extensions.test.ts

    node --import tsx --test --test-isolation=process --test-concurrency=1 --test-name-pattern='^the extension remains finite, bounded, recoverable and deterministic over multiple accelerated game weeks$' tests/extensions.test.ts

两条筛选命令仅选择现有原测试，未改seed、world、616/384人口、原2160/5040ticks下界、上限、focus、资本、needs、saved state或断言。runner会把不匹配的其余原测试报告为filtered/skipped，这必须如实计数；**选择子集的PASS不能代替35条文件PASS，更不能代替全套PASS。** 该文件没有顶层Sim，因此过滤未匹配callback可减少未选业务构造，仍会加载原module。规范argv与scope在 NEXT-ORIGINAL-TESTS-NOT-RUN.json。

每scope留原raw+SHA、开/结束/exit/signal/deadline、source before/after图、PID/startTicks/观察后代及清理；实际assert failure或OOM=FAIL，超时=TIMEOUT_PARTIAL。可收集外部RSS/CPU及Node事件dequeue/complete，但父事件仍可能因child消息未flush而滞后，不把缺少事件当作没执行。原完整文件如果完成，原各case duration可用于真实归因；如果独立候选完成而原文件不完成，只能提示文件内前序/累积或预算负担，须有实际对照才可称顺序污染。

## 父任务追加的审计driver静态核对（FACT；没有运行）

current与b5b scripts/economy-audit.ts SHA同为6b15e62718064d1da2d981bb65723e61fee486dec73435910b7cfef068ff4e28。[extension:98](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/scripts/economy-audit.ts:98) 直接读取sim.state.extension；[core:107](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/scripts/economy-audit.ts:107) 使用Reflect.get(sim,'runtime')，**两者不调用exportSave，不是每phase全量序列化**。[traffic:167](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/scripts/economy-audit.ts:167) 每tick遍历居民复制观察快照；[commerce:189](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/scripts/economy-audit.ts:189) 在公司评估窗口构造money Map并structuredClone wages；[finance:193](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/scripts/economy-audit.ts:193) 核对新研究job及实际账本；[feedback:229](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/scripts/economy-audit.ts:229) 扫公共ledger。以上是审计harness额外观察/断言开销，没有测得各项耗时。

该driver确有 initial-envelope exportSave（61）、terminal exportSave（337）、terminal双reader验证（364/375）及未来24×三Sim step（376–379，双比较共每tick4次exportSave）。它与本报告 extensions 原测试的每commerce save+parse是不同调用位置。driver [scope:346](/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source/scripts/economy-audit.ts:346) 明示speed8实际生成城、无renderer/default-speed性能声明；driver walltime和原 full suite walltime均不能当作render FPS。父任务正在执行的默认一天结果不属于本报告新运行，本报告保持NOT_RUN。

## 未完成与限制（NOT_RUN）

没有运行独立原extensions文件、generated原callback、two-week原callback、顺序对照、profile、heap dump或任何新测试；没有给原full生成PASS。主要阻塞是原raw没有child内部活动位置和耗时/内存样本，父任务另有sole Simulation默认一天运行，故本任务仅交只读证据及下一步规划。原none OOM、process TIMEOUT_PARTIAL的真实记录均保持。
