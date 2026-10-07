# 下一阶段三项具体闭环缺项（只读接续）

来源：2026-10-07，原HEAD950348b，41503冻结图。只读源代码、完整原提示词/备忘录和ROOT23矩阵；未执行Simulation、step、tests、tsc、build、browser、GPU或性能，也未修改仓库文件。以下是产品范围缺项，**不是已证实的新缺陷或验证PASS**。既有有限功能与历史部分通过继续保留。

## 1. 能源：从合法设备购建到自然故障后再次恢复的完整生命周期

原目标见原提示词“所有系统真实运行”、产业链与能源；矩阵ENG-01/ENG-02/INF-01要求实际购设备、料工施工、合法产能与支路断电恢复。当前新增有界水电已经不只是纯参数：ROOT21–23具名负荷、有限双库、实际调度、完整冷重放和一次实付维修都有实现与各自回执。不能写成零供电、零维修。

明确实现边界在 [hydro-maintenance.ts:10](/workspace/yunshan/src/simulation/hydro-maintenance.ts:10)：声明固定“一次初始故障”，不是construction/wear/refill；[同文件:76](/workspace/yunshan/src/simulation/hydro-maintenance.ts:76)只接单机组有限双库原声明，[同文件:106](/workspace/yunshan/src/simulation/hydro-maintenance.ts:106)固定100托管/60分钟/1料合同，[同文件:361](/workspace/yunshan/src/simulation/hydro-maintenance.ts:361)已有job后拒再收费。当前真实公开互动允许成年付款人到原设施出资，随后原工程师到场、实际材料采购、工资实付、取消退款与完整严格保存，不会凭出资给旅行者工程师身份。[同文件:352](/workspace/yunshan/src/simulation/hydro-maintenance.ts:352)

尚缺的是另一条正式authority：居民/企业/合法财政提出新设备、合法产权与材料/工资预算，工班施工后改变真实发电/线缆能力；随后由有限水/燃料、磨损与自然故障驱动可重复维护。现有水力定义固定head且外部闭库，[power-hydro.ts:1](/workspace/yunshan/src/simulation/power-hydro.ts:1)；不能以直接给库加水、提高最大KW、改声明或复用一次job充当该生命周期。该文件的“routing/maintenance belong later”是纯核注释，不能用它否认现在已有host集成。

直接接续：先选择一个合法新设备购建合同，复用已有真采购/托管/现场分钟与canonical付款，不扩展当前reader上限。验收应包含本人现场下单/有限资金不足不动、NPC自愿接工与健康/食物暂停、材料与真实工资交付后才通电、当前负荷反馈、合法取消及完整save恢复future24。自然故障/补水和多次维护另列实际门。默认612城未声明新水电且能源岗位无人，不能把六楼/另一完整城能源证据或默认次日经济窗口当默认城合法启用。

## 2. 科技：真科研分钟已有，设备耗材与企业采用过程仍缺

原目标与矩阵TEC-01明确为真实研究成本、七领域、知识产业与社会采用；原剩余包含设备耗材、失败、协作/知识专利及制造采用。现有本人合法科研身份/学历/实验楼权限和120实际分钟，[extensions.ts:175](/workspace/yunshan/src/simulation/extensions.ts:175)；NPC也在岗位、钱≥300、需要/技能满足时自主出200研究，[同文件:345](/workspace/yunshan/src/simulation/extensions.ts:345)，并核原现场工资窗口及互斥活动分钟，[同文件:218](/workspace/yunshan/src/simulation/extensions.ts:218)。已有真实现金与科研劳动，不能写成计时器空转或无NPC自动研究。

目前支付是本人/NPC现金进公库并保存funding，公开本人命令见 [同文件:501](/workspace/yunshan/src/simulation/extensions.ts:501)，账户记账见 [同文件:129](/workspace/yunshan/src/simulation/extensions.ts:129)。ResearchJob保存actor/site/floor/budget/分钟/暂停等，[types.ts:68](/workspace/yunshan/src/types.ts:68)，但没有设备采购lot、实验耗材去向、项目失败/产出记录或各企业采用记录。满120分钟直接提升全城sector.level并删除job，[extensions.ts:382](/workspace/yunshan/src/simulation/extensions.ts:382)；交通/能源/医教等参数确有反馈，[同文件:270](/workspace/yunshan/src/simulation/extensions.ts:270)，这不等于企业经过有限购买、安装、培训或制造取得技术。不能声称没有任何反馈，也不能将全局参数加成叫完整知识产业采用。

