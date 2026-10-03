# 科研现场劳动候选：只读存档/分钟/现场冲突复核

复核对象：`/tmp/yunshan-research-attendance-prep-14-01/research-attendance.patch`（SHA256 `de8428080af2a05878fcea6b69c9f196fd56f91f01214f013b3f8b673bb4fec8`），其 candidate 三源与测试源；core/医疗/文化/玩家工班依据 actual15 冻结 `/tmp/yunshan-system-coherent-15/source`，并核对 actual14 的旧科研/医疗合同。全部输入身份见 `review-inputs.json`。引用 candidate 行号指 prep/candidate；引用 actual15 指该冻结源码。

本轮仅静态读取、哈希和独有 `/tmp` 报告写入，无 Node、Simulation、测试、build、GPU、ZIP、Library、共享或候选源码编辑。以下均为源码可推导的复现设计，**尚未执行**。不给当前候选 PASS；也不借 actual15 当前联合运行的成功或失败替代科研验证。

## 结论与优先级

有两条应在接受新科研合同前修复的具体问题：

1. **R1：分级延迟出勤被 current-tick clamp 丢弃，120分钟科研进度随 focus/tier 改变。** 根已确认需修；不能强制研究 NPC active、不能放宽120，也不能凭当前脚点倒推全部历史在场。
2. **R2：新存档只逐课题验证时间，没有同一 actor 跨课题合计容量约束。** runtime 的共享 Map 防即时重复，但导入可接受同一人4分钟做两份各4分钟的科研快照。

R3 是 NPC 科研与公共教育服务的跨模块分钟重用风险，建议一个合合法源合同的定向场景验证。旧 pending grandfather、本 phase 注册顺序、终态指针排除与 UI 共用 context 函数总体有清楚的设计；仍应承认 grandfather 是兼容政策、不是旧文件来源认证，shared 函数也不是各模块已共同分配每分钟的证明。

## R1：真实分级劳动不能被截成一个 tick

candidate `src/simulation/extensions.ts:180–201` 每 time 清 wage Map；event 时将真实 earned minutes 截到 `researchPhaseMinutes`；每次 people 以本phase预算给科研，且同 actor 多 sector 再共享该预算。actual15 `src/simulation.ts:933–942` 的 core people 对 active 每 tick、regional 每4 tick、statistical 每16 tick处理，跳过时持续累积 `peopleElapsed`，不丢日历分钟。实际到达后用 `arrivedElapsed` 注册出勤（:1007–1022），其真实 wage-earned 可含多个 tick 的劳动。

持续合法站在原 lab、课题在整个区间内已存在、原岗位/身份/需求和班次充足的 NPC，统计级16tick期间只有1次实际工资事件。speed16 下每tick4分钟，core可结64分钟真实出勤；候选只给当次4分钟科研，其余15次无event=0。regional 同理最多得 active 的1/4，statistical最多1/16。换 focus/tier 会改变同120有效分钟条件的实际完成时间。此结论是静态条件推导，不是自然城计时实证。

candidate `tests/research-labor.test.ts:89–100` 明确在16tick里检查 `maxEarned >= 64` 而累计 research credit 恰4；该测试还人工给 `peopleElapsed=60`，确实需要排除 job创建前的历史出勤。它目前把“排除创建前分钟”和“丢掉已存在课题的持续合法延迟分钟”一起固定成 clamp，不能作为保持分级时间等价的证据。

### core 已有的边界与缺失信息

actual15 `src/simulation.ts:30` 的 Event 没有 attendance 起止、稳定片段ID或明确 workId/siteId；wage-earned 从 :234 发出，只有 actor/shop/district/minutes/amount/rate。:48 的 WageAccrual 仅累计 actor+workId 的 minutes/amount，不能还原该累计何时、在哪层或具体工作点发生。

`registerAttendance`（:211–221）先算 `credited = min(elapsed, 每日480余量, 本班获准余量)`，再累计并 emit；不能把事件“credit5分钟”当然解释为 `[clock-5,clock]`。例如到达后可工作窗口20分钟但工资合同仅余5分钟，credited只是窗口内5分钟；需 core 明确选择/记录哪个实际区间，不能由科研在末端猜后缀。

people 本身可提供更精确的真实运动依据：:933–942 有从上次延期累积的总窗口；:963–974 把交通实际 arrivedAt 后时间裁给步行/活动；:1007–1014 用剩余 route 距离/原合法步速算本次真正到达后 `arrivedElapsed`。它有“到达前不能赚现场工资”的时间边界，但当前 emit 未传该边界，且只有末端 lab 几何/资格检查。当前脚点 + 大 minutes 数不足以保证64分钟都在 job 的原 lab/楼层，更不足以排除期间体素阻挡、换岗位/身份、离场和复归。

### 最小修正合同建议（不实现）

