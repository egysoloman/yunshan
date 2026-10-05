# ROOT12 启用与签署版本复审（只读 PLAN）

本文件替代已封存 ROOT12 合同中「首次合法登记才启用规则」的部分，其余原角色/雇主/现金/现场投票边界保留。旧合同、ROOT11 九个 scope 与原件 ZIP 未改。参照 root 集成候选 `/workspace/yunshan-work/ROOT11-integration-20261004-01/source`：264 输入 / 60 src，全部当前 SHA 与 PREPARED-INPUTS 一致；九个所读文件精确原件与 SOURCE-REFERENCE.json 留存。本复审没有生产修改或新模拟、测试、构建、GPU。

## 一条明确的启用合同

**产品新建城市入口按版本选择 civic-local-v1；旧无标记存档永远沿旧规则停用，只有受信任 host 的显式升级能改变它。首次登记只登记业务，不启用规则。**

为同时保留旧无参 core 调用及 old18 cold 来源，拟使 `new Simulation(world)` 保持兼容入口的原规则；新增唯一产品 factory `createProductCity(world)`，内部明确传入 `rulesetId:'civic-local-v1'`。产品 `main.ts:33` 与 **headless 新产品入口**都调用这个 factory，二者才是新版产品的新默认。不要根据 current-v6 地图、构建日期、居民资格或 constructor 的闭包来猜规则。这个可选初始化参数和创建 factory 不改 SimulationAPI 或 MZ 空间接口；现有适配器未选择新版时仍属兼容入口。未来文本/2D 宿主若新建新版城市，也应调用同一 factory。

未来 headless audit 必须在 argv/receipt 明示请求的 ruleSet，并记录实际 `effectiveRuleSet`、envelope/marker/module 版本以及 new-city、restored-save 或 host-upgrade 来源。通过无参兼容入口跑完测试不能称「新版默认城市验证」；factory 新建后若载入旧档，实际规则又变为旧停用，audit 必须如实标记。请求新规则而实际未启用应早拒或记 NOT_VERIFIED，不能沿用新版标题。

新默认在创建时就保存**空的启用合同**，不生成议员、证明、报名、选票、任期或工资：

- save envelope `version:3`，明确 `rulesetId:'civic-local-v1'`；`motionVersion:1|2` 独立声明原移动合同，新默认为 2。
- `state.civicStaffing.version=1`，包含 `enablement:{id,ruleVersion:1,origin:'new-city',enabledAt,enabledTick}` 及空的有限业务历史。
- `runtime.civicStaffingVersion=1`，`persistedModules` 含 civicStaffing，body/marker/manifest 与 envelope 完整配对。
- `saveVersion` 只在有效启用合同存在时返回 3；停用旧运行仍按原 native marker 返回原 1/2。升级 v1 的 civic-v3 仍保持 motionVersion=1，不附 native stair 字段；升级 v2 保持 motionVersion=2 和原 cursor，不能借政治升级改移动物理。

这明确撤销了之前「新默认 constructor 不加任何字段」的提案：新产品默认必须有版本和空启用体；兼容 constructor 与旧导入才不加新字段。新的 fresh 默认字节必然不同，应建立独立新版本基线，不能改旧 cold/旧18 fixture SHA 掩盖差异。

| 实际载入/创建来源 | 自然补选规则 | 首次业务 | 保存与后续 |
| --- | --- | --- | --- |
| 新产品城市明确选择 civic-local-v1 | 已启用，空历史 | 仍须合法真实条件 | 明示 v3 / body / marker / manifest |
| 无参兼容 core 新建 | 旧规则停用 | 不产生新程序 | 原 1/2 与旧 cold 语义 |
| 导入旧 v1/v2，完全无新标记 | 停用 | 合法居民以后出现也不能启用 | 不写空 body/marker/notice，不耗新 RNG；原即时与每一未来24 tick exact |
| 完整已启用 v3 存档 | 恢复档中规则 | 沿其有限历史继续 | 严格验证后恢复，不是再次升级 |
| 旧档经受信任 host 显式升级 | 从当前 cutover 才启用 | 从零新历史开始 | v3 保原移动合同与所有旧权利 |
| body/marker/manifest/envelope 半套或版本不支持 | 拒读 | 无动作 | 原 live state/runtime 不变 |

