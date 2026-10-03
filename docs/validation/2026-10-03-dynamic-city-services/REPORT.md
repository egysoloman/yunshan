# 云山本轮子系统交付报告草案

状态：**FINAL_STATIC_REPORT_ROOT22_SCOPED**。本稿依据已读统一21与最终22真实回执、原失败记录及根实际看图评审整理。09:22共享exact21/148后，10:28:46仅守卫接任命3文件，共享全部150执行输入与最终22逐字一致；HEAD仍aeca267/工作分支takeover-city-life，未预写新commit。最终工作分支commit/push、ZIP与Library身份见独立 `delivery-receipt.json` 真实结果。本稿只在隔离 `/tmp` 写文字，没有启动Node、模拟、测试、构建、浏览器、GPU、压缩或Library，也没有改共享；当前相关功能修复闭合不等完整游戏目标完成。

## 需求和世界范围

原提示词、用户追加和原需求矩阵的范围全部继续保留。系统以权威 World/SimState、固定十阶段、真实身份意愿、资金物料、实际路线和现场分钟运行。2D、3D与文字读取同一权威结果；规则不靠模型播放动画实现。构造一个自定义 World 可以复用模拟核心，但浏览器支持的是五个 code-owned recipe，完整保存身份、物理用途点、设施能力、初始化与闭环仍有地图约束，任意GIS尚不能直接作为可信存档导入。

实际默认静态地图是 seed20261001/current-v4：4,400m尺度、11区、612栋、0.2m体素、674节点/691边；221住宅、109市集、32银行等。静态World不含NPC计数，616是默认Simulation历史基线。605栋采用共享v4楼体，天枢阁和6亭保留原权威。天枢阁234m/30层/地下2层属于政治能源地标。商业普查只统计实际kind market/bank的141栋，最高66m/15层；按本次地图审查的≥80m或≥20层为0商业高层、≥150m为0商业摩天楼，阈值不是法律分类。中央现代CBD和商业摩天群尚未实现。用户后来用2D地图生成的卫星图是表现参考，世界布局没有因此更换。

用户追加的能源、医疗、科技、政治、教育、环境、卫生病毒、经营资产买租、拆迁修路、火灾地震和居民意愿驱动变化均属于完整目标。以下窄增量不缩减家庭、关系、文化、交通、司法、社会制度、航空、建造及平台目标。

## 本轮实现与已验证范围

