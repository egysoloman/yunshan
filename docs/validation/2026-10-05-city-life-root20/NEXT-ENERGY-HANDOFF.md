# ROOT21 能源接续：只读证据与下一窄阶段设计

本文件为新静态接续记录，不是实现或新验收。此轮只读原件、源码及日志；未修改共享仓库或任何旧私有文件，未运行模块/import/Simulation/step/validateSave/测试/类型检查/build/GPU/profile/network，未复制 src、node_modules、git、World/save。只写本 HANDOFF，≤15KB。

## 当前真实接续点

- 实际 HEAD：`dd1558d3f1ac1951d1b4a06b84f57d3c17fa25be`；`git status --short` 为空。父任务确认已推送 takeover-city-life、main unchanged；本代理没有联网复核远端。生产为 ROOT20 已安装的382输入图，备忘录记录图 SHA `f62b5b223b5974aed128453e0763a99ce5207e947afb7a48ebeaf85cc92a5003`。本轮未重新计算整图或构建。
- 首选真实钱粮验收继续入口：`/tmp/ROOT20-resident-rest-natural-20261005-01/prepared02/actual01/artifacts/TERMINAL.save.json`；本轮只读核得 **3,443,220B / SHA4610ab1059b52cfd4bbfa17badf209a7a33ab986735d83b8a5da8c8a9e5ddf6a**。tick1710/day2/hour17，即第3日17:00；616居民。原政策、需求、身体、钱、岗位与时间不改。
- 真实 World 原件：`/workspace/yunshan-work/ROOT16-food-integration-20261005-01/originals/WORLD-ORIGINAL.json`；本轮只读核得 **1,832,308B / SHA2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512**；612建筑、未声明 powerGrid。
- 4610中 `state.powerGrid` / `state.power` 均不存在；`state.energy=64.9715581302371` 是旧指标，不是电量库存。按真实 `Citizen.workId` 核得 core-energy-south 员工0，按真实 `Citizen.role==='工程师'` 核得工程师0。不能把 data院科研员或学校科学家移岗为工程师。
- 17:48的734恢复支有 whole/129物理parts、三支未来24逐步字节对照，但没有另做该48分钟钱粮audit。需要独立因果继续时优先4610，不把734与4610不同验收边界混写。

## 原17例已经实际通过：本轮独立只读核准

原执行目录 `/tmp/ROOT20-hydro-parameters-actual-20261005-01` 的 receipt/raw/inputs-before/inputs-after 已读。root真正执行时间 UTC **2026-10-05T11:41:09.306966→11:41:10.056166**，exit0、timedOut=false、activeDescendants=[]。raw中逐一17个✔名称与候选源17个test声明同序完全一致；summary tests17/pass17/fail0/cancelled0/skipped0/todo0，duration_ms513.914957。

本轮重算 raw SHA **1983fe29be6095203b2979378bddf2894d8261bc63918004ec2899430108f748**，与receipt相同。两个输入before/after字典相同；当前私有候选两文件 SHA 也相同：

- `src/simulation/power-hydro.ts`：`3bdda003a29d0250f8dbdcf76a792d7689d022d05ca2b3e626a36ad92ab514a0`
- `tests/power-hydro.test.ts`：`309108d14682f6b490510067e9bbfd9e0e778150b66b5c80e7b705f5a0f4b75f`

候选与完整patch仍在 `/tmp/ROOT20-hydro-parameters-candidate-20261005-01`；patch SHA **daccddb92a669f540dcdcacf86b13dd3bf6b91d34af174cfa0d43f09ba465bf9**。原CANDIDATE-HANDOFF里的NOT_RUN是当时真实历史，保持原字节；本新记录只补root随后实际17PASS事实。没有重跑测试。

这17例仅证明独立单机组常head有限双水库参数账、有限kWh与转水、只读offer、连续窗/历史严格重放、参数JSON恢复精确。**private / not installed / no network integration / no current-city generation**。不把参数PASS扩大为原612自然发电、线路施工、自然运维、完整save/parts、长期或Mac验收。

## 最大阻碍与必须先定的接口