- 不改 tier、工资费率、速度、120有效分钟、.35/1.72或身体/权限合同。
- 从产生真实 attendance 的 core 提供具名 site/work、稳定 attendance 片段ID、实际到达/在岗区间及真正 credited 部分，明确每日/班次 cap 选用的区间；科研只能消费已认证的劳动，不再发一次工资。
- 科研自 job.startedAt 起记录逐phase的合法性/离场窗口，实际薪资区间与原 lab/楼层、资格、身体/需求和未被其他活动消耗的时间求交；同 actor 的跨 sector 从一个共享待消费容量扣减，不复制每份窗口。不能简单把 clamp 改成 event.minutes 全收。
- 延迟工资到达前的观测窗口/已消费标识必须进入新保存合同，或有其他可续的权威出勤片段；candidate onLoad 在 :638–639 清所有 transient Map，仅靠 lastObservedAt 无法保存尚待工资的合法窗口。导入不能重复消费片段，也不能保存后丢未结劳动。
- 旧档不存在这些历史观测/认证字段时，只从恢复后开始认证新现场劳动；旧未标课题继续其明确 grandfather 合同，不凭缺字段追认120现场分钟。不会从创建前积累工资、刚刚到达或仅现脚点合法取得研究。

将 core 的 arrive/credited 窗口和逐phase lab 合法性接合时仍需定向核：持续已在岗、研究半区间创建、到达发生在批次中间、期间真实离场/回场、动态体素/失格、partial日/班次 cap、tier/speed变化及中间存取档。若区间不能证明，明确保持未认证而非凭位置补算；同时不能把有证明的持续在岗分钟因分级抹去。

另一个范围更窄的候选由 architecture_review 提出，交根裁定：只给最多7个 **new marked pending** 具名NPC每tick处理，不改变其tier、移动速度、minutes或日程，不强制tier active；让后续core正常产生逐tick实际工资事件，旧grandfather不改频率，feedback完成删除后下tick自然恢复通常处理频率。规则从已保存job列表派生，可避免transient override引起exact续演分叉。但第一次或读入有peopleElapsed的flush仍有上述旧时间/日班cap歧义；应保原core完整路线/出勤/钱并拒绝无法认证的catchup科研，待下一真实逐tick事件再计，不能删除pendingMinutes来消掉问题。若要首tick也精确计足，仍需具体credited窗口。此候选不是已实现或批准的新规则；R2保存容量与其它现场冲突仍要独立解决。

## R2：新存档绕过共享 actor 容量

candidate `src/simulation/extensions.ts:609–624` 逐job检查 lab绑定、floor、workedMinutes0..120、cursor=lastUpdate、worked≤now-start、progress=worked/120；没有同一 actor 的多个 pending jobs 总时间容量或区间重叠约束。

可复现设计无需 fake event：

1. 使用现候选 `tests/research-labor.test.ts:41–45` 已有真实 command 场景，同时 start traffic 和 medicine，均 actor=player、startedAt相同、预算各100、finishAt=start+120。
2. speed16一个真实tick后 clock前进4。原行为应 traffic.worked=4、medicine.worked=0、两个 lastObservedAt=now；runtime Map 正确使总=4。
3. 导出新格式，只把 medicine.workedMinutes 改4，并把 medicine technology.progress 同步为 `4/120*100`；其 funding/start/finish/site/floor/actor/cursor保持原值，state/paused reason仍合法。
4. 每job单独都4≤now-start=4，引用/钱/进度等全部满足现 validator；但同 actor 合计8>4。未找到另一个 save validator 对 ResearchJobs 联合容量拒绝，core wage 的累计守恒校验只检查 wages/attendance，不引用这些 player 科研 counters。因此现代码应接受此不可能的新科研快照；尚未运行实际 import。

最低应验证同 actor pending attended jobs 的必要容量：同时起点的合计worked≤now-start；不同起点至少对每个 start 门槛检查从该时刻开始的课题集合合计不超过对应日历窗口。更完整的片段消费账应让保存与恢复证明共享同一份可用劳动、已消费不重用；旧 grandfather job 不能被人为赋 attended 劳动以凑此账。此必要验证不能证明确在场，但必须拒绝明显双用时间。

现测试 :121–136 覆盖 partial markers、unknown actor/site、floor/progress/future/historical cursor，只有单job腐坏；应新增上述跨sector快照原子拒绝，及多个不同 start 的必要容量边界。运行版共享预算和 import 版共享容量是两个独立合同。

## R3：NPC 科研与同校公共教育可能同 phase 重用分钟

