# ROOT15 gift 身体接触与权限独立只读审查

结论：存在一个 P2 空间接触检查缺口。`Simulation.command` 对 gift 的空间检查只有双方三维距离不超过 24 米；上游 UI、main 和全部 17 个扩展 handler 没有补上同楼层、目标空间权限或双方之间实体墙检查。玩家移动遵守墙体和楼层权限，不能保证墙另一侧或上层居民与玩家能够实际交接食物。独立纯几何检查在仓库原保存建筑上确认了合法支持点可落入这个缺口，未执行 gift、构造 Simulation 或冒称自然患者消费完成。

本次仅读代码并保存新证据，不安装候选生产修复、不并入当前完整测试图。parent 串行完整 npm test 所用图仍为 `b5b126b81c81726c85e6c6d7ac1ff486c2ede464aa5deb2825ba405ff861eff3`；本任务不提供其 PASS、OOM 或结束状态。

## 具体因果路径

`src/main.ts:245–251` 的 nearbyCitizen 只要求非 statistical 与三维距离 `<8`。`src/ui.ts:1246` 的 gift 按钮只附带居民 id，要求步行可行动、敌意未严重、背包至少一份食物。`src/main.ts:254–259` 对 gift 只要求 walk 模式，然后直接进入 Simulation 的权威 command；它没有接触线或楼层证明。

`src/simulation.ts:2197–2210` 会拒绝死亡玩家、机舱中执行 gift；可选 command.position 的范围校验不验证现有两端身体。仅 work 使用现场功能点 gate。逐一静态核对全部 17 个实际 registerCommandHandler 后，其 handled 范围都排除 gift 并返回 null，详见 command-entry/AST-INVENTORY.json。

`src/simulation.ts:2291` 对目标存在及 `distance(player.position, citizen.position) <=24` 作检查；随后 gift 要求目标 alive（2292）、库存 food>=1（2308）、敌意等级<2（2323），并与 socialize/conflict 共享该 NPC 的 10 游戏分钟交流冷却（2324–2326）。满足这些条件后，2330 立即扣一份玩家食物、居民 hunger 增20（clamp）、关系好感增12／信任增8、记忆与交流时钟更新、玩家声望增0.5。相关 relation/remember 函数只处理关系反馈，没有空间拒绝。

因此缺口不是无中生有的生产食物：食物确实有限且扣账，活人、敌意、冷却等原规则确实存在。它允许本应受身体到场／墙体／楼层边界限制的食物与关系作用发生在距离球内，省去实际交接接触。权限、关系、冷却与扣物守恒全部必须保留。

`src/controller.ts:353–395` 的 walkFloorPlan 会检查实际墙体、楼梯目标层和当前 room/stairs 权限；`165–174` 是进门，`192–206` 是换层；legacy 墙/入口和权限在384–389及405–418。这些规则只约束玩家自己的移动。`Simulation` 的 `floorPlanPresence`（2115–2121）和 `isAtBuildingFunctionPoint`（2131–2134）同样没有在 gift 路径被调用。航空全局 guard 和 native NPC 路线校验不能代替两人的接触复核。

## 原保存建筑的纯几何证据

使用原文件 `tests/fixtures/civic-history/root13-four-day.world.json`（64700 bytes，SHA `78a9b469fb18e4f377151fd679045fdb25b9160d456f25ba8a0027b2b15a0bbe`）中的 `civic-0-hall` 原描述符，不改尺寸、楼层、门、权限或 body。只导入本任务源快照的 architecture-floor-plan/access 纯函数。没有导入 simulation/world 工厂、调用命令或手改任何 needs/inventory。

| 纯几何情形 | 真实支持与权限／实体 | 距离 | 原 UI／gift 距离拒绝 |
| --- | --- | --- | --- |
| 公共层玩家与行政层居民 | 玩家(72,.6,-18) room floor0；居民(72,4.4,-18) room floor1。traveler 可访问0、不可访问1；official 可访问1 | 3.8米 | `<8`／`<=24`均不拒绝 |
| 同层室内与院落之间的墙 | (119.3,.6,9) room floor0；(119.3,.6,10.6) courtyard floor0。原 solid panel 位于z=9.6…10、bottom0／top2.8；连续body segment被阻挡 | 1.6米 | `<8`／`<=24`均不拒绝 |

第二例说明只把距离改为2米并要求同floor仍不足：两端都是真支持，墙在两人之间。院落是合法室外支持，不能用“不是room”把几何证据偷换成无效身体。完整 descriptor、支持结果和 opaque panel 在 root-evidence/pure-geometry-results.json。

私有脚本 pure-gift-geometry.mjs 的原执行退出0／PASS、耗时约0.433秒，receipt 保存完整命令与原stdout。它检查纯几何及原距离谓词；没有调用 Simulation.command，不证明当前预算世界的任何实际居民自然来到这些位置、UI真的选中它或已成功赠礼。其余活人、食物、敌意、冷却条件只是源码上的独立前置，不能把这个结果写成实际患者供料或医疗履约。

## 最小生产接触规则建议（候选，未安装）

