# ROOT07 原 14 日死亡的只读因果诊断

原审计终结为 FAIL，不替换或重写原失败。本子任务未构造 Simulation、importSave、step、command、新测试、GPU 或另一轮 14 日；只读取真实终档/原报告，调用冻结源码的纯几何函数。结果表明应先修楼梯重规划的真实出路，不补钱、改休息半径、放宽身体支撑或死亡断言。

## 原运行和原件来源

原生产者 /workspace/yunshan-work/ROOT07-city-continuation-20261004-01，原 economy14d01 receipt：2026-10-04 01:37:47.638370—03:14:44.468136 UTC，exit1 / FAIL，241 输入稳定，10080 ticks，游戏 14 日。原 sourceHash 与 endSourceHash 相同，现金及工资约束先执行，通过后在 scripts/economy-audit.ts:275 原 616 居民全部存活守卫失败（1 !== 0）。终档立即读取字节一致并续 24 tick 字节一致，是原审计自己运行的保存验证，不是本子任务重跑。

| 真原件 | 字节 / SHA256 |
| --- | --- |
| 原报告 source/artifacts/root07-economy-14d.json | 256533 / 2e81c0efc71a0f059028529286400397fec0a49b40afd47695e6cd3aaf43ac32 |
| 原终档 source/artifacts/root07-economy-14d-final.save.json | 3603827 / 79ec2e152163525fd8dbabcf3f6090b23c106460409175fed147a2729dacc547 |
| 原 economy14d01/raw.log | 真实字节及 SHA 见 ACTUAL_PRODUCER_RECEIPT_BINDING.json；SHA d0d3add3a238177493f53da5f9a26fff163e96d7eef8f5bd31e123c13da30cba 与原 receipt 一致 |
| 实际外部 World 原件 city-map-v6-20261004-01/world-native.json | 1832309 / ae802b350febe1ed74b72de1422de0b1b8b99d280db86255b915f42722b62444 |

上述报告、完整 save、World、原 receipt/raw、原输入清单均已字节复制到 producer-originals。World 是实际 map 生产者的独立原件，使用 ROOT07 冻结 savedWorldFingerprint 原函数，匹配终档 b85fa6ec 与 seed；不将 map 生产者的 60 输入冒充本审计的 241 输入。本静态查询分别有自己的 61/62 只读输入 before/after hash 清单。

## 真实死亡与直接证据

唯一死亡为 citizen-45 叶舟，商人，tick9559/day13，age20.036373668181415。原 death.before 记录：health0.01091701468228549、hunger0、fatigue0、money1095.7053951919277、state=unreachable、destinationId=null，位置 (-171.73600000000002,80,190.9869782779261)。死后原 health0/alivefalse，终钱包仍同值、food0；本人 home=market-b18，work=market-b30。终端活动 rest，死后 route/destination 被生命处理清除。

- 饥饿和疲劳为零提供直接健康扣减原因，年龄远不到110。extensions.ts:290—294 的健康公式在饥饿罚项60、疲劳罚项50下为负；用终端 medicine0、水质85.2658657797073代入约 -0.00750314/分钟。这是现公式代数核对，终端环境不是死亡 tick 的环境采样，不能宣称精确重播当帧。
- 原钱包足以买食物，不是无购买现金的直接反例。本人原工作对应私营合同保留 day2/192实际分钟及真实雇主现场审批；终档此人没有待付/已赚未付工资行、没有公共雇佣，不能用全城欠薪概括此人。
- clinical.orders 没有此人条目，clinical.archived.count=0；未见此人实际诊疗发生。pathology=null，默认这轮没有真实病理实例或受控来源，不能将死亡归因病毒。
- 上述不建立“此前每天一直充足食物/无其他冲击”的完整轨迹。原 before 没有 food、route、岗位/医疗历史，每日 lastSnapshots 只含群体汇总。原 foodDistance 没排除工业 workshop，既不能作可食路线证明，也不能证明此人有食物可达。

## 最小真实运行因素：支持与路由不一致

使用真实 World、死亡 before 位置和冻结原函数，static-geometry02/raw.json 给出：该点属于 market-b18 第1层，局部 (-10.136,3.4,-6.413021722073893)。floorPlanSupport 返回 stairs / floor1 / y80，完整身体 selfBlocked=false，床侧位置检查 null。24 个权限合法、未体素阻挡的真实床侧点都不能从该点得到 findBuildingFloorPlanRoute；到自家地面 door 也 null。

static-endpoint03/raw.json 将原因进一步收窄：

