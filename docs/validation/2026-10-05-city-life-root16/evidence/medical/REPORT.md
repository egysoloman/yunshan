实际结果为 **一名玩家医疗闭环 PASS；原公共目标 6 人仍有 5 个名额未服务。** 原 ROOT15 actual03 的 240 帧 FAIL 原件保留。本组没有修改共享代码、世界数据或旧证据，没有 commit/push。

输入是原定制 civic world：`/workspace/yunshan-work/ROOT15-public-health-player-20261004-01/origins/world.json`，47 建筑、47 节点、36 边、11 个断开的道路分量、616 NPC，SHA `abce713388422385a3754fc8d760745526d95fdb4268546057e5a748d8df6ea1`。独占副本在 `inherited-originals/origins/world.json`，逐字节保持。起点是旧 actual03 真终档 `inherited-originals/actual03/artifacts/frontier.save.json`，SHA `74b488c8e3c39d762b90613f50c2cf97aa34bd89c54ef8027ebdef2f4cdeccce`；其真实位置/钱粮/需求/角色/钟与原 legacy policy 原样导入。当前 source322/80src 图 `4f1c39d4769b4172f9aed8477b666c480cb1b4be2d7a244d8144d7d1408c9927` 冻结且实际前后、最终共享源逐 SHA 一致。具体输入和旧原件绝对路径见 INPUT-MANIFEST、INPUTS-322。

操作使用受控 headless 原 PlayerController、真实 W/鼠标输入和原 F/useStairs 楼层入口。只在开始把已存原位置恢复进 Controller 一次，其后身体位置由原 Controller walkingPosition 发布。原 F 支撑/ACL shaft 实际上下各一次；没有新增 browser 会话，也没有完整连续走楼梯的证明。真实 W 总路程 1074.7406721930406 米。这个受限世界与干预链不代替默认城市或自主 NPC 医疗证据。

授权窗口在计划/driver 冻结之后运行：2026-10-05 00:21:16.643074—00:25:13.239785 UTC，236.596711 秒 / cap900，owned active[]。NEW 上限 512 正常 main 帧、原 delta≤1 秒、speed16、原内部 .25 accumulator，主内部 tick≤2048；实用 292 main、984 内部 tick、3936 游戏分钟。走路 fractional≤1、开店和礼物冷却 .25、诊所等候 1，未把原 1 秒 main 重标成四 main。driver SHA `f385fcf4ce95331878eadbb1dd525076e33a3fa064be36536ce82408276e78f4`；raw SHA `abb822e518877cf1fd99b246fe97d9bf571efac2302a36ee55ba152cea567555`。DRIVER-PLAN、DRIVER-FREEZE、ACTUAL01-STAGE-BINDING 和 actual01/receipt 绑定冻结与实际。

原 carry1 途中自食；远区商店正常 06:04 开门，原 purchase 购入有限 18 份，实付 276.0304831081276，即吃1/carry17。回原 home 后，业主11/55各4次、医生44五次，共13次原 gift；每次实地≤2m、同层支撑/ACL/障碍 guard，返回核验 food−1/hunger+20。四次间隔各三原 quartertick=12 游戏分钟，满足原10分钟冷却。clock13012两业主 h77.6、医生 h97.6、玩家 carry4。原 clinic15 休息三次各实付15，没有借款、租住、免费资源或目标 health/needs 写入。

业主实际现场现金支持的本日班计划与生产恢复。到成功 full clock13984 的 trace 分配为 health4.421864795686247（实付40）、education4.485773534705813（实付40）、运维15.192593663515428（实付131.07662035774305），合计24.10023199390749真材料；加原未来24步后生产/采购合计25.895293717549915，工坊剩0。SUMMARY 的 newMaterialsAllocated 是 main 事件范围，physicalAccounts 含已实际执行的未来24步，两者范围明列。最大现金残差4.190951585769653e-9、食品3.183231456205249e-12、材料4.440892098500626e-16，原断言全部保留。

患者与医生44在 clock13808→13828 五个内部tick各真实4分钟，共20；每tick具有本tick canonical 核心 credited工资前段、实际同站到场与患者交集。合法 dayIndex9/480 签班由155/221在 dayIndex8 clock12004现场预批；旧 day7 班没有被冒用。clock13828实际耗1材料、真实健康增益、唯一 `public-health:service-2:1` 20分钟消费源和唯一 `waste-1` 污染批次1。医生44在 tick3375/clock13980实际兑薪46.762879999999974。health spent40/received4.421864795686247/consumed1/served[player]；原 cap40/target6/required20 未改。

