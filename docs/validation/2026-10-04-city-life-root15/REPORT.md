# ROOT15：真实城市生活闭环集成及未完成范围

截至 2026-10-04 21:35 UTC，完整游戏仍未完成。原14名居民真实购粮与需求恢复、6名公共教育消费者钱料与劳动闭环已通过；公共医疗 actual03 在原240正常main帧界内 FAIL，耗材和治疗均为0；租户第三轮经营 NOT_OBSERVED，候选未安装；美术总体 ART FAIL、macOS 实机 NOT_RUN、默认新城长期财政稳态未验证。完整 [38领域矩阵](REQUIREMENTS-MATRIX.md) 保留全部目标，不恢复已排除的固定四阶段排序。

本轮开发基线为工作分支 `takeover-city-life` 的 `f1e26ff6d8d440f2e35b4a67337364bb61cd8f77`，最新main为 `6955d374a7d5bd928d2dadf4d0fdda74d416ca57`；冻结输入图是逐文件内容哈希，与Git提交SHA分列。用户已授权正常工作分支commit与push，主任务将保存本阶段实现和实际证据；最终提交及远端确认以实际Git回执为准。报告整理不产生新的Simulation、GPU、构建或测试结果；没有main合并或部署授权，本轮Library保存失败。

源码图与实际运行归属如下。三个318图都含78生产源，旧图PASS不能冒后续图已运行。

| 冻结输入图 / 来源 | 已发生的运行与结果 | 验证边界 |
| --- | --- | --- |
| 原集成图 `5a519d7ad1a6dc02d4179830862d5f8859e4cb3c42d55deac19482acb9577f43`；`ROOT15-game-integration-20261004-01` | 37/37组合规则、build、6公共教育消费者、browser01的11项功能结果PASS / errors[]；公共医疗封存也使用此图，actual03 FAIL | 没有完整npm test或默认新城日审计结论；不能冒后续图browser完成 |
| 最终业务修复图 `7e3e32e4e01d99da59954950caaea87d4c2ed9c8a6a43e0437d8d295fbc64989`；`ROOT15-final-integration-20261004-01` | build01 PASS；独立helper原17项纯回归修后17/17 PASS；完整原npm test / isolation=none OOM、exit134、FAIL | 纯helper不证明真实医疗或日供需；新dist未由旧browser认证 |
| 当前测试隔离图 `b5b126b81c81726c85e6c6d7ac1ff486c2ede464aa5deb2825ba405ff861eff3`；`ROOT15-suite-isolation-20261004-01/source` | 相对最终业务图只改package.json test CLI；完整npm test已开始，cap3600，截至本报告仍RUNNING，无最终回执 | 不预报完整PASS或全部资源问题解决；UI、新日审计、Mac未新增通过 |
| 门与购粮候选，312输入/76生产源；`ROOT15-door-food-integration-20261004-01` | door16-03、food-meal01、旧native4 negative24-01、新双policy partition24-01各自PASS | 窄运行不冒318最新图完整重跑或全城全部居民恢复 |
| 租户私有候选，baseline304/71、最终311输入/73生产源；`ROOT15-tenant-reopening-20261004-01` | pure10/10、compact4/4 PASS；default120 TIMED_OUT_PARTIAL；两段各256普通步第三轮NOT_OBSERVED | 候选未装；不能宣称第三轮完成或默认验收通过 |

冻结输入见 [最终业务318清单](evidence/FINAL-INPUTS-318.json)、[隔离318清单](evidence/ISOLATED-INPUTS-318.json)、[隔离变更回执](evidence/ISOLATED-SUITE-FREEZE.json)。[独立集成审查](evidence/INDEPENDENT-REVIEW.md) 列明修复来源。[所选原件复制回执](evidence/SELECTED-EVIDENCE-COPY-RECEIPT.json) 逐文件记录私有来源、字节数和实际SHA；它证明复制文件与原件相同，不是全套通过manifest。R13/H14/D14/F14/C14/T14等矩阵旧证据沿 [ROOT14报告](../2026-10-04-city-life-root14/REPORT.md) 及 [ROOT14矩阵](../2026-10-04-city-life-root14/REQUIREMENTS-MATRIX.md) 原范围继承。