只在 gift 的2328行 relation()可能创建关系之前增加小型权威接触函数，并让 UI 复用其可行动结果。保留原共享社会分支另外六种命令的行为；这次不改 native/reference NPC 运动策略、服务供料、save codec、阶段顺序、身份映射或关系反馈。

1. 两端位置有限、真实存在且符合原生命状态；要求实际近身距离不超过2米。用已有 citizenIdentity 映射取得 NPC 的权限身份，不能直接把中文职业字符串强塞为玩家 Role。
2. 2米是已有family-education actor-pair规则的建议半径，原提示词没有gift硬编码2米。对有实际 BuildingBody 的位置复用 `floorPlanSupport` 和 Simulation 现有 nominal/±1 presence 查询，确认真实脚点支持与楼层；在同层合法接触位置交接。用 `canAccessFloor` 校验实际室内／stairs floor，楼梯 link 的目标层权限也须保留。预算诊断先让双方走原门/F楼梯，到同floor的真实落脚点后才馈赠，不能利用原24米球。
3. 除双方站立体积外，检查从玩家到居民之间的完整连续障碍段。可组合 `blocksFloorPlanReferenceMovement` 的连续高度实体检查及 `blocksSweptUprightCylinder` 的现有纯几何 primitive；这仅是接触线语义，不把当前 NPC referenceCollisionPolicy 从一个分支改为另一个。不要只测两端不碰墙，更不能只证明建筑内存在一条绕墙长路线。
4. 保留放置体素的现场阻挡。`homeRestPointBlockedByVoxels` 是站立终点规则，不证明两人之间的体素墙不存在；连续段需要按已采用的实际体素盒契约检查。不要把 blocksMarketCounter 的终点规则误当完整 segment 证明。
5. 明确门口、室外、楼梯与 bodyless 分支。真实 ground doorway 两侧的合法短距接触应按原门洞和完整清晰段决定，不能机械要求 same-building；courtyard/gallery 为室外支持，不必强制 room/stairs。不同楼梯 floor/link 边界须明确策略，预算诊断可先在同层 landing 接触。`getBuildingBody` 对 core-main/pavilion 返回 null，即使有profile；bodyless 的 blocksFloorPlan…返回false不能证明不存在墙。应抽取／复用 controller 已有 legacy footprint、wall/door 与权限契约作为纯接触 guard，不默许无body的24米赠礼，也不把这些正常场景一律拒绝。

`clinicalPair…`／`educationPairAtStation` 绑定诊所／学校、指定功能点和同station，不适合直接作为通用 gift guard；它们还不能证明两端之间完整线段没有障碍。完整body sweep是保守接触规则，可能限制跨矮家具交接；候选安装前应以游戏已有身体契约明确该边界，不新增凭空手臂／跨墙交接能力。

最必要后续回归：同层无遮挡合法赠食仍恰扣1、hunger最多增20并保留关系／身份／声望反馈；同层1.6米 opaque wall 拒绝且所有钱物/needs/关系/clock不变；上下3.8米及不可访问目标层拒绝；真实门洞外内合法接触、courtyard、stairs landing、legacy/core-main明确结果；两端之间新放体素墙拒绝；原航空/死亡/无食/严重敌意/10分钟冷却仍拒绝；原满档／partition即时导出与后续恢复一致。生产候选必须另冻结新图后运行必要原检查，不能借当前b5b完整suite结果宣称已验证。

## producer paths／SHA 与边界

root-evidence/producer-paths-shas.json 给出所有关键路径完整 SHA。主要权威源码 `src/simulation.ts` SHA `6fde8f6382c61ff37531d26e72ff7c25d5d4a728093e54ea326b6f6538f2bfa9`；`architecture-floor-plan.ts` SHA `9718a583a381e48e9c233ac6b2a621bddb060c2fafbcd8db3ff71240323462ac`；`access.ts` SHA `5dd84a1541c6247c9d492d91e9f9d5a620e553522fb3c13fe0af2f899c67ecfa`。本次保存全部78 src快照；独立读回全部318输入相对原final7e3e图只有parent已修改的package.json，所有生产源码及117 tests原样。parent的b5b冻结receipt另复制为证据，不把只读观测当实际运行回执。

AGENTS／提示词与先前完整读取相同。备忘录新增3600 bytes prefix已完整读取，434954 bytes完整当前文件SHA `79ccfedc29b98abf02f6877bd52a5c833175ae9c7a235dc4e2005c92e8c60016`，先前431354 bytes原文为逐字suffix；完整字节ledger和原文保存在root-evidence中。无相关本地skill。

本任务0 Simulation／0 world factory／0 step／0 gift command／0应用测试套件／0 GPU／0 build，只有一次纯几何脚本。未改shared/harness/CLOSED/Git、未读取环境值/凭据、未外发、未启动大模拟。旧三份sealed报告及index SHA读回不变；现有真实医疗1 patient未完成、其他域未完成状态均未改写。command-entry和contact-rules两个独立静态子审查及原件证据随本报告索引。候选生产接触规则仅供parent后续阶段决定，当前测试图保持原样。
