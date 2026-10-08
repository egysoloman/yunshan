# ROOT27 八域实现入口与缺项静态审查

本次结果是源码与文档静态审查。没有构造/导入/步进 Simulation，没有执行测试、构建、浏览器、GPU 或修改共享文件。38×52 最新矩阵实际读出 38 行，ROOT26验证列全部仍为 PARTIAL；本报告不修改该矩阵任何格，不把食品有限重放代作其他域的完成门。推荐两个可独立接续的有限业务：**既有诊所的真实分诊候诊**、**一个既有实验室的有限科研耗材合同**。根已选择分诊作为下一私有候选，科研仍只是建议。

## 审查依据与当前入口

以 [AGENTS.md](/workspace/yunshan/AGENTS.md)、[原始提示词](/workspace/yunshan/提示词.md)、[当前备忘录](/workspace/yunshan/开发备忘录.md) 和 [38×52矩阵](/workspace/yunshan/docs/validation/2026-10-07-city-life-root26-food-access/REQUIREMENTS-38.csv) 为输入；文档里的旧时间戳、FAIL、局部 PASS 与 NOT_RUN 保留各自来源，不能由较新的短窗推断跨域完成。本轮读到备忘录 ROOT27 原421夜间对照闭门追加；根随后告知夜经营私有源422的有限新窗，该通知不等本审查重新运行证据。夜经营与渲染由其他代理负责，本报告不提出重叠实现。

原提示词要求玩家是城市中的普通居民、各房间/工作区域实际可用、产业与交通有真实资源反馈、十阶段顺序固定，见提示词第7、35、47、51、65、89、97、121行。父对话已观察的最新参考目标包括高密现代CBD、中低街屋/庭院、机场及连续崖谷多层交通；本代理本轮未取得新图原像素，不宣称完成图像验收。两个业务应嵌入既有可进入空间，不新增独立模式或装饰假设施；美术缺项继续由其负责代理处理。

普通图形新游戏在 [main.ts:34](/workspace/yunshan/src/main.ts:34) 选择 current-v8，随后调用 createLearningCityLifeProductCity；[product-city.ts:11](/workspace/yunshan/src/product-city.ts:11) 的兼容产品常量、[world.ts:12](/workspace/yunshan/src/world.ts:12) 的工厂缺省保留 current-v6。v8 显式从 v6 扩展屋顶/出生，见 [world.ts:446](/workspace/yunshan/src/world.ts:446)。不能拿工厂缺省代称普通新游戏几何，也不能将新政策自动写入所有旧存档。此次没有重新统计 612 建筑/616 原始NPC，不把已有统计称为新构造实测。

## 能源与地图能源（ENG-01、ENG-02）

**已有入口和能力。** 原聚合能源与有限维修保留。无声明电网时，powerBinding 只绑定 core-main 和 core-energy-south；[power.ts:61](/workspace/yunshan/src/simulation/power.ts:61) 检查实际场址，[power.ts:71](/workspace/yunshan/src/simulation/power.ts:71) 使用身体支持、楼层权限和实体站点。声明 powerGrid 才启用有限库存/容量/分表调度，见 [power-grid.ts:229](/workspace/yunshan/src/simulation/power-grid.ts:229)；水电版有真实双库转水、供电和缺供字段，不是每帧免费能源。既有 hydroMaintenance 显式限定单机组的初始故障：玩家现场100托管、实购1工业材料、原工程师真实60分钟和原finance完整工资实付，见 [hydro-maintenance.ts:10](/workspace/yunshan/src/simulation/hydro-maintenance.ts:10)、[hydro-maintenance.ts:293](/workspace/yunshan/src/simulation/hydro-maintenance.ts:293)、[hydro-maintenance.ts:349](/workspace/yunshan/src/simulation/hydro-maintenance.ts:349)。支付者可以是成年旅行者，付款不授予设备操作身份。UI 针对已声明水电维护有入口，[ui.ts:730](/workspace/yunshan/src/ui.ts:730)。

