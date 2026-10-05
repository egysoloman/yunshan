# ROOT15 gift 接触修复候选：限定交付与实际验证

当前候选只修复显式玩家 gift 命令的接触准入。本任务仅编辑私有目录；root 在 22:06:57 确认已通过其原318逐SHA guard并集成同图五文件，正式新冻结为 ROOT15-gift-final-integration-20261004-01，集成与后续 build 由 root 另 scope负责。最新冻结源码 `pure03/source` 有 322 输入、80 src、119 个 tests 根目录模块，图 SHA256 `4f1c39d4769b4172f9aed8477b666c480cb1b4be2d7a244d8144d7d1408c9927`。最新同图 22/22 纯几何、tsc --noEmit 和 9/9 实际命令测试均 PASS；实际测试包括 14 个场景、两组完整档与 partition 档各 24 原速度 tick 逐步 exact。输入前后不变，三个 runner 回执 activeDescendants 均为空。没有运行本候选 build、全 npm、GPU、UI 或自然医疗。

## 来源、权限与五个文件

精确基线是 root b5b 图 `b5b126b81c81726c85e6c6d7ac1ff486c2ede464aa5deb2825ba405ff861eff3`，源 `/workspace/yunshan-work/ROOT15-suite-isolation-20261004-01/source`，318 输入/78 src。独立候选只在本私有目录编辑。318 原输入中只 `src/simulation.ts` 改动；没有改原 117 个测试、package runner、种子、存档 schema/policy、自动阶段顺序、公共资金来源、身份/关系反馈、其它六个 social commands 或旧 NPC/床体素合同。完整五文件如下，逐 SHA 与绝对 producer path 见 `PRODUCER-PATHS-SHA256.json`。

| 文件 | 状态 | 作用 |
|---|---|---|
| src/simulation.ts | 修改 | 导入纯准入 helper；仅 gift 在关系初始化和扣粮前调用 |
| src/simulation/gift-contact.ts | 新增 | 2m、真实全半径支撑/原 ACL、连续障碍与真实体素盒检查 |
| src/simulation/gift-contact-legacy.ts | 新增 | 原 bodyless 轴向 controller 墙/门、层权限和 ground door straddle |
| tests/gift-contact-geometry.test.ts | 新增 | 22 项 0Sim 真实保存几何与明确受控边界回归 |
| tests/gift-contact-command.test.ts | 新增 | 9 个 actual test，14 场景、原子拒绝及两组 full/partition24 |

`gift-contact-production.patch` 是仅三生产文件的最小补丁；`gift-contact-candidate.patch` 加入两测试文件。已把完整补丁应用到另一个私有 baseline 副本，重建 322 个文件逐 SHA 完全等于最新冻结图；见 `patch-roundtrip/receipt.json`。未进行 Git mutations。root 已在其安装前 guard 原318；本子任务封存时共享318旧图断言因 root 合法安装而不再成立，该检查失败原件保存于 evidence/final-guard01，不是生产测试失败。新的共享322图由 root guard，本子任务另作同图只读回读。

## 接触合同与保留行为

当前 gift 原先只有共同 social 分支 24m 和生死、库存、旧怨、冷却守卫，不能阻止近距离隔墙或楼层错位。新 helper 接受真实 canonical citizenIdentity 映射，不赋身份。双方须在 2m 内、有原支持平面和完整 .35m 脚盘及 1.72m 净空；native room/stairs 检查各自 actual floor 及原 link ACL。所有匹配建筑 ACL 都扫描，早出现的公共 courtyard 不能隐藏另一个重叠私有房间。两室内必须同 building/actual floor；地面真实门洞允许内外近身，沿原道路/terrain 支撑审计，庭院、室外、合法 landing/roof 和 bodyless/core 兼容原控制器纯合同。

