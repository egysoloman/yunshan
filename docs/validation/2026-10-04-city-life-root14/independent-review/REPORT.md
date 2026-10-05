# ROOT14 civic history 独立只读审查

结论：在冻结候选图上未确认具体 runtime 缺陷；可以把结果描述为历史格式、真实来源迁移与短续跑的候选实现。现有证据不足以宣布 native4 产品全面验收、全城市系统/第一人称目标完成或完整长期经济闭环。此次审查没有运行任何 Simulation、factory、test、typecheck、build 或 GPU 命令。

审查对象为 `/workspace/yunshan-work/ROOT14-civic-history-implementation-20261004-01/candidate`。独立重算全部 304 个输入 SHA，与 `FINAL-INPUTS.json` 完全一致；生产 `src/` 输入 71 个。排序 path→SHA 的 UTF-8 JSON（分隔符 `,` / `:`）图摘要为 `b46bd775acae960939b3f9db63efd1f01b8d6f1948928c82b97966c59ef95b03`。父级指定 GPT-6.1 Sol/ultra 审查；此文件记录执行内容与证据，不以文字声明改变执行模型。

## 授权与保护范围

先完整阅读 `/workspace/yunshan/AGENTS.md`、`提示词.md` 和 `开发备忘录.md`；实际读取版本保存在本目录 `requirements-as-read/`，SHA 在 `READ-HASHES.json`。最新目标仍包括动态城市各系统、具名 NPC、第一人称/无人机/飞行探索和原存档持续运行；本短阶段不能代替这些目标。

所有写入只在本全新审查目录。未修改 candidate、共享仓库、ROOT13/current295、任何 CLOSED 组；未使用 Git、Library、网络、测试或构建工具。只使用文本查阅、静态前后差异、文件 SHA、JSON/gzip 数据读取。子审查委派尝试因并发线程限制未启动，本报告由单个独立审查者完成。archive owner 已协调冻结图和运行边界。

## 当前图的运行证据归属

以下是对 owner 已有 raw/receipt/source-as-run 的只读复核，不是本审查新运行的 PASS。对四个当前图 scope 和原失败/旧 codec scope，独立重算输入图、before/after、source-as-run 全文件 SHA 与 raw SHA，均相符。

| scope | 归属图 | 可支持的结论 |
|---|---|---|
| migration02 | 当前 304 / `b46bd…` | raw 5/5 PASS：实际 v3 app64 迁移；旧 native3 24 tick；v4 full/partition/模拟 leased session 即时与未来24逐字；语义/格式拒绝原子性；分区缺页/孤页/重复页拒绝。cap300 秒。 |
| paid-source02 | 当前 304 / `b46bd…` | raw 2/2 PASS：实际捕获工资签名的冷选举/凭证引用；声明死亡/雇主变化输入，真实一 tick 结束权力，历史任期冷页回读及 full/partition24逐字。cap120 秒。 |
| typecheck07 | 当前 304 / `b46bd…` | exit0，raw空；当前图类型检查证据。cap120 秒。 |
| legacy-ruleset01 | 当前 304 / `b46bd…` | **TIMED_OUT_PARTIAL**，前7项完成 PASS，第8 actual legacy1 升级/24 tick 未完成，第9默认世界/源 bridge未到。TERM后5秒KILL、exit-9；不得写成9/9或整套PASS。 |
| codec01 | 旧 302 / `ab60ee…` | 4/4 PASS，codec 文件 SHA 与当前相同；只能称同文件旧图证据，不能借此称当前完整图 codec 重跑 PASS。 |
| migration01、typecheck03/04/05/06 | 各自旧图 | 保留历史证据；未借用作当前图整套运行结果。 |
| paid-source01、typecheck01/02 | 各自原 FAIL 图 | 原始失败仍有效保存，见下文；没有重命名为PASS。 |

当前 migration02 raw SHA 为 `b60dfc74036e26bdc1f0daf42bbc61897c692d0c5c30921b05edcdd1689aef13`；paid-source02 为 `7117bbce8a0bb0d60d82ce09095d3a82ee10a3daafcdcd256d11a06f8177233a`；legacy partial 为 `bb28485d971894b0e6e4cd7f912eca0dfe7029471bb34df05b7677aeb0ce7ca6`。完整复核见 `EVIDENCE-CHECKS.json`。

## native4 与显式升级

`src/simulation/city-ruleset.ts:18` 的 envelope 验证将 save4、civicStaffing2、civicHistory1、historyPolicy、配对 historyId/enablementId 和各 runtime manifest 一起检查；旧1/2禁止产品/历史声明，3禁止历史声明。motion1/2独立于格式4，不依赖保存里的任意布局标签来改世界。