| 子系统 | 最终22共享中的实际实现 | 已运行和验证 | 尚未闭合 |
| --- | --- | --- | --- |
| 能源 | 山洪会造成有限供能源损失；玩家100文托管或原两官员授权公共采购；真实材料与60已计薪现场技术分钟修复，取消保留材料及未赚款义务；原已付增能期限/旧档保留 | 21相关能源20/20；原生能源按钮场PASS，实际费用、材料、首段付薪分钟、取消、旧期限/display回拨/+24有回归 | 能源P仍是聚合量。实体线路、电表、电网连通/供电覆盖、停电空间传播与真实默认长期供能尚未验证 |
| 医疗M2 | 医患真实到场区间与当phase认证已计薪医生前段求交；保持30文、1真实工业物料、20有效分钟和公共+付费每医生两个并发槽。医生同一区间的union只认领一次，其余真实窗口可供卫生任务使用；有界医疗承诺提高处理频率，tier/速度/原needs分钟不改 | 原D1医生晚到、D2患者晚到同输入旧4分钟/真实可用1分钟失败，修后1分钟；21原旧pending未来窗口、二患者、statistical任务、原三临床强续演及坏档原子回归PASS | 新疾病药物商品、生产/供应/诊断、完整照护与长时可达容量未完成。D3真实历史64分钟输入NOT_READY，纯前段交集例只证明数学合同 |
| 店铺与经营资产 | 现存店铺的卖方合法同意挂牌、具名居民真实路线/付款取得经营权；七日同址经营租约、押金/租金、有限材料和60原计薪分钟修复重开；保原库存货权/工资债/托管/遗产 | 21店铺15/15；原生买卖、租约两场PASS；同148职业创业7PASS和原helper五消费者5PASS | 租赁的是经营权，不是楼房土地登记或房东建筑租赁；公司level增长不等楼体扩建。完整公司法定破产/土地产权/拆迁安置/默认长期就业偿付仍欠 |
| 治理 | 120文登记、逐人电子票、真实议员工资窗口/法定多数/14日任期；22任命100文从公库真实拨入既有org-guild职业团体，保护可用公共预算/工资承诺和受款余额上限，保原学历、角色岗位、冷却与账行，新增真实受款事件 | 21治理6/6/竞选原生PASS保；22任命14+治理6同轮20/20 PASS，真实旧21全现金-100反例修后守恒、旧档立即字节/+24与受款/工资预算守卫通过。Native08两100/guild200、两人普通153tick到岗、两个新工资窗口表决、119.75不生效/120生效tax.1/police.35、两实例完整save/+24 PASS | 原默认0议员场FAIL、07外部文案oracleFAIL保留。受款是培训经费拨付，没有免费学历或已完成培训；NPC完整竞选/自然14日任期/议会制度与财政覆盖仍欠 |
| 科研S1 | 七部门新标记课题具名研究者、原投资和120真实合法在场劳动；NPC任务细粒度处理不改tier；原实付工资前段和单actor时间容量，课堂先认领；旧unmarked pending明确 grandfather原deadline | 已交付S1原root17 build0/97、科研40PASS+2明确旧来源skip、真正旧pending单独2/2和真实CityUI4；21旧职业相关7PASS；20默认城连续三日tick2160产生原居民本人投资200/1完成及保存+24是原20历史PASS | 科研材料/设备产业链、协作/失败副作用/知识制度仍欠；旧兼容timer不能声称具新劳动证明。没有重跑21完整长研究 |
| 教育E1 | 40文托管、1真实教材、教师认证工资、公共+付费四学员槽、60有效课堂分钟后才+1；离场暂停、显式继续、部分退款复用、邻接课程保存守卫 | root18真实CityUI6、默认1x60课堂分钟/+24，REV04保存5及边界6、相关97/build0均属实际已交付范围；不再是付款即升级 | 课程体系/考核、儿童与师职深度、全城长期覆盖仍欠。原一次教师到岗定位为受控资格，不冒普通spawn步行到校完整旅程 |
| 卫生H2/虚构YV1 | 只由实际付费clinical耗材消费产生用品废物，站点容器8单位/溢出；真实材料与临床未使用的认证10薪分钟封存，原废物和清理残留均保留。YV1按具名来源和认证接触区间积分60分钟剂量，运行潜伏/症状健康负担/恢复/免疫，有界剂量历史与保存引用验证 | 21卫生23/23，原生诊疗20分钟→真实废物→真实封存10分钟PASS；受控种源、滚窗/免疫/钱料/死亡与保存/+24有定向证据 | 默认无自然YV1输入。现只paid诊疗用品，未接publichealth/civic/general垃圾污水；药品物流、化验诊断、清运与终端处置未实现。没有自然城市疫情、外来flight输入或疾病长期覆盖证据 |
| 表现与资源 | 程序化瓦面、近檐、床架/床垫/被枕、柜台分缝/抽屉；共享body/功能点/碰撞不因表现换规则；near释放/再进入保持真实变换 | 最终22另实际软件GPU75技术检查PASS/14PNG，page/console/shader/GL错误和警告0，150源/7dist首尾同；根实际看market/bed/counter与参考1，关键PNG与21同SHA，ARTFAIL；独占四PID退出/4206释放 | 根目视ARTFAIL：大体量重复街群、裸坡/空坪、粗树墙、盒状家具/瓦网格与过亮柜台仍偏离参考。固定桥结构图被前景遮挡且与旧图同字节；0合格新增外部3D资源，不能把技术PASS冒美术完成 |

公共预算、真实资金接方、物料所有权和已计薪分钟是这些模块的共同约束；没有新补钱、默认免费药物/资源、角色改造或模拟钟补偿。共享doctor两个并发患者是一个劳动窗口的服务容量，不能按每个患者重复消费工资时间，也不能把剩余标量分钟伪装成窗口尾段。

## 运行统计与失败保留