原14名居民的恢复已实际发生。food-meal01在最多512原tick中的169步达到逐人条件：新23笔即时柜台收据，另明确继承door16原2笔，14不同目标均实际购买并恢复饥饿；继承两笔不归新mealpolicy。每笔钱、店库存、成本、利润、税、hunger+52和携粮均逐事件核对。现金最大残差 `1.2223608791828156e-9`，粮食残差 `3.922195901395753e-12`。新双policy全档/124分块立即逐字相同、未来24原tick每步一致；旧native4无新policy的24步终档SHA `cd1c8da379a4667dba6d3d9317c6a21547cb3fc354b9fff7c4267f14ed17bab4` 与旧oracle相同，旧档不暗升。[购粮回执](evidence/food-meal01-receipt.json)、[原raw](evidence/food-meal01-raw.log)、[旧档对照](evidence/negative24-01-receipt.json)、[新档分块续演](evidence/partition24-01-receipt.json) 保留；这些不覆盖剩余居民、玩家门坡/屋顶或所有未来路线。

公共教育6人有限闭环通过。原预算40耗尽，唯一V2 cap11请求来自剩余 `1.280796685` 单位乘真实offer单价7.92估价；两名同厅、当前实薪、在任委员合法审批，实际追加支付 `10.040936508675475`。6份真实生产材料被采购消费，6名消费者各完成60分钟、老师实际获薪，全档/分块未来24每步精确。私有309候选和原318集成同原driver分别通过，raw SHA `75e64f9db6a6e24884a0c626cd4bf16817fd1fc86b7dc31b6a1120a23388b189`。actual01/02原4/5服务FAIL保留，没有扩大1100tick界、每订单4次请求或cap160。正例来自声明的compact-world与既存实际资格来源续演，不是默认全校自然覆盖，不能替代医疗证明。[教育摘要](evidence/PUBLIC-EDUCATION-ACTUAL-SUMMARY.json)、[集成回执](evidence/integrated-education-actual01-receipt.json)、[原raw](evidence/integrated-education-actual01-raw.log) 可核对。

新城async `createCityLifeProductCity`显式启用reference/meal/service三项规则，同步旧工厂与旧档语义保留。分块字段顺序曾静默丢业务字段，原0/2 FAIL已保留；修复对每个重排object校验完整keyset、字符串和唯一性及完整envelope，修后组合和真旧1/新档来回通过。[原失败raw](evidence/partition-order-before01-raw.log)、[回执](evidence/partition-order-before01-receipt.json) 不倒改。

独立审查另发现两处边界，主任务已修复：archive-v4审计原误选带新ref/meal的current工厂，现选实际archived工厂并断言双legacy、service absent；active服务耗料后余料不足一份，原helper仅识别awaitingSupply，现允许合法新offer提前触发原采购。17项纯回归由原12PASS/5FAIL修后17/17PASS；畸形quote桩的finite positive守卫不代表真实商户曾报Infinity。此修复只证明选择器/唤醒边界，不解决真实工坊断粮停产。原失败和范围见 [独立审查](evidence/INDEPENDENT-REVIEW.md)。最终业务图build01于20:29:58—20:30:25 PASS，raw SHA `e311d61695af7c5c50050a898e9db67bf21a3097e6be74f3c6a4a15fe163e1eb`，见 [回执](evidence/final-build01-receipt.json)。

原完整npm test FAIL已经确认：最终业务318图上20:33:19.446694—20:45:19.759837 UTC退出134、timedOut=false；raw包含约4076MB附近GC和 `JavaScript heap out of memory`，318输入前后稳定、owned active[]。raw SHA `2473a9aa29be0b9f4612535061fb788f91be85db701c3d2e5f335013f91d7b3a`；前段个别PASS不冒全套通过。[原完整失败raw](evidence/original-full-heap-failure-raw.log)、[回执](evidence/original-full-heap-failure-receipt.json) 留存。

新CLI为 `node --import tsx --test --test-isolation=process --test-concurrency=1 tests/*.test.ts`，原117测试文件、断言、seed、glob和业务时钟保持，不增heap、不扩整体cap3600。逐文件子进程释放跨文件模块/世界缓存，同文件内部共享仍保留。只读审查解析131测试侧模块，未发现默认suite必须跨测试文件共享实例的具体依赖；原条件旧fixture通道及相关skip仍保留。静态审查没有运行测试，不能保证单文件或全套不会再遇资源失败。[隔离只读报告](evidence/test-isolation-review/REPORT.md)、[package和原失败证据](evidence/test-isolation-review/root-evidence/package-cli-and-original-failure-evidence.json) 明确边界。新完整运行最终exit、计数、耗时和318 before/after等待主任务实际回执。