`src/product-city.ts:12` 的原 `createProductCity` 仍为3。新增 `createArchivedProductCity` 通过明确 options 开启4；兼容构造器没有隐式历史开启。`src/simulation.ts:2378` 完整导入直接采用保存的 state/runtime，旧3进入 archive factory 的当前图运行证明关闭历史并匹配原24 oracle；archive factory专门导入旧1/2尚未运行。

`src/host/upgrade-civic-history-format.ts:8` 只接受当前3和64位小写SHA；先用 `validateSave` 完整验证快照，再异步SHA，随后检查SHA与当前导出逐字均未变化。所有修改、来源计数、封页在 clone 上完成，最终走生产 import。错误SHA、并发暂停、重复升级与普通 emitEvent 无升级权限，已有 migration02 负例支持。旧1/2先升级市政规则的 host capability 位于 `src/host/upgrade-city-ruleset.ts:8`，此轮不借未完成的 legacy1 分项证明完整兼容。

## 原记录、费用、投票与任期

`src/simulation/civic-history.ts:222` 的解码不以合计替代原记录：完整有序片段、原记录SHA/UTF-8字节、页链、索引位置、描述符和总字节均校验；无孤立/重排片段。热/冷 resolver 在 `:475` 合并记录并拒绝同ID重复。`src/simulation/civic-staffing.ts:507` 后的业务验证继续逐笔检查工资窗口、真实地点、取消申请的分钟、付款钱包/国库各120、两个付薪官员见证、人口冻结 census、撤回/选票与一人一票、计票和14天任期；冷页正确重新封 SHA 不会绕过这些检查。

历史来源验证 `civic-staffing.ts:153` 使用合并后的选举/证明/任期；即时权力查询 `:144` 仅使用热活任期并再次检查当前生命/职位。封存只选择终结的业务记录（`:736`），所以活申请、开放投票和未结束任期仍留热层。原已获任期即使选举/证明已冷存，也有完整引用链。

独立 JSON 数据读取逐片拼接所有实际保存冷记录，重算每条原始 `jsonPart` 合并文本的SHA和UTF-8字节。迁移后128/64/19/13全记录值与迁移前全部逐项一致；冷58/58/13/0分7页。原 app64 snapshot SHA `3640274b3e2234b793925a574f825615a89d9c168539d10960510f39f1e1c2c3`，tick1467/clock6348，19已付+45未付取消，费用2280、表格63分钟、投票1064分钟。独立静态数据相等不是重新执行生产 reader 的证明；运行逐字验证来自 migration02。

死亡/雇主后24保存为 tick1492/clock6448，完整176/87/20/17、冷62/62/17/1，费用2400。新增 application86/citizen352 在6428/tick1487有实际120的钱包减少与国库增加及两名实时付薪见证（418/88）；不能误报为原费用被改写或迁移制造收入。迁移24分项是另一个续跑：1491/6444、完整183/83/19/17、费用仍2280。

## 工资与死亡来源界限

两份实际捕获签名来源原始SHA `55aff072ee15acc3afca29a24d906f6d1fed64554554ce423a30fb2a02ff5535`，签名 actor22/418、6348/tick1467、付薪窗口6344..6348，各4分钟。core `src/simulation.ts:319` 从真实 attendance accrual 产生冻结且登记在 canonical WeakSet 的 wage-earned 对象；`budget-authority.ts:108` 观察该实际对象和当前任期/职位/功能点，不接受普通事件复制。持久历史签名校验在 `:169` 检查完整冷任期链、过去职位、地点与正付薪窗口，不要求历史签名者今天仍活着或仍同职位。

paid-source01 原 FAIL 为测试直接设置 `alive=false` 却保留非0健康，生产 reader 在 `extensions.ts:652` 正确拒绝 `dead actor health`。最终测试仅将 health设0，保留alive=true，保存合法前驱并调用生产validateSave；既有 people死亡分支 `extensions.ts:275` 在真实tick令alive=false/health0/state dead。term1在6352/tick1468结束，签名仍是6352之前6348的旧工资，不是死亡后新赚工资。声明健康/雇主变化输入不能称为发现了自主自然死亡/调职事件。typecheck01/02 的原 unknown/iteration窄化失败也保留；首个 recovered-after-run snapshot不能称预运行快照。

原捕获文件和最终前驱/续跑中 runtime funded V2预算为0、culture supplemental不存在。`ACTUAL_SOURCE_PAIR_NOT_FUNDED_BUDGET` 仍成立：冷签名来源可验证，不等于已经证明真实获拨款的 runtime/culture两份预算、追加采购和服务消费正闭环。

## 容量拒绝与提交原子性