直接接续：先选一个已有sector的一种有限设备或耗材，新增项目采购/占用/消耗与实际产出标识，保护原cash与工资债来源；技术等级与当前旧保存路线不暗迁。再让一家具名企业依现金、员工技能/实际劳动与材料自愿采用一个成果，保留拒绝/失败成本和可观察业务收益，避免所有企业自动免费升级。最低新门是合法本人与NPC两路径、钱料工失败原子边界、采购→使用→产出→采用四段可逐原事件追因、全量保存future24，以及产业/居民后果；当前pure几何和默认下一日审计不能代验这些阶段。

## 3. 灾害与拆建路网：真实雨洪封旧edge已有，空间破坏/迁居施工/CityPatch尚缺

原目标与矩阵DIS-01/BLD-01/BLD-02要求火震洪灾真实空间破坏、响应救援、避难安置、有限重建及居民意愿/产权/补偿后原子拓扑变更。当前 [extensions.ts:254](/workspace/yunshan/src/simulation/extensions.ts:254)真实雨洪由天气/risk/随机产生，扣区能量/繁荣、居民健康/压力并采购有限公共物料；native canonical event触发真实临河旧edge封闭、revision与原occupant退出permit，[roads.ts:140](/workspace/yunshan/src/roads.ts:140)。现有NPC居民道路诉求、公共双签资金、工人/替工真实移动和有限维修、旧edge恢复已实现；[roadworks.ts:408](/workspace/yunshan/src/simulation/roadworks.ts:408)是真politics审批/支出，不是纯公告。

雨洪目前没有建筑结构损伤、逐空间火势/震损传播、消防/急救/避难安置与重建工程的完整authority；事件仅给district/severity/time，当前灾害段只改上述状态与班次。[extensions.ts:255](/workspace/yunshan/src/simulation/extensions.ts:255) `build/demolish`仅自己有使用权的房间4m内放/拆本人0.2m voxel，有限库存/4096上限，不拆原整栋或造新道路，[simulation.ts:2595](/workspace/yunshan/src/simulation.ts:2595)。整栋/拟安置/新路检查显式 `executionAllowed:false`、`requiresActualConsent:true`，[building-alteration.ts:29](/workspace/yunshan/src/simulation/building-alteration.ts:29)，且明确无完整土地建筑产权登记，不替居民签同意、不结债或保门口物理通路，[同文件:139](/workspace/yunshan/src/simulation/building-alteration.ts:139)。不能把绿色预检报告、旧edge维修或居民homeId候选当拆迁安置工程已经执行。

直接接续：从一个有明确权利和灾损的有限建筑/道路项目开始，先固化原住户/家属/岗位/货权/工资债/租约/服务/废物清单；有合法现场身份、真实居民同意与可用安置、有限补偿/工料/人员，再原子提交新的几何与拓扑。保存必须绑定新world版本/fingerprint并一致重算route/index/cache/跨区任务/许可，取消或失败不部分迁居/扣款/删建筑。最低验收是自然canonical灾害→实体损伤/封闭→本人和NPC真实救援/安置/施工→重建恢复与财政反应→完整原件保存/未来运行/恶改原子拒。火震广度与长期救援资源另列，不能以一项项目通过结束灾害域。

## 医疗、教育、卫生病毒与商店继续保留的范围

没有把其他子系统写成未实现：临床已有真患者/付款人到站、30托管、1料、实薪医患共同20分钟与健康/废物，[clinical.ts:306](/workspace/yunshan/src/simulation/clinical.ts:306)；公教预算、卫生托管/交接/本人运输与病原护理及店铺买租/供料/员工恢复均有此前阶段部分通过。备忘录全读核实：公共教材/医患供应/工班有不少证据来自自定义小图和分段夹具，不能冒默认612自然全流程；原默认成人重复课程/clinical orders0不等全公校和自然医疗完成。卫生自然源传播/NPC自动接工/末端污水、店铺自然第三次困难/新租户与全楼土地权、教育默认全校通勤供料/家庭资助/长期财政及完整病原医卫响应仍沿原矩阵继续。这里的三项接续不是削减其他38域欠项。

具体历史约束、按原15章剩余和全读行号见 [MEMO-FULL-READ-AUDIT.md](MEMO-FULL-READ-AUDIT.md)。全局仍38域PARTIAL、ART_FAIL、MacNOT_RUN；此文件仅静态事实与建议，未新增运行通过。