**最大缺口。** 默认世界配方没有声明 powerGrid/hydroMaintenance；当前生成器/产品工厂中未见相应赋值，不能将另城有限水电原件称作默认全城建网。维护定义只允许一个初始合同，不提供购建设备、自然磨损/再故障、补水/电价或持续运营者生命周期。矩阵中四个 fileUtilityProposal/reviewUtilityProposal/payUtilityBill/fundUtilityRelief 在 src 实际搜索只见 [types.ts:53](/workspace/yunshan/src/types.ts:53) 的命令联合，没有对应生产 handler。合法设备产权、铺线钱料工、建筑/航空充电、地方馈线与灯火仍是具体未完成项。不要直接扩大储库或给能源院造员工来回避供给缺口；须从真实设备、岗位和材料能力设计新显式世界/政策。

## 医疗与公共医疗（MED-01、MED-02）

**已有入口和能力。** 普通玩家在诊所登记 heal，可为近旁居民协助付款；[ui.ts:1392](/workspace/yunshan/src/ui.ts:1392)、[ui.ts:1313](/workspace/yunshan/src/ui.ts:1313)。自然居民 health<60 且有30现金会比较诊所机会并实际走路，[simulation.ts:1635](/workspace/yunshan/src/simulation.ts:1635)；到场才尝试 beginClinicalTreatment，[extensions.ts:298](/workspace/yunshan/src/simulation/extensions.ts:298)。订单保存患者/付款人/实物采购/30托管/20有效分钟，[clinical.ts:306](/workspace/yunshan/src/simulation/clinical.ts:306)。医生与患者必须在同可访问服务站、身体有落脚、实际工资区间与到场区间相交；每名医生两个患者槽，医生时间取区间并集，与其他业务共用活动容量，[clinical.ts:205](/workspace/yunshan/src/simulation/clinical.ts:205)、[clinical.ts:216](/workspace/yunshan/src/simulation/clinical.ts:216)。无医生、缺料、离场、低体力、非8–17营业或声明电网缺供都不能完成。公共医疗已经有具名诉求、有限预算、实购物料和实际医生劳动，见 [culture.ts:137](/workspace/yunshan/src/simulation/culture.ts:137)、[culture.ts:158](/workspace/yunshan/src/simulation/culture.ts:158)、[culture.ts:209](/workspace/yunshan/src/simulation/culture.ts:209)；不是全部缺失。

**最大缺口。** 当前付费订单按数组顺序处理，[clinical.ts:347](/workspace/yunshan/src/simulation/clinical.ts:347)；公共患者包含玩家前缀及居民列表，[culture.ts:175](/workspace/yunshan/src/simulation/culture.ts:175)，原共享容量防重复，但没有统一的严重度/实际等候时间优先安排。完整诊断、检验、特定药械、住院、急救转运也未有业务闭环。YV1 已有具名接触剂量、症状负担、免疫记录和真实消毒劳动传播；但根来源明确 controlled-validation，[pathology.ts:84](/workspace/yunshan/src/simulation/pathology.ts:84) 没有普通游戏命令/构造调用，validator 也只接受受控根来源。不能把受控传播试验当自然居民已有疾病来源。原诊疗只减症状，不消灭病原或生成诊断/药物，[pathology.ts:130](/workspace/yunshan/src/simulation/pathology.ts:130)。

## 科技（TEC-01）

**已有入口和能力。** 七领域真实存在。科研身份、学历、站点楼层权限、原实验室身体和120分钟劳动有规则；普通玩家在产业科研页发起，见 [ui.ts:220](/workspace/yunshan/src/ui.ts:220)、[extensions.ts:503](/workspace/yunshan/src/simulation/extensions.ts:503)。自然科研居民可自付200、保留100生活资金、在原工作场所发起，[extensions.ts:345](/workspace/yunshan/src/simulation/extensions.ts:345)。NPC 只消费当前真实工资区间，研究者/教师/其他任务不能重复用分钟，缺供/离场暂停，[extensions.ts:193](/workspace/yunshan/src/simulation/extensions.ts:193)。完成真实劳动一次提升技术等级，制造/农业等产出及社会参数使用技术数值，副作用进入环境，[extensions.ts:381](/workspace/yunshan/src/simulation/extensions.ts:381)、[simulation.ts:2088](/workspace/yunshan/src/simulation.ts:2088)。