1. **热路径与4096窗硬上限。** core `offerFiniteHydroKW` 和 `dispatchFiniteHydro` 每次均调用完整history replay；offer+commit至少两次 O(n)，`history:[...previous,window]` 同样 O(n)复制，长跑累计O(n²)。4096个窗口按原speed1每窗.25min仅17小时4分，speed8每窗2min约5.69日，最大4min也仅11.38日。现在PASS没有有效长跑或性能证明。不能简单删历史、放宽reader、缓存公开可变对象或清累计当优化；达到容量时也不能在time已推进后抛错留下半个tick。
2. **kWh与P还没有输配单位契约。** v1 P 明确抽象，storedPMinutes/maximumP/负荷P都不是既有kW。建议v2显式 `kind:'finite-hydro-network'` / `unit:'kW-kWh-v1'`，全部v2节点/线/负荷/source用KW，累计用KWh；不把旧P重新解释为kW，不给v1隐式单位或字段。首阶段v2只一台hydro、不带电池，避免没有已验证换算的混合源与充电。
3. **原时钟有1e-8分钟归一化。** `simulation.ts:923` time将now+nativeMinutes四舍五入到1e8；纯核心却要求at===previousAt+minutes精确相等。合法speed不只整数（原.25≤speed≤16，每tick minutes=.25*speed）。桥接必须以真实end clock及前账构造有效窗，并验证它恰由原nativeMinutes归一化而来；不能对错误时间放宽“近似相等”，不能改变旧全局time或v1计费。新v2记录实际首尾时间及原nativeMinutes，测试小数speed、跨日、恢复后首窗。
4. **可信资产/岗位都缺。** World291没声明水库、机组、输水管或馈线；给原World加grid会改变已绑定fingerprint，旧4610不能偷迁植。能源院员工0阻止自然维修工班正向；初始显式自动机组可单独做受控新图输配，不能据此称原616已经有合法运维。招聘、资格、愿意迁岗、保护既赚工资、真实预算/通勤/材料及工时另立因果阶段。

## 下一真正输配窄阶段 E1-B（PLANNED / NOT_IMPLEMENTED / NOT_RUN）

目标只覆盖一张**明确opt-in的受控他城参数图**：可信480起点、单hydro+独立双库、具名能源建筑及电网节点/有容量线缆、每栋负荷、null支路与真实交通边。通过原Simulation energy相位自然执行 offer→有容量最大流→accepted输出→实际用水→具名建筑/交通分表；闭线/孤岛/源耗尽时当地服务暂停。它是原引擎内真实输配接入，仍非改造原612城或全部能源完成。

文件接续清单：

| 文件 | 窄变更/核对点 |
|---|---|
| 新 `src/simulation/power-hydro.ts`、新 `tests/power-hydro.test.ts` | 导入上述冻结候选作纯oracle；保17已运行断言与原SHA，不把未改运行结果冒最新集成结果 |
| 新 `src/simulation/power-hydro-runtime.ts` | 增量转换与只读offer；私有本城/definition/state/tick/clock能力，创建和成功load后严格冷验→绑定；深冻结本模块账与分段历史，常数大小新窗口/有界页写入，拒generic/clone/foreign/stale。不得暴露注册函数。完整replay留冷reader/调试oracle，热路径不能调用现core公有replay APIs |
| 新 `src/simulation/power-grid-hydro.ts` | v2声明/资源/dispatch/reader；物理building/node/pipe两端与head引用；单源accepted仅取真实source arc剩余差。候选offer不是库存或授权；先准备全部源账+米表，全部守恒后整体提交，失败不扣一半水。无电池、无补水、无新费/材料注入 |
| `src/simulation/power-grid.ts` | 外层按v1/v2路由；保现v1定义/输出字段顺序/dispatch/reader/diagnostic/命令行为。selectors按版本取局部ratio，历史far-tier仅算真实同窗交集；install分支使原legacy平均源不能叠加新发电。status只在实际声明且已接入v2时报告该v2能力 |
| 可新增 `src/simulation/power-network-flow.ts` | 如需复用，将现private Flow逐字移动至无单位纯传输模块，原排序、arc插入/求解顺序不变，v1调用等价；不要同时重写v1算法。是否抽取由实现实际diff判断，不因方便另造一整套网算法 |
| `src/types.ts` | 审查现WorldDefinition/SimState导入的PowerGridDefinition/State判别联合；优先沿同一powerGrid模块，不新增不必要顶级hydro或persistedModules项 |
| `src/simulation.ts:49,272,892,923,2573,2799..2823` | 现powerGrid已在manifest、installer已存在、registerSaveValidator/onLoad均有接口；尽量不改大文件。必须解决容量满时**推进time前**无修改拒/停机，原while(.25tick)不在内部检查paused，不能靠energy里set paused来防后续多tick。已有onLoad在所有validator通过且state/runtime替换后才调用，失败回滚；runtime source绑定只在这个成功阶段，不在validateOnly或尚未结束read中授能力 |
| `src/persistence/world-layout.ts:49` / `src/host/world-generation.ts:155` | 前者已包含整个声明grid；保无网/v1旧fingerprint文本。后者拒不同几何冒同城重建；E1-B受控新图用可信World，不借旧policy升级往4610塞资产。面向玩家的新图registry/施工换代是随后独立项 |
| `src/persistence/partition.ts` | 第一窄阶段不必空间拆grid（未知扩展现在留global且可lossless）；必须真正whole+所有物理parts读回后未来全save/event exact。新增页若分part需显式manifest/顺序/全量丢件拒，不能只内存assemble或遗漏冷页 |
| 新 `tests/power-grid-hydro-fixture.ts` / 新 `tests/power-grid-hydro.test.ts` / 新 `tests/power-grid-hydro-integration.test.ts` / 新 `scripts/power-grid-hydro-actual.ts` | 控制图参数与天然主线分开；证offer/flow/water/business并真实sourceSHA/World/save/全部physicalparts。不得修改旧power、power-grid、clinical、player-labor测试以配合通过 |