成功 full SHA `129bb28c031dbb957962e0f7e32b010420061b7124f3e141173b23337952e1e2`，主/full/partition 每一步续演24个原 .25 tick完全相同，44分块，after24 SHA `92d706cda7ef5ef42e50dee98a30dd8574e6b991fea505fd31bed6838688edda`。另零Sim把这两个已完成存档各落盘44文件并读回 assemble，字节 exact，见 PARTITION-DISK-READBACK 和 persisted-parts。污染品只产生并容纳，未消毒/转运/处置；原 hygiene-demand-1 已授权20但spent0，等待一整份真实清洁材料及医生10分钟，不能宣称卫生终端闭环。

剩余目标的零Sim核对使用 after24 clock14080/dayIndex9 18:40 真终档。全部616 NPC health<65恰3名，都在 clinic道路分量0；自然 chooseFacility 需h35/f25，实际公共患者另需h40/f35、health<95、冷却/年龄/现场/服务站/活动与医生分钟。

| NPC | health / hunger / fatigue | 当前状态 | 条件与剩余证据 |
| --- | --- | --- | --- |
| citizen-0 | 63.919271 / 96.4 / 76.2 | school attendingService | 通过自然低健康和实际需求门槛；未来进诊决策、身体路线与20分钟未观察 |
| citizen-418 | 64.416071 / 38.2 / 78.16 | 朝school移动 | 可获自然health offer，实际h40不满足；需真实有限食物与进诊 |
| citizen-495 | 64.249671 / 0 / 76.48 | school studying | 自然与实际hunger门槛都失败；需真实有限食物 |

因此“当前没有当地低健康合格候选”不成立，citizen0确实存在；也没有5名已观察到的自然患者。local56中19名满足health<95和患者needs/cooldown的静态前置，仍不代表现场患者或自主选择。纯原几何helper复核school首层到clinic service点0/495完整353米、418完整299.9415938179546米，floor0 ACL/道路/身体障碍均通过；不是未来实际行走证明。原分数的部分静态比较显示0医疗offer35.408854低于未完成教育service3的81.333333，418医疗38.339988低于教育66.245133；495 h0无公共health offer。三人存档decisionAt均尚未来且destination都是school。该比较不执行chooser或穷举extension所有机会。详 remaining-route-static，实际未来选择与到达保持 NOT_OBSERVED。

18:40已在原8—17营业窗外。医生44在home、carry0、h44.2，day9剩1.0075110027923415工作分钟，不足下一个20分钟；其 day10/480 实签存在，但现场和食品必须重新发生。其余7名当地医生全h0。若没有新的实际进食，距nextday08:00的800分钟线性饥饿投影使44的h仅4.2；这只是原.05/min纯计算，不是未来Sim结果。

剩5名需要5整料，已持3.421864795686247，缺1.578135204313753；原基础40已用完。实际已生成 `service-2-supplement-1` V2 cap14申请，未批准、signatures[]、spent0；不能从历史payday造署名。两名在任本区议员22/418当前h29.2/38.2且离hall，均不满足当前 paid V2来源。纯 JSON 原预算公式得到公共 available6954.232477667847；现金足够本snapshot的14+13追加上限，现场当前 canonical paid联审和有限材料仍缺。教育service3另有cap13未批申请，污染处置20已保留，原用途和审批顺序不变。

工坊有限材料stock0，业主55 h24.2/carry0、原day9班、没有day10计划；农场业主11亦h24.2/carry0、农场库存仅0.29309153357644635，不足一份NPC正常购食。local NPC另有4份私人carry，不能当成医生/议员/业主手中的资源。继续6人链须按原机制取得真实食品、到场与休息，恢复次日业主现金支持班/生产，产生实际当前paid本区V2批准和至少1.578135204313753新采购，再观察合资格NPC进诊及每人20分钟。REMAINING-CAPACITY-STATIC保全部医生/议员/患者/库存/预算精确表和所缺实际证据；本组未开新Sim来凑患者或材料。

最终 types05 PASS9.703418秒/cap90/source322稳定/active[]。types01缺候选目录node搜索链FAIL、后续修订前driver版本与未跑SHA均保存，没有重跑大型全npm suite/构建/GPU。旧240FAIL、旧HOST-only512quarter候选PAUSED_NOT_RUN保持。REPORT只证明上述有限干预单玩家链、真污染源和原存档续演，不宣称默认229自主供粮、自然NPC医疗、全6目标、完整连续楼梯、长期财政稳态或Mac性能。

可核查文件：CLOSURE-RECEIPT、SUMMARY、INPUT-MANIFEST、STATIC-DIAGNOSTIC、DRIVER-PLAN、actual01/artifacts/PASS-summary与trace-care/trace-wages、REMAINING-CAPACITY-STATIC、remaining-route-static、PARTITION-DISK-READBACK、ALL-FILES-SHA256。运行窗口已释放；后续仅零Sim诊断与文件封存。