公共医疗本组已SEALED，患者证明失败。它使用原5a集成318图、原有限公共服务参数测试世界：world SHA `abce713388422385a3754fc8d760745526d95fdb4268546057e5a748d8df6ea1`，opening-policy4 SHA `8c5a8ae47daed0b3e4f45225c2a45ee7d5fdb2a83b95eee788cd07cd3e01b7aa`。世界虽保616人，但只有一工坊和11个互不连通NPC road component，不是默认v6新城日审计。玩家以真实Controller W/鼠标走352.231546米，买原可用5份粮、原就餐与付费休息；10手续费、32真实联署、24h回复、22/88当日同厅实薪委员授权40已发生。actual01时钟观察等式错误、actual02请求8份而原库存5的原子拒绝也保原FAIL。

actual03从actual02真末档SHA `afd03a931a4608aa9663d412e2b5487916057a05ec315a4fc55bd0f1a86ea86d` 精确接续，未免费重置、改速或扩原界。累计240正常main帧/speed16，到tick2392、clock10048（day6 23:28），166.683226秒/cap600，exit1、timedOut=false、318稳定、owned active[]；末档SHA `74b488c8e3c39d762b90613f50c2cf97aa34bd89c54ef8027ebdef2f4cdeccce`。service-2仍awaitingSupply、target6/requiredMinutes20，spent/received/consumed/servedIds和卫生batch皆0。没有20分钟治疗，也没有治疗成功后full/partition未来24运行；1真实玩家患者未服务，原6目标未完成。[原失败摘要](evidence/public-health-player/actual03/artifacts/FAIL-summary.json)、[回执](evidence/public-health-player/actual03/receipt.json)、[raw](evidence/public-health-player/actual03/raw.log)、[运行索引](evidence/public-health-player/RUN-INDEX.json)、[阶段绑定](evidence/public-health-player/ACTUAL03-STAGE-BINDING.json) 可追溯。

断供有真实账料和终态证据：工坊39次生产累计材料 `35.0515243495`，教育6和运维 `29.0515243495` 全部消耗，终库存0、材料残差0；教育采购支出 `50.0409370574`、运维 `229.0067410098`。末公共财政有可配现金，工坊shop.cash为367.2975656，不能称公司capital；现金不会创造实物。8工人中7名hunger0、另一名48.8，均在家休息，无当前原门physicalWaiting；owner55也hunger0，工班仍day4而实际day6。farm owner11饥饿0、旧day5工班、粮0.6963545不足整份。本次NPC有限road tree到不了远区stock27粮店；玩家身体能经terrain跨区不代表NPC已有寻粮能力。[工人生产诊断](evidence/public-health-player/TERMINAL-WORKER-FOOD-DIAGNOSTIC.json)、[有限赠粮诊断](evidence/public-health-player/TERMINAL-GIFT-SUPPLY-DIAGNOSTIC.json) 保留，没有手改needs、粮、材料、道路或当天付薪授权制造成功。

HOST-only512仅type PASS，当前PAUSED_NOT_RUN；ref/meal不造粮、路、工时或当日工资。合法有限gift生活方案CONDITIONAL_NOT_RUN，只有零Sim W路线准备通过，真实远路1074.74米/896等效quarterframes超既有512，往返不能复用原day7医生授权。后续须另立NEW组和有界目的；封存/暂停来自主任务安排，不是用户禁止。[交接](evidence/public-health-player/HANDOFF.md)、[下一范围](evidence/public-health-player/NEXT-SCOPE-STATUS.json)、[封存回执](evidence/public-health-player/CLOSURE-RECEIPT.json) 已复制原字节。完整producer ZIP留在私有源，29,159,931字节、842 entries/840 payload、SHA `66d3689583330945030771be94a2b3149c4e0efae9b4ef34da38358484b4cf6a`；public目录只复制必要小原件，ZIP未放Git。[producer回执](evidence/public-health-player/PRODUCER-RECEIPT.json) 给完整原包路径和校验来源。

赠粮权威命令另有已确认P2空间接触缺口：gift只要求双方三维距离≤24米，上游UI/main和17个扩展handler没有补上同floor、目标空间ACL或两人间实体墙检查。原有限扣1粮、活人、敌意与10游戏分钟冷却存在，距离球却不能证明身体能真实交接。只读审查以原保存大厅描述符、零Simulation纯几何确认两例：公共层与不可访问行政层相距3.8米；同层合法支持点间1.6米有原实体墙，二者均不会被原UI/gift距离谓词拒绝。它没有执行gift、改居民位置/needs或证明任何实际患者消费。主任务另NEW私有接触修复候选尚未安装、实际command未运行，不并入正在运行的b5套件，也不把医疗赠粮方案写成已完成。[原只读报告](evidence/gift-contact-review/REPORT.md)、[证据索引](evidence/gift-contact-review/EVIDENCE-INDEX.json)、[纯几何原结果](evidence/gift-contact-review/root-evidence/pure-geometry-results.json) 已按原字节复制。