**最大缺口。** 现在研究预算整个通过 publicFunds 转财政，而 ResearchJob 没有设备、物料库存/购买/保管/消耗字段；[extensions.ts:189](/workspace/yunshan/src/simulation/extensions.ts:189)、[extensions.ts:511](/workspace/yunshan/src/simulation/extensions.ts:511)。成果主要是全域等级/倍率，缺设备/耗材、实验失败及协作、知识产权、企业取得成果/安装具体生产设备的应用链。不能将现有200财政费用又算成新的采购余额，也不能为科学家凭空生成试剂或把近实验室等同已具备实验设备。

## 政治与财政权限（POL-01、POL-02、POL-03）

**已有入口和能力。** 玩家120登记的具名选举、实际选票和14日市长任期存在，[governance.ts:135](/workspace/yunshan/src/simulation/governance.ts:135)、[governance.ts:192](/workspace/yunshan/src/simulation/governance.ts:192)、[ui.ts:720](/workspace/yunshan/src/ui.ts:720)。自然居民地方公职也已有真实岗位劳动证明、本人120登记、现场官员与居民投票、任期来源，不是只允许玩家政治，[civic-staffing.ts:369](/workspace/yunshan/src/simulation/civic-staffing.ts:369)。预算追加依赖当前真实职位/任期和两份合法签名，工资及既有承诺先保护，[budget-authority.ts:149](/workspace/yunshan/src/simulation/budget-authority.ts:149)、[budget-authority.ts:217](/workspace/yunshan/src/simulation/budget-authority.ts:217)。自然具名居民诉求与有限公共服务已有 [culture.ts:112](/workspace/yunshan/src/simulation/culture.ts:112) 入口。

**最大缺口。** 当前市长竞选主要是候选人/保留治理的表决，不是完整多候选政党竞争或议会立法/监督。法院、辩护/审判、监狱与复杂阶层迁移/福利/军政外交缺相应持续业务。任期、财政、自然双委员到岗的长期覆盖仍要沿真实时间推进，而不由近期食品窗或考试身份标签代证；任命 UI 存在也不能代替所有预算所需的选举来源。

## 教育与公共供料（EDU-01、EDU-02）

**已有入口和能力。** 玩家在学校公共真实课堂40托管、实购1材料、付薪教师/学生60共同分钟后正式记录，离场暂停/未赚退款，[education.ts:254](/workspace/yunshan/src/simulation/education.ts:254)。合法监护人和儿童现场报名、监护储备保护、自然家长带孩子入学已有 [family-education.ts:89](/workspace/yunshan/src/simulation/family-education.ts:89)、[family-education.ts:114](/workspace/yunshan/src/simulation/family-education.ts:114)。明确 resident-tuition 政策下，成年原学生本人自愿实付40、保留100、教材与付薪教师共同授课，已走自然 presence 入口，[resident-education.ts:113](/workspace/yunshan/src/simulation/resident-education.ts:113)。新图形工厂显式启用相应升级，[product-city.ts:65](/workspace/yunshan/src/product-city.ts:65)。公共教育已有预算/供料/教师服务，不能依据矩阵较早列把它重报为未实现。

**最大缺口。** 正式学习以有限课程次数/分钟和学历数值为主，职业考核还有缴费/学历门槛的直接资格授予路径，[simulation.ts:2497](/workspace/yunshan/src/simulation.ts:2497)。完整课程内容/成绩与考核、不同职业实习/能力、多年升学、家庭困难资助及通勤照护、默认全校持续物料与教师覆盖尚未闭环。原每师四学生槽和有限教材不能由自动补学时/免费资料绕过。

## 家庭生命周期（FAM-01）