现有 import 在 `simulation.ts:2335–2354` 验证格式、模块配对，`2559–2575` 验证完成后整体替换 state/runtime。新规则判定必须读取**实际当前 runtime 与 state 的已验证合同**；constructor 新默认选项不能在旧档 load 后泄漏成规则启用。导入旧1/2时还须清空或使失效所有 constructor/host 的新规则模式缓存、待启用标志、临时 source/proof/vote 池和迁移 capability 的旧 SHA 绑定；不得在下一 phase 又由闭包或宿主默认补回。`effectiveRuleSet` 只从实际已载入配对合同推导，缓存须以 state/runtime 身份失效。失败导入则保原 live state/runtime/规则状态；新 load hook 不作扣钱/发事件等不可回滚副作用。所有自然 offers、登记、phase hooks、查询和 onLoad 遇旧无 marker 都立即停用，不补缺、不写 dormant 空字段、不发新通知、不改 clock/RNG。模块内 lazy 创建业务记录只允许在已启用规则中发生。

旧读者目前仅接受 envelope 1/2（2333）且模块清单未知键拒绝（2348–2349）；新 v3 明确拒绝比仅加会被忽略的 runtime 字段可靠。新读者须同时保留原 1/2 reader 分支与键序。PERSISTED_MODULES 是结构配对，不是升级权限或签名认证。

## 受信任显式升级：一次原子 cutover

拟新增独立 host migration 入口，普通居民 command、emitEvent、首次登记、import fallback、validator 和 onLoad 均不能调用。宿主在明确选择升级后，把当前已验证的旧运行及期望原件 SHA 交给迁移函数；迁移函数的可调用 capability 不从存档 JSON 的 `trusted:true` 或规则 body 获取，也不经通用游戏命令传入。

迁移顺序固定为：核当前运行仍是无新标记的原 1/2、SHA/时钟匹配且支持规则 → 在候选副本上加入 v3 启用合同及空历史 → 完整旧状态、新配对、新规则和所有交叉引用验证 → 一次提交。失败不改旧运行、钱、路、岗位、权限或 RNG；提交不推进时钟。升级回执记录当前原件 SHA、原格式/移动版本、enablement ID、enabledAt/tick 与明确 host-upgrade 来源；它不是旧玩家任命、旧学历或过去任期来源。

升级只保留当前旧记录，不添补旧历史。原 wageAccrual、attendance、角色、工资债、预算、原付款及 cursor 保留，不能把启用前的既有 60 分钟工资直接变新任职证明。新证明只累计 cutover 后 canonical 原岗位实薪区间，跨 cutover 的当前窗口只取后段；新选票、登记费与任期同样不得早于启用时间。原登记费120+生活储备100、两日 poll、14日 term、最多两席仍是拟新增游戏规则，未制造现任身份。

导入完整 v3 是恢复一个**明确声明新版规则的档**；不会把原 1/2 解释成新版。JSON marker 与来源 SHA 都是可验证结构/溯源信息，本身不能证明外部文件是谁授权生成的；受信任升级来自宿主调用路径。此合同不声称对用户编辑的任意 JSON 提供密码学真实性。

## 独立自然预算签署，保持 publicEmployment v2 不变

集成源 `public-employment.ts:144` 严格要求 v2 工资转岗签名角色等于该 employment revision 的历史**主职业**。自然 term 是 council 副身份，居民仍是原 official；把 citizenIdentity 整体改为 council 会造假职业并破坏原签署。**该 v2 reader、baseRoles、jobs、transfers 和 appointedBy:'player' 回执均保持原样。**

所选窄承载是独立的 **预算签署 version 2**，仅用于新版规则中的新预算/政治权限记录，和 PublicEmployment.version=2 是不同合同。所有启用后新预算采用这个明确类型；升级前已存在的预算保留原结构与原 reader，不重写为新来源。

拟新预算 signature 分开两个事实：