障碍复用 `blocksFloorPlanReferenceMovement` 与 analytic `blocksSweptUprightCylinder`，包含完整线段、墙/玻璃/家具、legacy 原墙与市场 counter。native roof 圆盘边界检查避免 radius-zero 高度被误当成完整支撑，且 roof 高于 storey ceiling 时仍调用原 roof barrier；不同足点绕过真实 ridge 不可成立。未削墙、造门或修改 ACL 让测试成功。

真实 placed cube 在原 `main.ts:92` 为 .2m cube、`main.ts:409` 平移 y+.1，原 controller `391–392` 是 bottom p.y / top p.y+.2。候选 gift 的 stationary 两端与全段统一用此实际盒及原 .01m 足底允许值，移除了历史 homeRest p.y±.1 的 endpoint gate。旧 center 说明是历史 helper 解释，不能作为 renderer/controller 的物理权威；其它旧模块原样保留。

新失败理由通过既有 command result/UI 反馈；本候选没有修改 UI。合法 gift 保持原一份食物扣减、hunger+20（原 clamp）、affection12/trust8、记忆/encounter、reputation+.5 和本人 10 游戏分钟冷却；失败在 relation() 前返回。其它 social commands 的原 24m 行为保持，实际 socialize 3m 回归已验证。

## 最新实跑及前件

| 范围 | 结果 | 绑定与原始证据 |
|---|---|---|
| pure03/rules-run | 22 PASS / 0 FAIL，exit0；22:02:46.622→22:02:48.223 | 同图322 stable；raw SHA 7bc9a9f81e92070ac537778c23e05dbf4ecf9668b25f6257af4a774f38165fb4 |
| pure03/types-run | tsc --noEmit PASS，exit0；22:02:46.624→22:02:59.456 | 同图322 stable；空 raw SHA e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| actual-command01 | 9 PASS / 0 FAIL / 0 cancelled，exit0，未超时；22:03:26.654→22:03:56.723 | 同图322 stable；raw SHA 8704abb0984c8491d2d45cc2a7848d9c70554998e7cb1b4165c5e20e178c679d |

实际唯一命令测试文件使用原 runner `run-phase.py` SHA `c53609fd7a6b132768b01b66a4206ac0a018658734075d558a7299a0d7dfe9cd`，argv 为 node --import tsx --test --test-isolation=process --test-concurrency=1 tests/gift-contact-command.test.ts，cap300；纯与 types cap60。PID/startTicks 递归 ownership 跟踪，最终只有历史 Z 条目、没有活跃后代，未声称清除了未观测进程。

测试直接读取真实原 world fixture `tests/fixtures/civic-history/root13-four-day.world.json`（64700B，SHA 78a9b469fb18e4f377151fd679045fdb25b9160d456f25ba8a0027b2b15a0bbe），没有 world factory。每个 fresh fixture 在 test 体内构造真实 Simulation；使用原 traveler/600资金/32block、原活居民且 hunger≤80，未赋 needs、身份、生命、食物或钱包。受控位置赋值明确是测试前件，先证明原 full radius support/ACL/墙净空或真实 legacy door/getWalkHeight，不声称自然走到。食物唯一来源是真实 market purchase：实际扣 player price×份数、扣 shop 同份库存、吃一份，只携带付费余粮；legal gift 再扣一份。

新体素两个 exact 边界为受控、有限、合法原 schema saved-voxel geometry（完整 id/position/color），因为 head+.05/feet−.15 非 .2 build grid，没有伪造建造来源/租赁许可、扣或注入材料。测试只向原 empty voxels 加这一个已有几何前件，证明除 voxels 外整个 state/runtime 未变，并实际 export/import 精确开档接受。cube 真底高于 head .05 允许 gift；真顶高于 feet .05、原 center 顶却低于 feet 的 overlap 原子拒绝。成功/拒绝都保 voxels 原样。低 cube 只验证固定原 feet 的 stationary 接触阻挡；原 controller 移动可以先抬 feet 到 cube 顶，不把此测试说成自然移动必被拒。这些是接触验证，不是自然建造、消费者供料或医疗履约。