**已有入口和能力。** 自然居民之间有 courtship→dating→engaged→married、同住计划、双方意愿和积累共处时间，[family.ts:263](/workspace/yunshan/src/simulation/family.ts:263)。双方合法同住并满足身体/资源才各托管100、270游戏日妊娠；真实新儿童有独立钱包/needs/谱系，[family.ts:205](/workspace/yunshan/src/simulation/family.ts:205)、[family.ts:407](/workspace/yunshan/src/simulation/family.ts:407)。监护人接续、实际食品转交、儿童入学/成年找工作、家庭现金和现场购食都有业务。死亡先债务/银行结算，再现金、股份/经营资产与法定继承处理，[family.ts:349](/workspace/yunshan/src/simulation/family.ts:349)。婚礼/葬礼是既有现场有限仪式，不应写成完全缺失，[family.ts:482](/workspace/yunshan/src/simulation/family.ts:482)。玩家正常入口在 [ui.ts:1024](/workspace/yunshan/src/ui.ts:1024)、[ui.ts:1044](/workspace/yunshan/src/ui.ts:1044)。

**最大缺口。** 目前幼儿照护用同住所且三维距离≤24m来给 social/fun/转食，[family.ts:430](/workspace/yunshan/src/simulation/family.ts:430)，这一支未请求独占照护活动分钟，也未像课堂那样约束同房可达站点；多层住宅/墙体、照护与工作占时、老人长期照护仍需要具体业务。年龄按原分钟/365日自然增加，[extensions.ts:289](/workspace/yunshan/src/simulation/extensions.ts:289)，不能把有限几日窗口称完整自治世代或加速改年龄来补证。住房产权动态、家庭困难与长期关系心理也未完成。本条是静态能力边界，不宣称已运行出穿墙照护反例。

## 灾害（DIS-01）

**已有入口和能力。** 自然雨天/水质风险驱动山洪事件、实际有限救灾物资支出、地区健康/压力与交通班次反馈，[extensions.ts:248](/workspace/yunshan/src/simulation/extensions.ts:248)。事件必须是原 canonical 灾害，roads 选择临河可用真实道路/桥边，保存封闭版本和占用者许可，[roads.ts:142](/workspace/yunshan/src/roads.ts:142)。真实阻路需求能接公共维修；工人走到工地、材料真实移交、独立合同工资/税和活动分钟，然后合法复开，[road-demands.ts:82](/workspace/yunshan/src/simulation/road-demands.ts:82)、[roadworks.ts:325](/workspace/yunshan/src/simulation/roadworks.ts:325)、[roadworks.ts:380](/workspace/yunshan/src/simulation/roadworks.ts:380)。

**最大缺口。** 主山洪影响仍以地区标量与一条选中道路的封闭为主；没有空间火焰/烟气传播、地震结构失效/坍塌、按真实受困位置救援、避难容量/安置、保险、余震与有限结构重建闭环。真封路/真维修已经存在，但不能从其测试扩大到整个灾害体系。灾后改造还必须保在住者、租约、产权、未结工资/服务和新路物理锚点，不可直接删楼重建。

## 基础设施及设施生命周期（INF-01）

**已有入口和能力。** 原道路、交通、经营店铺、租约/所有权、有限电网都是权威状态。医疗废物来自已完成服务，不是凭空垃圾；公共消毒有具名需求/真实岗位医生/本区双官审批/有限20cap和实际材料采购，[hygiene-public.ts:46](/workspace/yunshan/src/simulation/hygiene-public.ts:46)、[hygiene-public.ts:62](/workspace/yunshan/src/simulation/hygiene-public.ts:62)。因此垃圾卫生不能一概写成空白。建筑改造工具已经枚举在住/孕期/经营/租约/股票/欠薪/服务/废物/供电保护，并检测提案道路拓扑，[building-alteration.ts:131](/workspace/yunshan/src/simulation/building-alteration.ts:131)。

**最大缺口。** 改造工具明确 executionAllowed:false；只是只读预检，不移人、不赋地权、不保留钱料，也不执行新道路/建筑的原子更新，[building-alteration.ts:4](/workspace/yunshan/src/simulation/building-alteration.ts:4)、[building-alteration.ts:32](/workspace/yunshan/src/simulation/building-alteration.ts:32)。供水/排污/全城垃圾设施、消防通信仓储管网和设施产权/经营者更替、老化迁移扩建、新用地与施工持续预算缺实际建造运营闭环；有预检报告不能称城市已经可任意改建。该工具自己的 road.checksPhysicalDoorAccess=false 也不能代替实体门口/高差/桥端通达。

## 建议A：既有诊所的真实分诊候诊（根已选择，尚未安装/运行）