| 冻结范围 | 实际结果 | 精确限定 |
| --- | --- | --- |
| 统一19 | build0；88/88相关PASS | 原144输入的接合范围，不能代替20或21 |
| 统一20新相关 | 110总/108PASS/2临床续演FAIL，exit1 | 原148输入稳定，原log保留 |
| 统一20长合同 | 293总/288PASS/5FAIL，exit1 | 五计数为临床续演1、trained1、Chinese parent/sub2、worker1；统计含父/子测试，不能写五个独立production漏洞。其中三临床续演来自两个运行范围；其余需合法实体脚点、工作intent或既有经营权限测试前提迁移。原失败不回写 |
| H2窄修与统一21 | 新build0；十五文件132/132相关PASS；同148职业/创业7PASS；同148原helper消费者5PASS | 新H2首次激活只过滤零消费baseline，保正消费和既有body。132包括卫生23/能源20/店铺15/治理6/M2和geometry等；7/5独立scope可能重叠，不相加冒整套。没有21完整npm结果 |
| 21原生CityUI | 六场5PASS/1前提FAIL | 能源/经营买卖/租约/竞选/卫生五场通过，政策场默认0议员在按钮前失败。153原件/28PNG/38完整save/16按钮命令属root备忘录统计；一次资格位置、实际CityUI+Simulation，executedRenderer=false，不是自然第一人称完整游玩 |
| 21真实软件GPU | 75/75技术断言，14PNG/12不同SHA | Linux Chromium WebGL2/ANGLE-Vulkan SwiftShader；原六相机、合法床柜点、cutaway/释放再入等。不是Mac、硬件GPU、FPS或艺术通过；根最终ARTFAIL |
| 最终22构建与窄规则 | fresh build exit0；新任命14+治理6同轮20/20 PASS/0skip | 10:02:12—23构建，10:02:29—10:04:12规则；150源稳定，入口index-RNFo9pXU.js 848185B/SHA774ce8f7…；没有新完整npm |
| 22原生政策08 | PASS；657普通.25tick/164.25分钟、3原生按钮、10PNG | 两100/guild200全现金恒定，两具名居民普通153tick/38.25min到岗，实际两新付薪票、119.75/120分钟边界、完整保存及普通24tick双实例逐字。07仅文案regexFAIL，保原业务断言与首失败 |
| 22实际软件GPU | exit0/75技术PASS/14PNG、errors/warnings0 | 10:21:03—10:22:42；150源/7dist首尾同、四owned PID已退出/4206释放。根actual ARTFAIL，0新合格外部资产、没有Mac/FPS结论 |
| 本轮最终文件交付 | 见独立 `delivery-receipt.json` 真实结果 | 本报告不预写commit、ZIP成员数或Library ID；原成功和失败只按生产者实际回执记 |

20临床强续演的真实首差异是第一次H2激活时 `{}` 与 `{clinic:0}`，不是放宽逐字断言；21仅保正消费baseline，修后原三强例和native部分4分钟保存/首消费/+24逐字案例通过。原夹具INVALID、错误来源比较、首次FAIL和修正后的各scope都应保在最终包中，不能汇成一次无失败历史。


22任命诊断01只在一次setFocus导致tier变化的夹具认证处失败，未执行任命；诊断02保原成年edu2居民与真实功能点，仅一次初始合法站位后原appoint成功，全现金280736.15793671925→280636.15793671925的强恒等真实FAIL。原件保留。新候选首14为13PASS/1公共earned工资夹具假定FAIL，修为先真正出勤取得工资后按真实可用预算验证；不拼称作者原14一次全通过。最终root22另20/20才是新完整窄范围结果。

原生07已经真拨两100到guild、普通到岗和两个新工资窗口表决，其失败仅是外部regex期待“具名票/现场表决”而实际UI为“2赞成/0反对/需2/已批准，等候生效”。08只改精确外部文案oracle，不删除现金、票、到场、119.75/120或保存断言；638.25时真实应用tax.1/police.35。08当前资源ownedLiveNonZombie=[]、profiles=[]、4217空，少量已退出Z进程由PID1保留，不写全部DOM PID消失。

GPU22首次全局cleanup probe exit1只是发现与本scope无关的旧profile路径（birth10/2）；只记录元数据，没有读取内容或删除。scope02实际exit0/没有scope-created残留，四owned PID都不存在/4206空；只有Node startTicks被实际捕获，Vite/Chrome startTicks未补造。这个诊断失败保留，不是shader/业务失败，不冒全环境所有profile消失。

## 保存、世界和长期限制