14 场景为原 7 场景（合法 gift、opaque1.6m、crossfloor3.8m、原零粮、原 cooldown、gift3m拒而socialize成功、原v3档）＋5 fresh legacy market ground door（双方 exact、±.1 两方向、±.3 两方向）＋2 fresh saved-voxel 边界。几何拒绝、零粮和 cooldown 拒绝都比较整个 state、runtime、relationship 和 exact export bytes，不能创建关系或加 food key。合法场景逐项比较完整 player/citizen、actorProfiles、关系/记忆、身份/资金/冷却。

两个24-tick组分别是合法馈赠后的新档与实际旧 `root13-four-day.save.json`（SHA 3640274b3e2234b793925a574f825615a89d9c168539d10960510f39f1e1c2c3，civic-local-v1）。原 writer→partition→assemble literal exact；新 full/partition 读者 import/export immediate exact；source、full、partition 各 step(.25)24次，每步 export 完整相等，无 clock 改动，原 saved speed 保持。这证明限定手动命令修复不改变所测旧档自动未来，不等同所有世界/所有存档的完备证明。

## 失败原件及历史证据

- pure01 图/源码原件：12 pure PASS；pure02 图/源码原件：13 pure PASS，但 tsc exit2（assert.deepEqual 造成库存类型收窄，food 属性 TS2339）。原 raw/receipt 保留，后续只修测试浅复制保完整断言；最新 tsc PASS 不删除旧 FAIL。
- `evidence/legacy-door02` 保存原 helper 与原真实 home/market/archive core 门边条：原15/15 FAIL（exit1），修复真门口 full-disk straddle 后同15加6控制为21 PASS。没有把原 FAIL 改成 PASS；new actual 五门场景在最终主 helper 图再验证。
- `evidence/helper-integration-review.md`（SHA a5cd2f4d381e5341c0b7a8ab9e44ded8ae1837a2cbf414f99fb40e61d2cce133）绑定旧 center candidate 主helper3241...，保持封存，不能外推验证最终33c7...。新的 `evidence/gift-bottom-review01/REPORT.md`（SHA 8f79f4326b7884d9605a90e348c5e9c29ceee24ad39513a69bbfbe01857f3698）解释真实 bottom 及限定静态无新增阻断。
- 早期 child index 有些 producer path 指向随后合法编辑的私有候选工作文件；这些历史 index 保持原字节，其当时 source SHA 应从 pure01/pure02、legacy-door02/original-source、gift-voxel-bottom03/original-source 及各 NEW original-copy 快照读取。最终审阅及实跑唯一权威 producer 是本报告 pure03/source 与 CANDIDATE-INPUTS-322.json；不把历史 path 当前 bytes 当成旧验证图。
- 四个更早独立 review namespaces 保持原报告/索引 SEALED，当前新 scope 与它们隔离。原 ROOT15 318 GPU/build/UI 或 full npm 的结论不外推本候选。parent 最新 b5b 全 npm 是 TIMEOUT_PARTIAL tests359/pass280/fail0/cancelled79，原 none 的 heap OOM exit134仍保留；本任务没有运行/弱化全套。

## 剩余集成验证

root 已确认安装前共享318 b5b exact 与三生产/两测试最小diff，并复制集成五文件、冻结同图322。剩余是 root 的 build 和受影响原 social/family/identity/geometry 测试（本次没有跑这些原模块），按 root 已安排串行 scope 确认实际 UI reason 与预算合法馈赠路径。完整 npm 未完成、自然预算患者供料/医疗生产、艺术等原未完成事项仍开放；不能称 gifted hunger 即临床治愈，也不能把受控位置/finite voxel 前件当成自然履约。无需要用户额外批准的本地候选工作；root review/install gate 已由 root 确认执行；后续集成验证结果不可由本子任务代称。