- `profession:{baseRole,workId,employmentRevision?}` 保存真实主职业/雇主来源；官员仍记 official。
- `authority:{kind:'local-council-term',ruleVersion:1,enablementId,electionId,termId,proofId}` 保存副身份的真实授权链；或明确的原主职业/玩家实际当选市长 authority 分支。
- `signedAt`、真实 floor/position、具名实际实薪工作来源/区间保存现场履职事实。权限角色可以是 council，但它不覆盖 profession.baseRole；有任期但无真实在岗付薪窗口仍拒绝。

core 根据已验证 term 自己生成 authority proof，调用方只能提供待审事项与 signer IDs，不能自报 council。term 必须属于该 actor/office/source，`startsAt ≤ signedAt < endsAt` 且早于真实 endedAt；签署时有法定人数、有限现金和原受保护债务。读取历史预算按**签署当时**的 term 判定，不能因现在死亡/期满抹掉过去合法授权。term 失效、原雇主改变或不再满足原任职约束时，当前新权限立即拒绝。

`simulation.ts:593–613` 的 core 预算签署、`supplemental-budget.ts:69,78–85` 的筛选/请求须接这条受限自然来源路径；`supplemental-budget.ts:106–113` 的服务追加与 core 预算交叉验证须严格相等地保存 signatureVersion/authority proof。治理 seats/政策签署若纳入同批，也声明新的来源版本，不能给原 governance.version=1 精确结构偷偷添键。

原工资审核 `reviewPublicTransferContracts` 即使遇到有自然副身份的官员，仍按其主职业 official 作为原 v2 合法签署人，保留原 funded shift、工资和 role-at-revision 判据。其权力原本来自任职官员，不需要借自然副身份。自然当选者不迁 workId、不产生 publicEmployment transfer、不获第二份工资；原 player appoint100→guild 完全不代调。

防止新自然签名退回旧分支：新启用之后生成的预算必须有 signatureVersion=2，缺删/未知版本/来源不全均拒读；不存在「v2失败就试旧role字符串」fallback。显式升级时可记录**原件已有预算的 ID/字节摘要引用**作为 cutover 的保留集合，让旧预算留在旧分支；不能填造旧任期/职位/现场证据。这是保存既有权利的边界引用，不是重建历史。新默认此集合为空。完整新预算和 term 必须成对保存到 global/partition，不能剥离 proof 后剩一个 council 字符串仍算有效。

## 基础楼层与期限

本合同继续保持基础 citizenIdentity 和原 official 楼层许可。council 副身份只服务明确政治/预算查询，不加入通用移动权限集合，不允许进入 council-only 实体楼层。期满时原 official 仍有自己的受限楼层/楼梯许可，原真实路线、cursor、速度保留并合法退出；死亡者沿原生命/遗产系统，不让遗体走路或复活。扩实体 council-only 权限仍需 root 单独批准真正的仅退出 token，当前不纳入。

## 实施前仍须 root 确定、之后必须真实验证

1. 确认 browser/headless 产品共同 `createProductCity(world)` 明确 civic-local-v1 / 兼容 core 无参入口分离，以及 v3 的 motionVersion 独立字段；未来 audit 记录请求与实际 ruleSet。新模块 type、factory、main.ts 与 save reader 的具体 patch 只在新实施组制作。
2. 确认 host 显式升级从哪个用户可选择入口发起；升级本身不经 generic command/event。当前只定调用信任边界，不制作 UI 或执行升级。
3. 确认 BudgetSignatureV2/治理签署版本的精确 shape、切换的旧预算保留引用和有限容量。第一批可仅让自然议员审批 service supplemental；原公职 v2 reader完全不改。不能宣称已解决所有自然签署消费者。
4. 在 root 批准窗口运行：旧1/2无marker即时/未来每tick24 exact（且以后合法登记条件仍停用）；新默认v3空历史；显式升级无钱/时间/身份增加；半标记与降级删除原子拒读；cutover前工资不算证明；真现场选票排他；新签署/期满/死亡与历史预算保存；old18原 SHA/原 FAIL 保留。
5. 当前以上全部 NOT_RUN；这份文档只关闭启用策略歧义，不声称自然补选、旧24新增回归或预算 v2 已实现通过。未来实施须以 root 当时精确集成源新建组；已封存 ROOT11/ROOT12 原件不再修改。