原五个可信recipe、基础世界指纹与既有角色、钱货、岗位、订单持续保留。S1旧无marker extension含空jobs首次metadata迁移会改变初次export字节；新/已迁移completedTick档的+24逐字合同另列。E1缺body旧档在S1基线上不新增body/manifest模块；M2旧未标订单导入立即保持原字节和过去费用材料/进度/退款历史，未来治疗仍服从真实到场窗口。H2冷城无body旧save+24与首次真实消费激活的native续演都要各用真实输入，不借受控pin代替旧档合同。已有分页codec与大路线真实恢复是容量证据，Simulation仍全量个体。

原家庭29/29与270日托管孕育、真实共同居住/工资/FIFO食物/教育/继承基础已存在；这是受控多月功能运行，不是自然多年婚恋生育证据。原文化15/15、司法/航空/关系/日常仪式原实现均继续存在，本轮不能将它们列为空白，也不能冒完整社会文化体系完成。

本轮没有新30/60日默认城经济审计。原有限合同30/60日死亡60/372人、原现金跌幅65.14%的稳态FAIL及饥饿/供货/就业风险保持；一天真实合法支出或钱包下降应与资金泄漏区别记录，但不能因此改判为稳态PASS。未完成真实纯统计↔个体恢复、全城模拟流式、远关系聚合、后台/离线推进；没有macOS Safari/Chrome/Firefox真实设备FPS/内存/长游验证。

城市空间仍是稳定基底：方块build/demolish与公司等级升级不等整栋拆迁、扩建、新道路工程。真实封路、拆迁/产权安置、铺新路网、火灾地震的空间损毁/疏散/修复均NOT_IMPLEMENTED。物理电网、自然病原/公共卫生废物/垃圾污水及最终处置同样未完成。宏观地形、河岸、水系可辨性、机场航站与跑道的真实衔接、全城生活尺度和CBD不是测试计数能补齐的设计缺项。

## 下一可审的真实空间闭环

建议沿原只读提案，实现一个现有河道路段受真实洪水源损伤的完整案例：保存稳定edgeId/原因/状态、受影响范围和graph revision，禁止新进入；路上人车保真实位置、乘客货物和原目标，可合法退出/明确等待。NPC/车辆、controller、journey/导航和2D/3D/文字共同读取这一权威通行状态，primed图缓存与活跃route在推进前按revision重规划，不传送或清掉人货。

由真实居民维修意愿/合法身份审批触发有限工程订单，保公共工资预留、实际现金受款、原供货运输、物料与已计薪工地劳动；资金材料或到场时间不足就保持关闭，取消仅结算真实已赚/未赚义务。完成后发布同一恢复revision并真正允许通行。闭路中save/import+24、坏revision/引用原子拒绝、在途改道/合法不可达、部分退款、完成只一次等强例应验证权威闭环。首例可不新增/删基础几何，但不冒拆迁/新铺道路已完成。

以后真实几何改造需可重建versioned CityPatch、可信baseFingerprint和有效geometry/graph revision、实体引用/占用/安置/审批验证与原子发布；不能world原地改完仍输出旧基底指纹，不能重新构造Simulation而重置RNG、钱货和订单。本建议尚未实现、运行或验收，也不创建固定全局优先阶段。

## 统计出处与短SHA

以下短SHA用于阅读定位，完整SHA记录在本目录receipt.json；不是重新执行证明。