页256KiB，完整历史16MiB，最多256页/每记录256片/总10万记录（`civic-history.ts:5`）。append在复制历史上完成，`settleBytes`把索引/元数据一并计算；拆片不劈代理对。`save-resource.ts:4` 保持非历史8,000,000字符上限，并另外检查4的历史真实UTF-8上限。容量是有限的；每次append至少新封一页（`:435`），256页可先于16MiB耗尽。此为明确的存储合同限制，不能称无限长期历史或只剩16MiB时才拒绝。

`civic-staffing.ts:746` 在替代热数组前准备两份候选；`simulation.ts:230` 最后feedback消费者先验证 supplemental状态、runtime/culture交叉引用及budget authority，成功后才同时替换 civic/history。拒绝保留原热/冷来源并一次通知 `civic-history-storage`；时钟与其他系统已经走完本tick，原子保证是封存事务，不能说整个tick回滚。容量耗尽后仍保持原热caps，后续入场可能停在上限。

full reader全部字段/模块/预算/运动校验在state/runtime替换之前完成（`simulation.ts:2622`），validateOnly在提交前返回。codec01超额transportOnly是存储用合成记录、不合法业务记录，只证明旧图纯codec的原子拒绝；没有现实Simulation把容量填满并验证通知与后续保存分支。

## full / partition / session

`partition.ts:106` 全局声明明确historyId与页part集合，页单独存稳定ID；`:119` 组装拒绝重复ID、缺页、额外历史页、混代historyId/链、页描述不符；最终重复解码和资源验证。传输只做结构/历史完整性验证，业务状态仍需完整生产 reader，不能把成功assemble说成业务通过。

`session.ts:77` 由原有generation/lease driver读取完整声明分区，materialize只交付整代；缓存不把部分状态放进Simulation。migration02使用模拟driver与maxCachedChunks2/512KiB演示全物化逐字与未来24。没有真实IndexedDB leases/上一代恢复新验证。`bridge.ts:167` 源码提高4的容器容量并保留旧版本10M边界，最终经selectSavedWorld及生产reader；本轮未运行4 source bridge、未生成browser bundle，因此不能把旧bundle视作已支持4。

## 缺陷和剩余验证

未建立满足“代码＋具体触发＋实际影响＋最小修复”的新增 runtime 缺陷；无修复source建议或补丁。存储有限/全物化、原独立request/budget上限未改变是实现与产品边界，不作为泛安全发现。

明确 **NOT_RUN / NOT_EXERCISED**：实际 funded V2两份预算→采购→服务；14天自然到期/续任；默认v6新4长跑；archive4 factory旧1/2导入专项；当前图旧1第8的24 tick及第9默认世界/源bridge；旧冻结3reader直接拒绝4；真实封存quota耗尽通知；4 source bridge/生成bundle/build；真实IndexedDB恢复；UI/浏览器/第一人称/GPU/macOS/性能；全城市与完整经济/游戏验收。已运行旧2/3短范围不能替代这些项目。

父级可继续只采用本候选的源/迁移短范围结论，决定独立验证顺序。任何将4作为产品默认的后续变更需以新的冻结图和它实际运行的证据另行记录。ROOT13/current295与既有默认3/v6保持原状态。

## 父级隔离集成图追加静态范围

父级随后指定只读补看 `/workspace/yunshan-work/ROOT14-integrated-history-default-20261004-01/assembly` 的3处差异。独立重算304/71冻结图为 `5603eaaf84575d2d59a2886b186096a6916b84c4924cd1840bd10631e4daf129`，与其 `FROZEN-INPUTS.json` 相同；`source-as-provider` 全304输入仍与原provider `b46bd…`完全一致；实际仅 `src/product-city.ts`、`src/main.ts`、`scripts/economy-audit.ts` 改变。

`product-city.ts:23` 新增 `createCurrentProductCity` 明确委托archive4，原 `createProductCity` 仍3。`main.ts:34` 新城调用current4；`:161` 已有保存仍完整导入，失败时禁止自动覆盖，导入保存的1/2/3自身合同不因构造factory隐式升级。`economy-audit.ts:53` 默认使用current4并强断言4/body2/history1/空新页/新城市来源，观察history页数、UTF-8 bytes和拷贝totals；未用观察器改业务状态。这三处静态差异未建立具体runtime缺陷。

此集成图主张“新产品默认4”仅针对独立assembly，不能倒写成原CLOSED provider或ROOT13/current295已改。新增图运行由父级另行负责；本审查不运行、不宣称 strictbuild/旧1专项/默认4长跑或上述NOT_RUN已通过，也不把provider的b46bd运行结果直接冒充5603eaaf的新图结果。