租户候选正式CLOSED，未安装。pure10/10、compact4/4各自PASS；default全图24步原断言输出1PASS并exit0，但单项121.495777秒超过cap120，scope为TIMED_OUT_PARTIAL，不能验收PASS，不倒造分段计时或放宽cap。两段连续256普通步共512只有integrity PASS；第三轮困难、决策、重开或结束端点均NOT_OBSERVED。原条件为 `profit<=-600 && inventory<1e-7 && freeFunds<6.666666666666667`：前256现金条件全FALSE；后256低cash20步库存都为6，空库203步时freeFunds反高于阈值，原AND两段均0。亏损TRUE不能独立冒全条件或意愿/路线bug。押金50、advance200和租债工资债保留，未改门槛造正例；7生产文件patch SHA `d04fe9b6fc5d0a72dfa2d50ff1b9bc8383c5ea4c0a594e9404ed0df3e7f73928`，候选仍未应用。[租户报告](evidence/tenant-reopening/REPORT.md)、[HANDOFF](evidence/tenant-reopening/HANDOFF.json)、[default边界](evidence/tenant-reopening/DEFAULT-SCOPE-FRONTIER.json)、[前段guard](evidence/tenant-reopening/GUARD-DIAGNOSTIC.json)、[后段guard](evidence/tenant-reopening/FOLLOWUP-GUARD-DIAGNOSTIC.json) 可核对。

原45,149字节 [PRODUCTION.patch](evidence/tenant-reopening/NOT-INSTALLED/PRODUCTION.patch) 已按原字节复制供Git review/接续，未应用或启用；完整 [基线304/候选311关系及未安装说明](evidence/tenant-reopening/NOT-INSTALLED/README.md) 明确两张输入图、生产源和当前共享318图的差别。它不是当前318可整层覆盖的补丁，第三轮未验边界保持；私有OWNED.patch不冒共享drop-in测试。

图形功能与视觉目标分列。只改3renderer材质文件；全612楼近/远1224组合885111潜在几何项投影保持，暖石、木、深青瓦和粗糙度/浅法线在原5a图browser01验证。19:53:23—20:03:15 UTC，11结果/errors[]、318稳定/owned active[]，cap900与逐项deadline未改；harness SHA `e5e09812badada0731f289dc2d9e717c9ad7bb25b208729fd535dd2b2232d082`，raw SHA `3a5e099efcdc7a658371fa7306907842c3a176605b3553e99f41974a92dc4e69`。入口 `/assets/index-Bt_pf_LT.js` 1,214,805字节、SHA `9aa78f1a4d1324ab54bdfb8894e1d3b55f4ce7796b60124ecfad240436887298`。原生W、驾驶、VTOL和租机返航退出属Linux Chromium/SwiftShader功能；受控身份/交易位置/地面前件仍明示，普通自然全旅程与Mac未由此验证。[build/browser绑定](evidence/BUILD-BROWSER-BINDING.json)、[11结果](evidence/browser-results.json)、[raw](evidence/browser01-raw.log) 保留；最终7e或当前b5新dist没有冒称已验证。

原 [day](evidence/day.png)、[night](evidence/night.png)、[interior](evidence/interior.png) 是实际游戏截图，实际SHA保留且主任务已查看。出生桥/站棚遮挡主画面、街面与家具偏空偏粗，参考目标ART FAIL，没有用概念图替游戏或GPU功能PASS冒美术完成。

Library本轮prepared multi helper在tools/list前network失败，exit1/stdout0，无prepare/finalize确认、新Library ID或memo version8确认。[实际失败回执](evidence/LIBRARY-DELIVERY-FAILURE-RECEIPT.json) 保留，started helper未改走direct。旧ROOT14成功19件和memo v7属先前交付，不冒本轮附件；医疗/租户child不调用Library来自主任务分工。旧审计“用户明确禁止Library”的归属错误在此说明，封存报告不倒改。

完整目标仍见38域矩阵：整栋产权补偿迁居/CityPatch新道路拓扑、结构火震救援重建、卫生末端、自然虚构疫情来源传播、具名物流、物理电网、完整医教科/文化家庭产业、整代生活、真统计流式/任意地图诊断等仍欠。ROOT14原默认一天结果仅属原图，steadyState=false；本轮最新默认日审计、十四日续任/长期财政、普通全旅程和Mac实机未运行。后续按实际source、raw、原断言和cap逐项记录，窄PASS、候选实现或归档不会关闭完整目标。