candidate `src/simulation/extensions.ts:172–173, 197–201` 对 NPC 只核 scientific角色、working/workId原lab、具名实际工资、原楼层/完整身体等；只 player 走 researchPlayerContextReason。actual15 `src/simulation/culture.ts:73–81` 的 readersAt 接受公共层、有权限的任意 function point，没排除 `state === working`。:118–128 的 education service 对现场非staff、需求充足、未served居民增加整phase `serviceMinutes`；没有消费已用于科研的同 actor 时间。

具体设计场景：正常无 facility 的学校公共科研 work point，一个已在该点 working、education≥3/skill≥35 的科研 NPC，同时学校存在合法审批/有限材料/合资格在岗老师的 active education service。科研先在 extensions people 接受其工资分钟；之后 culture people 把同科研 NPC作为教育 recipient 加同phase service分钟。它与老师不是同一个人，staff 排除不会挡；公开work point本身满足 readersAt任意functionpoint规则。需用真实服务生命周期形成订单再测，不能用不符合完整schema的 synthetic pointer假装发生。

这是跨模块接合风险，不要求本轮改造全部文化服务。若公共教育确为占用参与者的有效服务时间，则新科研应共享 actor 活动容量或排除该实际并行；若允许其只是背景接触，则不能仍将相同分钟宣传为两份互斥劳动。该场景未运行，不声称默认城已经触发。

## 已静态核清的正确边界

- **phase归因**：actual15 `src/simulation.ts:547, 585–591, 611–615` 的 core phase先注册，time先增 tick/clock，core people先真实移动/出勤后 emit；installExtensions 后续 people观察。candidate :196–203 绑定 tick+extension clock、正minutes、有限非负amount与工作者，finance创建的 job 不参加此前工资事件。amount=0但真实minutes>0的合法旧费率不应被新amount>0门槛排掉。普通 wage（无minutes）的事件不能授科研时间。
- **不二次计工资**：observe只读事件并记研究worked/progress，不发新 wage；同一phase重入因 lastObservedAt 已等now，elapsed0不会再增。即时同 actor sectors 的 Map 本身正确且按 TECHNOLOGY_SECTORS 顺序消费。
- **新保存边界**：当前job允许保存人在外、失去当前岗位/身份或死亡等暂停前后的合法状态，validator只绑定存档actor存在和原lab/floor而非 live旧对象；下一真实phase再判断资格。这比要求import时人必须正站原点合理。lastObservedAt=lastUpdate支持完整tick边界，不声称支持 midphase save。
- **legacy grandfather**：未标runtime只接受旧四字段job，onLoad添加researchLaborVersion=1和明确pending sector白名单；新job必须laborVersion1且不在白名单；partial marker拒；完成时清对应白名单。旧pending仍按原finishAt完成，migration会改变metadata字节，不能宣传旧原始wire逐字不变；新已标 fullsave续演另验。
- **来源边界**：保留 version1 envelope 并支持旧四字段语法，不能从内容区分真实旧文件与人为完全剥掉新字段/marker的同语法文件；测试 :139–147 人工删marker仅是compatibility边界设计，不是历史来源实证。:151起的真实旧14 command 原件方案有意义，但本审未运行或认证其结果。不要把这点转成用户审批或凭空加资金；明确兼容政策即可。
- **UI/context**：UI :657 与 runtime :170 调同一个 researchPlayerContextReason；player work只把working/paused且能在原工作点、身份/需求/开放区间恢复的班看作冲突，completed/cancelled/refundPending排除；homeRest只原租住房原床侧active；culture只未完project/active未served service实际现场；clinical只未结束治疗意图在原站点。失效终态pointer不会永久挡科研。
- **context不等于实际服务承诺**：clinical awaitingSupply/awaitingDoctor 也拒，guard有意保守，不证明该phase医生/材料已可治疗；culture active参与guard也不确认staff/stock/临床匹配。UI和runtime使用的callback并非完全同一几何：unmarked UI atBuilding :250–259还有32米门口/inside展示规则，runtime atBuilding :119依原near/ACL；marked UI依actions work点，runtime持续研究另加完整support/roof/voxels。共用context不能扩成“所有body/费用guard已UI完全一致”的验收，最终command仍需原子拒绝。不扩大修复旧全部UI proximity合同。

## 本轮交付与后续验证限制

主阻断 R1/R2 已实时发根和 `/root/architecture_review`，R3已明确只读候选。没有编写或运行修复/测试代码。未来定向结果必须分别保原候选首个 FAIL、修后 PASS、实际源码/patch身份以及旧14 pending原件；不能修改本报告所审patch来覆盖失败，也不能把受控fixture、放置资格/位置、synthetic context检查当 ordinary native 或自然科研证据。

整合应将修后patch接到实际15合成源，不用旧14 candidate整文件覆盖 M1 的clinical/culture/UI变更。保存buffer/事件区间若新增共享字段，需实际联合strict/相关检查及保存24tick精确续演，再决定真实UI/自然范围；本轮均 NOT_RUN。