有限范围是一个版本明确的诊疗政策，在**原有合法付费/公共患者候选、原医生有效工资窗口、原两槽容量**上派发候诊。按当前实际 health 的严重度档、首次真实候诊时钟及稳定actor/order ID确定优先；只能对当下有材料、有到场/权限/体力、同站可用医生且仍需服务的候选排序。离场者不霸占槽位；已累计分钟的合同继续持有材料/托管，不因排序删除原权利。排序必须进入 claimClinicalCareMinutes 的实际容量授权，不能只在UI显示队列。

普通玩家从现有 heal/attendService 到场登记，NPC 从现有真实 heal/service 目的地进来。不要远程注入患者、替代医生、改变20分钟/1材料、支付人/预算、健康提升、复诊间隔、8–17开放或移动速度；严重度是虚构游戏health排序，不冒新医学诊断。付费/公共共享排序应阻止注册钩子/数组前缀先耗尽全部容量，但不能让尚未获批公共订单免费进入。尽量使用已有 startedAt/scheduledAt/approvedAt/receipts 与真实状态推导，避免新保存模块；若缺省合同的容量分配语义需要维持，则以显式新政策激活，原政策保存/未来输出仍原样。无余量/未到岗时真正等待，不补药、不补医生。

可独立接续源码面：一个纯 helper，clinical 的实际槽位授权接线，culture 原公共候选必要窄接线；不碰夜零售/渲染/世界配方。预期5–10个有效受控用例覆盖严重者优先、同严重度真实久候优先、稳定并列、离场/缺料/未授权不占槽、付费/公共共享2槽/原并集分钟、暂停保权利、旧政策原样；这些将是待写/待根执行的验证，并非本报告已有PASS。最终要再用真实自然居民和正常玩家的身体/订单/医生劳动原件证明容量选择改变，而不能只交 helper 数字。

## 建议B：单农业课题的有限科研耗材合同（仅建议，不在本轮实现）

选择既有可进入实验室、已有合格科研居民及玩家科研身份，只扩一个农业课题。新显式政策允许本人以实际预算签有限合同，**先划分实际财政登记费与可退耗材托管**；保留100生活储备。finance 从现有有库存且可收款的工业材料经营者实际购买1单位，记录卖方/报价/数量/税/所有权；必须有真实有权运输与实验室收货，不能购买即伪造跨城到货。不新增任何初始材料/钱/设备身份，也不把旧200全额 publicFunds 当作仍可支出余额。

有一份到场材料后，原120分钟合法现场研究才消耗该份材料并由既有完成权威颁发一次对应成果记录；离场/缺供/生活不足暂停、取消/死亡只退未赚托管并保已购材料归属，不能重进/冷读重复科研成果。保原七领域旧项目及所有缺省合同完整数据/事件；新合同留明确定义/启用来源，保存校验要能重算钱/材料/阶段分钟，并在原预算边界内拒绝再承诺。其闭环仅证明一种有耗材的科研活动，实验失败、协作/专利、企业购买/安装产业设备和其他六领域仍未完成，不能再将一个等级增量当完整知识产业。

两个建议共享原事件/资金/实体接口，但业务与候选目录可独立推进；不规定全游戏四阶段顺序。正常通勤、真实公共预算、全城供应/夜间闭门、自然生命周期和参考画面继续是整体目标中的其他工作。

## 来源及交付边界

下列SHA是生成报告前的实际文件字节读取记录；共享源由根并行推进，本报告不声称冻结全仓或整个功能图。已有源码事实以所列路径/行与SHA为静态时间截面，提案均未安装、未运行。此次没有上传Library、封包、提交、推送或宣称38域完成；该文件只交根汇总。