热路径推荐先把**纯单窗算子**和**严格reader**分离；可信运行只用本模块私有来源能力的冻结前账，常数时间更新最新窗与累计账；保存仍保全历史。分段历史只是避免每窗复制全数组，不能删除记录。4096容量须先做原native推进前事务预检或显式受控窗口边界；若尚不能证明正确容量背压，E1-B只允许短受控验收，禁止部署为持续用户模式。长期checkpoint/cold页持久化可单独E1-C，必须全量恢复、失败原live/save不变、不能靠自报checksum认证凭空水/电或伪历史。

v2 reader最低要求：trusted定义全部引用、两端initial资源与head yield绑定；完整连续历史、当前tick/实际end clock、source offer/actual transfer、generation=water×yield；电源实际KWh=负荷实际KWh，逐node平衡、线/节点容量及断开0流、最大可达流和完整diagnostic；未来不借已过期meter。v1的 stored+consumed=initial、served=sum(consumed)、480起点连续base-demand下界和剩余库存保守供给下界**保持**；新v2独立时钟/历史约束，不能删除旧断言来兼容发电。

## 最小因果验收计划（所有新集成验收 NOT_RUN）

1. 原无网4610继续普通短窗，全save/event/reader对照旧382，原cash/food继续完整audit；未声明不得创建grid/hydro、水或员工。原v1/old paid boost原whole未来/fixture字节不变。
2. 新图同native阶段真实本地负荷拿到供电，源arc accepted对应水与kWh；断一条feed使唯一对应clinic/farm/车辆失供，其他支路正常；独立node/cable瓶颈，null馈线，zero-demand不得生成。
3. 两窗有限上游耗尽、满或关闭下游停发、offer反复无扣水、无储能藏电；真实付薪production仅同窗通电劳动，不借远层历史前窗。
4. 新状态与全原parts真实落盘/读回、三构造whole/clone/parts各未来24或明确窗全save+全event+十phase exact；漏物理part/换配置/改水/加电/删历史/stale meter/跳时/generic来源均拒，且live全字节不变。
5. 分段/增量runtime和保留的全replay oracle逐窗等价；单次冷replay与每tick增量分别测，来源清单稳定。合法非整数speed、跨日、same-phase重入、load新state、mutable/clone旧账反例与4096前后容量真实事务边界。增量等价不能冒实际提速，先有测量再报告。
6. 当前自然能源工班仍NOT_PROVEN。下一钱料运维E2须原canonical正额NPC/player工资、真实到场/ACL/单次共享paid分钟、预算cap40/合法追加、有限具名供应商与1材料/60min；维修恢复已损设备容量，不补水、电池或收第二份工资。

## 前序工资来源修补状态更正

旧 `/tmp/ROOT20-energy-design-20261005-01/DESIGN.md` 中“来源缺口尚未修/after未跑”是较早静态历史，原件不改。ROOT20现生产已修NPC `isCanonicalNpcWage` 与私有玩家实际writer marker、正额、本城state/tick/clock；根memo记final382 **74/74定向**（30新增+44原电力/网/劳动）与build通过，原NPC/player60分钟有限钱料工正向保留。受控generic before每项2min、after0的原失败/修复原件均保留。74不是全套测试PASS，也不是原612能源员工或当前自然发电证明。

可立即接续：先实现E1-B source→真实有限流→分表的私有窄patch及runtime/时钟/容量预检，不新建完整源码副本；根唯一gate按冻结输入串行做新与旧回归，再做whole/全部物理parts。当前禁止把17纯参数PASS或本静态HANDOFF写为E1-B已实现/验收。内部接续文件未上传，没有LibraryID。