1. 真实点恰位于原 getFloorPlanStairRoute(home,0,1) 第21段，(-171.736,80,191.2)→(-171.736,80,190.6)，t=.35503620345651027，点到段距离0。不是外来非法站位。
2. floorPlanSupport descriptor 为 stairs，且没有 link；平面 slab 含中心，但 canStandInFloorPlan(...,.35)=false。
3. architecture-floor-plan.ts:466 needsStairRecovery 第一行 if(!support?.link)return false，使这个真实 supported 顶端连接段跳过恢复。:472 findFloorPlanRoute 的 endpoint 要平面可站，第1层没有 ground entrance fallback，直接 null。:525 楼间路由随之也 null。到同层 canonical stair centre 的原函数同样 null。
4. simulation.ts:1009 起 setDestination 按新活动/目标重规划；:1390 左右的实际需求/时段可促使途中重新选择。找不到床/工作/服务点的路线或未到真实点时，:1437 设置 unreachable/清 destination，且不发休息/工资/消费。需求继续按实际分钟衰减。原死亡状态与此反例一致。

高置信结论是“原 canonical 楼梯段有真实身体支撑，但路由把它当作平面不可站且缺 link 的起点，无法规划离开/到床”，这是原运行可修因素。原死亡前整条 route 和第一次被困的 tick 没有采样，因此没有完整历史因果重播，不能声明只有此一问题或已有修复通过。

## 排除其他直接替代解释的有限核对

工作 market-b30 的五个原 work 点全部 permission=true、support=room、selfBlocked=false，door→各点原室内 route 可达。它们不是工作场所功能点整体缺失，但未查询死亡前外部道路路线。

终档明确按原 commodity 规则排除 kind=workshop，再过滤 open/inventory>=1/钱包买得起，得到74个食物商店。最近 shop-market-b74 是 market，库存38，价格14.715348534572863，真实三个地面 sale 点都有 room 支撑、许可和从 door 可达的室内路径。直线门距261.94528203082075，不能当外部道路可达距离，更不是死亡时库存。当本人没有 home 退出路径时，远端 food sale 点有效也不解决当前困住位置。

同一真终档另见 citizen-406、citizen-89 是 unreachable 且 hunger/fatigue0，health约33.997/41.210、仍有现金；这里只记录终态风险，没有扩跑或宣布它们是同因。修复后应按受支持起点恢复的一般性质验证，不能仅特判 citizen45。

## 最窄修复与验收建议（未在本子任务实施）

- 保留完整 .35m 身体支撑和真实楼梯表面。恢复识别应在平面不可站、但真实 stairs 支撑的起点保有所属物理楼梯/连接 provenance，沿实际 segment 朝合法 landing/入口走；不能把当前位置瞬移至中心、跨层补 route、放宽半径或删除需求扣减。
- 先保留本原点反例：真实 source函数原样给支撑却到门/床 null。新隔离源应证明同一原点能连续到原有效床与门，逐段支持/碰撞/层权限不放宽；非法墙/床内/悬空、异楼层、受限 floor、真实阻挡仍须拒绝。复查途中需求重选/原 route 被打断后的路线，不能靠禁自治或只完成一条固定 route。
- 后续真实模拟回归与新 14 日若主会话选择执行，独立 freeze/source/raw/save 并保留 ROOT07 原 FAIL。原叶舟终档已死，不能改 alive/health 后称原终档 live 复现或恢复；新受控正例必须标明构造，原保存仍保持字节。

## 可复读命令与边界

在 ROOT07 frozen source 目录，依原正常 node_modules 运行本目录 inspect_actual_geometry.ts 与 inspect_route_endpoint.ts 即为纯查询；原几何输入和 raw/receipt 已归档，可直接读原 JSON 无需执行。它们不导入 Simulation。首次 static-geometry01 的外部 TS driver 因 isolated namespace 缺 type=module，顶层 await 在 CJS 转换前报错；原空 stdout、输入及工具报告留存。仅给本新 namespace 加 type=module 后 static-geometry02/endpoint03 exit0，原生产源始终未改。

完整资金守恒及保存通过不代表本原审计通过或稳态：终 NPC615/616，玩家也dead；21家公司无零资本；居民现金总数较起点 +17.6724%，财政80000→20249.5888；已赚未到期公/私工资877.0843/363.0976，期到欠薪0。原 residual 现金 -3.7777e-8、财政 -4.1422e-8 保1e-6；steadyStateEstablished=false。源真实性与存档 +24 通过、全员生存失败必须同时报告。

所有旧交接组未改。本组无 ZIP、无上传、LibraryID=null，主会话负责最终收集与上传。