| 输入文件 | SHA-256 |
|---|---|
| AGENTS.md | `f98729175106aeb60651166555d03c7a0d53c119c33371adc9956928c7f830f7` |
| 提示词.md | `4ec0aa0731002723c49d580c8a2e90c828e4292ea9ca79fe59be8c825cfe8d89` |
| 开发备忘录.md | `c8c8a0fbac16bcc7df5c6aaca18c8b68b40f841bce49822aa7c4d9ff2a3569e5` |
| docs/validation/2026-10-07-city-life-root26-food-access/REQUIREMENTS-38.csv | `9253df699bd3d69a13a3c3d346cb836eed39cf7bdcb429bf67d06da874cdbe0b` |
| src/main.ts | `962c6b667042ad6d6f7dc133b575474692aba704dd9562f5e600caa952b143e6` |
| src/world.ts | `86fa141189d7467501871f5c3940567df3fc841eb68e84ad805d6bfb3d69bfc3` |
| src/product-city.ts | `f9f681ad921444dcbbeb9478e111e6fb13350ef43f4fc3810f366b9404eabbee` |
| src/types.ts | `5aa1fec552ab1677ecfd4ca31903df3b0bd386daba0af98ac9fe3537a8344cac` |
| src/simulation.ts | `adb1abae98e72c1c7040108495e7f445547a05adbb1dfa8546183020dcf02bc5` |
| src/simulation/power.ts | `1863c2d9b6c2e06a0843b8ad9e46dd8face5774f9c1c4922f600f62d2c3fe1a5` |
| src/simulation/power-grid.ts | `d7bcba3fb2fb74ab2e2932497a7b10865e2e674b6fa01b230f2e0873e933170a` |
| src/simulation/power-grid-hydro.ts | `d610dda2969194cbffe689c787183a7110794906b27f9781ea3c7de57c4551e1` |
| src/simulation/hydro-maintenance.ts | `7b3b59e835deeb3d82fce9c473b4d0eb2539f640236280cdb17d8a77d534023d` |
| src/simulation/clinical.ts | `ff3af7225e40b55906a4f5da5e1f213ac894c2aa523963566e1dfc19f2b3bbc8` |
| src/simulation/pathology.ts | `8f76ef5e18f1b3a5ff042857a77547a566b5bbfb9e2c4400a1d9632398063005` |
| src/simulation/extensions.ts | `0890b274c17abbe2b5e50bb24c151ec13928f3cb3c8bd4bfb4a632478a845bc0` |
| src/simulation/governance.ts | `eab0fa32335d8b13d9443e4e4a8109958ff0cfe148150997b5f7e75828715de1` |
| src/simulation/civic-staffing.ts | `b1926fb4f5ef7b115c2b58cc1f271038049268a068ad0da667debe4e96a1c4a5` |
| src/simulation/budget-authority.ts | `ab14d14f6cf5dd3406e52d3ebdfdda43f46a14c598c1f3a6877a9671593f53ef` |
| src/simulation/culture.ts | `2ea4f94b5876a06826bdb0f4249c31dfd4c35290ed1702c0d3191862f37ca831` |
| src/simulation/education.ts | `dd647c997d1697bff1cc99f63ee097aa08da5d68b971ff5834b5c174ae670d97` |
| src/simulation/family-education.ts | `1a0f86b640d1b9252b554707389779a96827f7d13111cf54e8d38a3989774557` |
| src/simulation/resident-education.ts | `643acfb3de2779e5d2c714fd8565bf99743b8d6e63107c553db4d8a1e2c5847c` |
| src/simulation/family.ts | `c3af107f15d4bdafd3e61afa249f0fe68db0e384e5e4ffdb9cafb57e132546fd` |
| src/roads.ts | `194a9a9adeb16299008056f73465d41e8ee0451de258ceabc8c9963da4ac5d90` |
| src/simulation/roadworks.ts | `570c63879b14f0160f56d357c87140855e61c655c396ec5e2c2eeaeaaa4cf09b` |
| src/simulation/road-demands.ts | `773299af9510dab1a7d42969663889a89f3bd1a2112c15e1d3069bb6df1b1307` |
| src/simulation/hygiene-public.ts | `1f02613e705aeec6432c2e5fe40e958a9da8d5b260d261441a6a5b95bd5af350` |
| src/simulation/building-alteration.ts | `cd81f9ccb6c2e30bff4ab5e6942360b2c322cbcaa5704ee064e043abdaffdc48` |
| src/ui.ts | `b7ffdc4c5c41255ee380a1f1624259abacee8bdd06d46e9eb6f5c9eea1561a4b` |

生成时间（UTC）：2026-10-07T13:02:12.238837+00:00。