| 事实 | 原始出处 | 短SHA |
| --- | --- | --- |
| 原需求矩阵、其余原行保留 | `/workspace/yunshan/docs/需求实现验证矩阵.md` | `a815762a221b` |
| 09:48原草案的范围/21原生统计/ART历史 | `/workspace/yunshan/开发备忘录.md` 原草案读取身份，现备忘录已追加22事实 | `bc37460d5903` |
| 原完整目标 | `/workspace/yunshan/提示词.md` | `4ec0aa073100` |
| 默认真实静态612楼/商业阈值与0CBD | `docs/validation/2026-10-02-city-map-01/city-census.json` | `a48c724dcc9d` |
| root21全部148执行输入身份 | `/tmp/yunshan-system-coherent-21/source-manifest.json` | `a5a03f574b83` |
| 09:22共享exact接合 | root21 `shared-source-integration-receipt.json` | `336c41999f92` |
| root21新build exit0 | root21 `build01/receipt.json`；raw `04428d87f39b…` | `210757f03740` |
| root21相关132 | root21 `rulesnew01/receipt.json`；raw `8e51e0151ff1…` | `206d767fd70e` |
| root20长范围288PASS/5FAIL | root20 `contracts01/receipt.json`；raw `24081208c3dc…` | `8c556cf73a3f` |
| 职业7实际同148 | root21 `profession-worker-author-source-identity02.json`；作者target raw `5d2e4b607c45…` | `5938a9072c35` |
| helper五消费者 | `/tmp/yunshan-corporate-helper-consumers-root21-20261003-01/receipt.json`；raw `138a0e90ef94…` | `e4aba52c18b1` |
| 六个原生实际结果与首FAIL | root21 `native-dom-01-energy` 至 `native-dom-06-hygiene` 的 `result.json`/raw/resource回执 | 完整逐项见receipt |
| GPU75/14PNG实际结果 | root21 `visual-gpu01/result.json` | `e02495729c8e` |
| GPU独立资源收口/全部原图目视/ART范围 | root21 `visual-gpu-handoff01/GPU-HANDOFF.md` | `18adf9ee3dfb` |
| 最终22全部150执行输入身份 | `/tmp/yunshan-system-coherent-22/source-manifest.json` | `daf32d2cf72a` |
| 22新构建exit0 | root22 `build01/receipt.json`；raw `a6fca14e5be6…` | `25cd64196658` |
| 22新任命14+治理6/20PASS | root22 `appointment-governance01/receipt.json`；raw `6c8344014ecd…` | `7afadeab323e` |
| Native08真实政策全过程/+24 | root22 `native-dom-08-governance-policy-staffing/result.json`；raw `eb8c57b5013f…` | `d4e199908178` |
| Native08真实资源闭合 | 同目录 `resource-receipt.json` | `6d76ddb08eb1` |
| 22新GPU75/14实际结果 | root22 `visual-gpu01/result.json` | `6d0520fd0d9f` |
| 22GPU实际launch回执 | root22 `visual-gpu-launch01/receipt.json` | `eb2966d666d5` |
| 根实际看图ARTFAIL | root22 `root-visual-review.json` | `4ba2deef97f5` |
| 10:28共享exact150/仅3文件 | root22 `shared-source-integration-receipt.json` | `57ae714c7de5` |
| 原动态世界合同/洪水路段提案 | `docs/validation/2026-10-03-dynamic-city-static-audit/coherent14-mutable-city-world-static-review.md` | `4f8140aa46be` |

原M2、能源03–09、店铺01–03、治理旧失败及修正、H2REV01–04/两diagnostic epoch等原件的存在路径清单在 `/tmp/yunshan-dynamic-city-delivery-prep-20261003-01/original-evidence-inputs.json`，属于当时只列路径的静态预清单，未列入后来21/22的最终统计；原12合同FAIL、其他首FAIL/INVALID均不得漏包。最终ZIP成员数/字节/SHA/逐原件核/CRC及实际LibraryID由 root 生产回执填写，本报告不冒新包已交付。

## 最终源与交付身份

10:28:46 root依据旧SHA守卫只接 `src/simulation/extensions.ts`、`tests/appointment-funds.test.ts`、`tests/fixtures/appointment-old21-after.json`；共享全部150输入与最终22清单 `daf32d2cf72a…` 逐字一致，用户提示词与已有历史保留。没有使用22结果改写20/21的原运行身份。最终22新构建入口/7dist、20窄规则、08原生政策与75软件GPU均有上述真实回执；没有新完整npm或30/60默认城稳态。

工作分支commit/push、最终原件ZIP路径/成员/字节/SHA/CRC/逐原件核、新Library file/version/真实ID及备忘录版本：**见独立 `delivery-receipt.json` 真实结果**。本报告生产者不预写成功，不复用前次ID冒新附件。最终矩阵应用和本文原件身份由交付回执绑定；原FAIL/INVALID、as-run驱动、source/dist、PNG/保存与资源记录一并保留，不能为省包漏掉旧失败。

本轮完成的是以上子系统窄功能修复、联合定向和原生界面/软件GPU技术验收。完整目标继续开放，ART仍FAIL；动态空间、自然病原/公共卫生与终端处置、物理电网、默认长期经济、CBD/全城生活设计、完整流式/真统计、macOS等缺项均维持上述范围。
