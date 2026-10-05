当前方案状态为 **CONDITIONAL_NOT_RUN**，本组按 root 最新统筹指令封存。原 `actual03` 的 240 帧医疗证明仍为真实 FAIL；其 terminal4 原件 SHA 为 `74b488c8e3c39d762b90613f50c2cf97aa34bd89c54ef8027ebdef2f4cdeccce`。本方案只读原档、原命令及零 Sim 的 Controller 路径，不承诺未来有粮、有工班或能完成治疗。`source` 的318项输入保持 graph `5a519d7ad1a6dc02d4179830862d5f8859e4cb3c42d55deac19482acb9577f43`；未切入 root 后续 helper。

合法命令确可有限赠粮：每次成功 `gift` 消耗玩家库存一份，目标饱食度在命令返回时增加20（上限100），同一 NPC 的原 cooldown 为10游戏分钟。原 `.25` 帧 / speed16 每 tick4分钟，至少等待3个真实 tick，即12分钟。两位饱食度0的经营者各赠两次，中间正常衰减后仅39.4，未达到现场 review 的40门槛；各三次、两段12分钟间隔示例为58.8，须仍以即时实际值为准。

命令原空间守卫只检查真实3D距离≤24，并无 gift 专属同楼层、ACL、墙体或楼板支撑守卫。证明驱动须额外要求：从原档准确恢复位置后真实 W/鼠标步行入门、原合法楼梯触发、即时同楼层、原 ACL允许、身体距离≤2米。不能把驱动主动满足的条件称为命令保证。原 home0 未标 floorPlanProfile；旅人原 ACL 允许0/1层，证据只能称 legacy 占用范围和原楼梯轨迹。原生 F 楼梯在真实 shaft 处按产品命令离散切换高度，不能写成 W 连续爬楼。

原 gift 不发 `food-consumed` / `stored-meal`。`relationship-change` 发生在 food-- 之后、NPC hunger+20 之前；不能在该回调把旧饱食度误认为赠粮后值，也不能假造粮食消费 event。每次应在命令返回后保存玩家/商店/目标库存、现金、needs、位置、楼层、原 cooldown 时钟和命令结果，另列 `giftsApplied` 的有限库存差额。粮食来源、购买即时消费、自食和赠出分别核对。

真实生产与医生前置须逐项成立：

| 对象 | 原 terminal 事实 | 尚须真实发生 |
| --- | --- | --- |
| farm owner citizen-11 | home0一层 `(-2,6.6,1.2)`，hunger0、fatigue100；shop.cash1333.172111；旧班day5、农场库存0.6963545 | 自主走到原农场，在 `[6,17)`、原合法 needs/health 下审定当前日现金支持的工班，随后实际劳动、production、工资 |
| workshop owner/worker citizen-55 | 同一真实 home0一层身体，hunger0、fatigue100；shop.cash367.297566；旧班day4、物料库存0 | 自主原路到场、当前日 onsite review、真实分钟/产料；不得把 farm11 的 review 当成 workshop55 的劳动或授权 |
| 原8名 clinic 医生 | 7人hunger0、1人25；现保存的唯有 day7 真实公共班各480分钟/worked0 | 即时本人身体可达、合法赠粮、真实当前日已批准 paid core 班、实际到诊所并工作；旧 day7 不能复用到 day8/9 |
| patient player | cash416.028214、food1、health76.687740、hunger91.52、fatigue69.496、诊所实际身体 | 全程原自食/休息 cooldown、有限钱包；到治疗时仍满足原 needs/health 条件 |

当前本区市场0库存0，farm0不足一份且夜间闭门；现在不能购买6份或9份赠粮。远区 market1 原 snapshot 库存27、closed、零售价16.4668398964；这些只证明原档可供判断的库存和估价，不能预留或承诺到达时的价格/库存。未来购买须在原实际柜台用原 `purchase`：先读即时开放、生命周期、可用整数份数、原结算及钱包，数量≤30，现金不足或库存不足则保真实 FAIL。购买原动作会立即吃一份，只向携带库存添加 `quantity-1`，不能漏记。

零 Sim 原 Controller 路径已完整测过，结果在 `GIFT-ROUTE-PREPARED.json`、`gift-route-prep01/receipt.json`：从实际诊所到远区市场512米，远区市场至真实home0楼梯319.784968米，合法F上楼后至两位原owner身体4.585368米，再原F下楼返回诊所233.784968米。合计1074.740672米、237个 max1秒 motor帧、223.904307秒实际 W 输入。原 speed16 投影3582.468907游戏分钟，等效至少896个 `.25` main帧；这些都是**只读几何/输入证明**，没有执行Sim、购粮、赠粮、生产或治疗。

从原23:28直接走到 remote market1 已预计 day8 03:54，仍夜间闭门；必须正常等待营业，不能改时钟。等营业后回home可能已夜间，应保自主位置/活动变化；若本人早已走开，只能跟真实身体，不能用原保存坐标发命令。仅食物购买15份的原 snapshot 估价247.002598；扣原80租金和两次诊所15休息后仍有59.025616，但不是未来 quote 保证。租住不属于此home原ACL必需条件，却可用原80实际付款取得home rest（38恢复、原20分钟冷却）；若不租，须选择真实诊所/亭子等原付费休憩并保实际费用。

建议实际顺序为：从真正terminal续读 → 保患者真实食物/体力 → 真实W远区市场，正常等待开放，按即时合法价格/库存购买 → 真实W到home，经原门/shaft F到相同合法楼层 → 在真实身体附近、按原冷却最多三次/人赠给farm11/workshop55和**即时具备有效原付薪资格**的一个医生 → 自主现场review/实际生产及原公共paid core审批均发生后，患者原W回诊所、原休息/自食，等真实有限采购与 doctor20 / patient20 / one material → 实际效果/历史/卫生batch，成功后才full/partition+24 ticks。

新日公共授权是独立潜在瓶颈：终档 standingUntilDay=7，远路已经到day8及以后。须观察原双委员现场公共review是否实际产生该日医生 funded assignment；赠粮只增加合法饱食度，不产生资格、岗位、工资授权、委员到场或投票。若未获当前日授权，保该真实前置 FAIL；不能因喂饱医生而宣称 paid provider。

本生活往返不可能放入已准备的 **NEW HOST-only512×.25** scope，仅走路已超其2048分钟。root 已暂停没有当前门误阻针对性的 HOST-only 重复运行；该候选原件和 type PASS 只封存，未执行。若以后正式设计生活支援，须另立 NEW continuation、单独冻结driver/source/stagebinding及正常帧界限；例如先前评估的512个≤1秒普通main帧只是未采纳的范围提案，未生成或运行业务driver，不修改原240/已有512范围，也不许诺在界内完成。

NPC road 图不连与玩家身体能过地形是两个事实：原world11个 road component互不相连，原 `chooseFacility` 的 `add()` 只加入 finite `walkingTree` 候选，远区库存即便为正也不会成为本区NPC的可达粮店；本次玩家原Controller零Sim W已实际跨区走过身体地形。后续应在 root 新默认日供需审计之后正式设计可验证的NPC terrain walking/城市诊断，或另立合法真实身体搬运有限补给scope，不能手改道路图、初始needs/库存，不能把此次玩家motor证明冒充NPC已经寻粮。

医疗仍只考察 **1名真实玩家 patient**，原公共健康订单目标6、原40及后续真实预算/耗材/职责约束保持不变。1人成功也不能报成6人公共医疗闭环、自然NPC医疗、自然终城或长期稳态。
