# ROOT14：完整议政历史归档接入默认新城市

本阶段完成完整议政历史的有限归档，并将明确的新城市工厂接入第一人称产品与默认经济审计。真实构建、原 UI 35 项、原浏览器 11 项、默认一天审计、完整及分块存档的未来 24 tick 已分别通过。17:08:55 UTC 已按源码 SHA 守卫安装到当前工作分支：304 个输入、71 个生产源，10 路径修改、9 路径新增、0 删除，7 个本次构建产物逐字一致。完整游戏目标仍未完成；美术仍 FAIL，经济稳态未建立，最新完整 npm test、默认新城十四日和 macOS 实机均 NOT_RUN。

原报告作者在独占目录只读核对源与回执；本交付版由根线程按原 SHA 复制、修正公开文件链接并补充实际安装、发布和 Library 回执。全部结论绑定原始源码图与运行结果。

## 目标与版本边界

完整目标保留城市第一人称生活、城内获得和驾驶飞行器、所有系统脱离 3D 后仍可运行、未来不同地图适配，以及居民身份、意愿和规则驱动的环境、建筑、卫生、虚构病毒、基础设施、店铺倒闭买租重开、拆迁安置和新路网、灾害。能源、医疗、科技、政治、教育、金融产业、家庭关系文化、美术与 Mac 性能都继续在需求矩阵中。旧固定四阶段顺序不恢复为硬优先级。

原共享基线是 ROOT13 `d95cf99b006bba4f31a9ab2a1980ac588fff9f64`，295/68，已发布实现 `17ad11d94029355207b52bce642e01f8f3747f1d`。ROOT14 原生产组为独立 CLOSED 304/71，图 SHA256 `b46bd775acae960939b3f9db63efd1f01b8d6f1948928c82b97966c59ef95b03`。根组合在该源上只新增当前默认工厂及 main、默认审计三处选择/观察变化，冻结图为 `5603eaaf84575d2d59a2886b186096a6916b84c4924cd1840bd10631e4daf129`。报告读入时两图各 304 文件都实际逐 SHA 匹配。

`createCurrentProductCity` 选择 archive-enabled 新城市；`createArchivedProductCity` 仍是显式入口；原 `createProductCity` 保持存档 3 API。当前新城市为 envelope4 / civic body2 / history1、`civic-local-v1`、motion2、`current-v6`，世界 fingerprint `b85fa6ec`。原 `Simulation(world)` 兼容默认和旧 1/2/3 存档载入不暗升、不补身份或历史。World 的原 612 建筑、616 居民、11 区、674 节点、691 边、商业楼层和原出生位置保持；新归档不改变地图、主职业、需要、速度、现金或选举资格。

原件入口：[冻结输入](root/FROZEN-INPUTS.json)、[安装回执](root/INSTALL-RECEIPT.json)、[原生产组报告](provider/REPORT.md)。完整需求及剩余验收见 [REQUIREMENTS-MATRIX.md](REQUIREMENTS-MATRIX.md)，原输入与报告前后守卫见 [READ-HASHES.json](READ-HASHES.json)。共享Memo的17:15新条目是根授权追加：原409119B/1382行全部作为后缀保留，报告团队全读旧文后又完整读此新增条目；该文档合法变化独立列出，不误写全部输入静止。

## 实现与有限容量

归档保留 proof/application/poll/term 的完整原始 JSON、UTF-8 字节、SHA、密集索引、页链、封存 tick/clock 与来源。统一 hot/cold 解析检查重复与全部费用、取消活动、实际实薪窗口、现场票、选民 census、任期来源和财政交叉引用。不是只留统计摘要，也没有删除取消申请、付费记录或历史工资来绕过 app64。

只有受信宿主 `exact-current-v3-SHA` 迁移可将既有 3 升为 4；普通命令和事件没有迁移权限。迁移先只读校验原档并核 SHA，准备完整事务，再一次提交；原非 history 投影、RNG、钱、职业、motion 和原法律规则保持。运行中归档在写 civic/history 前校验追加请求及两份预算来源；拒绝不半写，有限存储拒绝只追加一次本阻塞期间 notice，并保留 live 来源和原 cap。

每页 ≤256 KiB；完整历史含索引/元数据 ≤16 MiB、≤256 页、≤100,000 条记录；每记录 ≤256 fragments。非历史投影仍受原 8M 字符上限。事务追加封页可先耗尽页数，完整解析仍需 materialize 全历史。这是有界冷存容量，不是无限流式历史、全城统计卸载或真实数据库故障恢复已完成。codec 大 Unicode/超配额原子拒绝使用明确 `transportOnly` 非业务字段，只证明存储行为；自然 Simulation 填满配额及 live notice 分支未运行。

## 原四日、付款与资格来源

provider 使用真实 ROOT13 四日 app64 原档：3,015,592 字节，SHA `3640274b3e2234b793925a574f825615a89d9c168539d10960510f39f1e1c2c3`，tick1467/clock6348；实际 128 proofs、64 applications（19 已付、45 未付取消）、19 polls（13 closed、6 open）、13 active terms。原文件名提到 two terms，不能据文件名把实际全档改成只有两任期。这是受控 compact 城市，616 居民/198 初始官员，与默认 v6 一日不同。

迁移后 hot 为 70/6/6/13，cold 为 58/58/13/0；7 页保存 1,522,690 UTF-8 原记录字节，原费用 2280、登记 63 分钟和投票 1064 分钟保持。实际再运行 24 tick 新受理 65..83 共 19 申请，未产生新付款，4 个原 open polls 真实闭合。完整、分块、模拟 leased-session 保存及每个未来 tick 均逐字相同；原 native3 载入显式 4 工厂后关闭 history 并与原 24 oracle 相同。

`paid-source02` 保留明确受控不利输入：health=0/alive=true 的合法前件在真实 people tick 死亡；另一前件将工作地变为普通农场，真实下一 tick 检出转职。两者终止原 term1 并冷存，历史两份真实已付 V2 签名仍可追溯、当前权限不恢复，完整/分块再 24 tick 相同。原 `paid-source01` 的 alive=false/health 非零非法前件被 reader 严格拒绝，FAIL 保留，没有弱化 reader。

后续实际 app86/citizen352 在 tick1487/clock6428 本人钱包 `362.37793411871866→242.37793411871866` 扣 120，原公账真实 +120、两个实际付薪见证及 poll20 成立，总费 `2280→2400`；结束 tick1492/clock6448，全记录 176/87/20/17，hot114/25/3/16、cold62/62/17/1。没有注资或清历史。captured paid signatures 是 `ACTUAL_SOURCE_PAIR_NOT_FUNDED_BUDGET`：实际 fundedV2 请求→授权两份→拨款→采购→服务正向仍 NOT_EXERCISED；十四日到期/自然续任也未验。

## 原始 scope 运行账

所有结果分别绑定原 argv、原时限、receipt/raw、输入 before/after 与 PID/start-time 递归归属。报告静态复核 20 个 root/provider scope 的 before/after 全图相等；各 scope 关闭时 owned active 为 []，不推论未观察的历史全系统进程。根 wrapper 原实际 cap：build300、legacy120、UI1200、browser1200、oldfactory120、day1800、fullpartition300 秒；wrapper SHA `c53609fd7a6b132768b01b66a4206ac0a018658734075d558a7299a0d7dfe9cd`。UI/browser 内部原90/120/20/30/60秒期限及driver逐SHA保持；外部独立wrapper不是放宽原harness。表中时刻均 UTC。

| 根组合 scope | 实际结果与范围 | 起止 | 原 raw SHA256 |
| --- | --- | --- | --- |
| build01 | PASS，strict tsc + Vite；7 fresh dist | 16:00:45–16:01:14 | `2e24564967ca83f79eaf6a08c57fa67eab3ea39dae5f20bdc1ddfb57c8946fed` |
| legacy1-exact24-01 | PASS 原第8完整名称单选；1/1，107980.67 ms，旧运动/整档/分块/未来24 | 16:00:45–16:02:35 | `67458ba113b7c71c22e351100fef987fdaf9aecece228c07daff8141576d200a` |
| ui01 | PASS 原35 DOM检查，errors[]；legacy 受控 fixture | 16:05:54–16:11:28 | `e484dbb17133d2d3cf7f8eb72ed323e133c0a6c3629bba55c41dca14e433880e` |
| browser01 | PASS 原11/11，真实新 dist，errors[] | 16:17:41–16:27:46 | `581b8402168d44e814be4276575d7f80943761ad6287cbcbdd1be3e865c8d879` |
| old-current-factory01 | PASS 原1/2载入当前4工厂：旧版本、规则停用、立即整档/分块 exact，各未来24 | 16:30:37–16:31:41 | `31a61d44934502354756e8b5dfc46ba74730f3939da7193f46806552f2509d96` |
| product-day01 | PASS 默认无 ruleset 参数，一天720tick/1440min/8x及原终档立即/+24 | 16:37:13–16:53:26 | `4cd708f42cffb63cbafb737a8864c82e79e8593bcadf75f04bb07e5ca30b6153` |
| default-full-partition24-01 | PASS 原默认终档124parts/1history page，完整/分块及每个未来24 exact，原v6完整World相同 | 17:04:39–17:06:41 | `cfec2b091b8c3ab46301568fd4558355f25476ecc07a1201d948c4b126d678a1` |

构建实际入口 `/assets/index-kEBeq3AA.js`，1,201,108 字节，SHA `5946888520aca0e55eae78147a1a93645f74fe42860b1366cdeef2324a36a9bf`，安装的 7 个 fresh dist 与原 build 相同。UI 使用原 legacy controlled fixture；browser 使用真实新 dist，但身份、部分位置和交易前件受控。old-current-factory01中旧2未来24核原独立oracle；旧1是原字节导入后与保留legacy constructor当前continuation对照，不冒独立古引擎future oracle。浏览器通过实际 W、购买、保存恢复、驾驶、军机原生键控起飞/返航/落地/退出、无人机 24 费用租赁/飞行/终租，不等于普通出生自行获得职业到全旅程。环境为 Linux Chromium/SwiftShader，不能外推 Mac 或 FPS。

provider 原 13 个 scope 全部保留：typecheck01(301)/02(302) FAIL；03(302) PASS；codec01(302) 4/4 PASS；type04(303) PASS；migration01(303) 5/5 PASS；type05(304) PASS；paid-source01(304) 1 PASS/1 FAIL；type06/07(304) PASS；migration02(304) 5/5 PASS/cap300/raw `b60dfc74036e26bdc1f0daf42bbc61897c692d0c5c30921b05edcdd1689aef13`；paid-source02(304) 2/2 PASS/cap120/raw `7117bbce8a0bb0d60d82ce09095d3a82ee10a3daafcdcd256d11a06f8177233a`。其余 type/codec cap120。

原 `legacy-ruleset01` 整9套 cap120 为 TIMED_OUT_PARTIAL：前7完整 PASS，第8未完成、第9未到，raw `bb28485d971894b0e6e4cd7f912eca0dfe7029471bb34df05b7677aeb0ce7ca6`。根单独第8 PASS 不把该原整9套改写为 PASS，第9原单项在新图仍未单独运行。不同图分项不合计成最新完整 npm test；旧学校 93 PASS/1 byte FAIL/1 SKIP、旧政策第11 FAIL、原 day 坏档/timeout 等保留在旧原件。

## 默认新城实际一天

默认 CLI 无 `--ruleset`，requestSource=`product-default`、cityStateSource=`new-city`。有限开局、全部工资、科研、现金守恒断言保持，实际 moneyConservationResidual `−1.4551915228366852e−9`；616 居民在世、0 死亡、玩家在世，12 公司/0 零资本，1 科研真实本人 200 投入。

国库 `80000→72688.81129934225`，下降 9.13898588%；NPC 现金 +1.4640536%。公共实付 8508.2684、私营实付 6557.5353；终点 `wageArrears.public=0/private=0`，`publicEarnedNotDue=1366.2115628558938/privateEarnedNotDue=410.14547796683894`。原审计 `economicTrend.unpaidPrivateWages=410.145477967455` 字段保留，但含义应按明确终点字段解释为已赚未到期工资，不能写成逾期欠薪、国库拒付或 240 人无钱买粮。available 公共预算 56645.982605258345；这只说明此刻正余额。`steadyStateEstablished=false`，不能以一次登记收入、生存、守恒或正预算宣布经济可持续。

实际 food 125.94804409/material 521.35778949；零售 food915，counter539 + carried56 = 595 observed meals；终店 food15420.94804409、居民携粮320。farm 有 9611.8597556 certified funded minutes，但库存高于 target120，0 farm 正产粮；dock 有 5608.8234 分钟和正食物产出。混合 production647.3 不能当全食物；理论每日需求约852.923不能当实际消费。

当前归档 **cold-only** 为 1 页/25,165 UTF-8 字节、13 proofs/13 applications、0 polls/0 terms；13申请receipt=null、cancelled expired-proof1440。hot为4 proofs/4 applications/4 polls/0 terms，4 hot receipt真实paid480；完整hot+cold才是17 proofs/17 applications/4已付poll/0term。两天投票条件还未到。cold totals 不能当全部 live 计数，也不能借 provider compact 的17terms声称默认城已选出议员。

原终档 [root14-product-default-day-final.save.json](root/product-day01/original-artifacts/root14-product-default-day-final.save.json) 为3,304,414字节，SHA `852dc8fc41e2ad5c2addb14fd07fba08f70828af71ea31997336e82142fa8feb`。原审计立即读回相等，未来24 SHA `cd1c8da379a4667dba6d3d9317c6a21547cb3fc354b9fff7c4267f14ed17bab4`；独立 full/partition scope 用相同终档、124parts其中1historypage，逐 tick 相等且终 SHA 与原 day driver 同。原 [审计 JSON](root/product-day01/original-artifacts/root14-product-default-day.json) 与 [分块摘要](root/default-full-partition24-01/original-artifacts/summary.json) 是可核原件。

## 食物通路与站车独立边界

食物只读 CLOSED 审计使用 ROOT13 原终档72ce8b…，不冒为 ROOT14 新一天新模拟。240 饥饿无携粮者全有当前开门、有货、能付目标，189 moving/37 riding/14 physicalWaiting；674节点一个 road component 只证明图连通，不证明身体最终到柜台成交。14 原门坡腿的端点最高头高被旧 guard错误套到门楣交点，是来源已定位的假阳性。

独立 building-sweep candidate02 297/69、23纯规则+strict tsc PASS/raw `1d4397244247ca8c88e479843100e69789627dc31676746d35223f60bdf9b4a3`；真实原14腿5451次实际源Box检查两套足部政策都无新连续碰撞，降低门梁的强反例仍阻。首01的11 PASS/12 FAIL/tsc NOT_RUN保留。helper SHA `9cb9693aabbb58abc267d5251c89404ab38584f1302296191a560c4520d6fe7f`，只支持固定坐标/线性脚路径与 Box；没有安装、没有接流量，没有实际14居民跨门→购粮→需要恢复证明，也不修乘车后下车问题。

独立道路 v9 最终候选319/77，真实旧转移/W和市场两侧出口 FAIL；新7项 exact rational 完整圆足**投影**纯规则及strict PASS，不证明 grounded contact。旧转移实际碰护栏/rail；同市场节点车型重叠Y52.6，低泊位方案最多切土11.6623476m/grade恢复 FAIL。Y66四新泊位/214m步廊只是未安装设计。native4接合、state/fare/FIFO/holds、费用占位完工提交、实际身体全旅程、建筑/地形/其他车辆实体仍 NOT_IMPLEMENTED；不能把有限几何组写成 transport/game PASS。当前 ROOT14 产品仍 v6，与 v9 图独立。道路组17:09已CLOSED；根随后独立逐tar成员解读核验PASS：source319包11,203,324B/SHA `40f00405fa6e18d4121ab10138c0d05cfe18285b0f6a85c55a4be28b68ef4a74`，full2945members包13,035,088B/SHA `12493d2ecc8dfdd04531d349091f726181cce59dff90d3b90a239be009b18ec1`；regular及安全前向已见hardlinks按内容逐SHA同原完整源/证据。这些实际原文件已拷入public ROOT14 delivery目录，是可Git交付文件，不是只留容器路径；v9仍未启用。

## 原截图与美术验收

本报告实际查看本次原 [day.png](root/browser01/original-artifacts/day.png) 和 [interior.png](root/browser01/original-artifacts/interior.png)。出生桥/站棚遮挡仍明显，街面空且重复，室内家具粗疏、细节与用途气氛不足。有限照明改善不改变参考 ART FAIL。原 [night.png](root/browser01/original-artifacts/night.png) 保留，三 PNG SHA 分别为 `c2c55953a8d787bd0d2b0297d6bcab034536c2cce7ce0e7b25458abd05ea4150`、`65094ce12fbf75325043ac8b0ac82424590efa0681936e7ad53a1724f1cf0b96`、`dbe2164f1a06b1453569e69e6ef1ce119acd8335c86deb799328c39a0aca3fd4`。PNG 是实际功能运行截图，仍不能替代 Mac 性能或完整美術通过。

## 交付和可直接接续工作

已完成本地守卫安装，当前工作分支 `takeover-city-life`；最新提交、push 与远端读回 **待根线程依据真实 publication receipt 补充**。根授权仅本地实现和当前工作分支 commit/push；main/PR/merge/部署/付费/安全共享无新增授权。本报告作者未做发布操作。

ROOT13 Library 唯一 ordered16 批的旧事实是 tools/list 保存前网络失败、新ID0、memo version5未替换。ROOT14 三张真实 PNG 已实际保存到 Library，返回三个新原生 ID；其余文件和 Memo 替换仍待实际结果。云skill catalog不可用与直接Library app能力是两项事实：根线程已实际完成harmless library_list及native memo读回（原memo version_id字符串5/286307B），当前host-upload create/replace路径已可调用，后续其他原件及最后memo expected5 replacement，最终成功ID/替换结果由根真实回执补充。ROOT13旧CLI tools/list网络FAIL保留，不转称本次ROOT14上传失败；本草稿不假附件。可本地核验原件及Git fallback已经准备，后续成功上传/推送单独安全回执，源码cut和CLOSED不倒改后续结果。交付辅助检查的失败事实也保留：首provider成员检查把virtual source-overlay误作同相对路径文件而FAIL，后16:50的明确映射恢复校验PASS，13原scope图逐SHA重建；根collect首以whole stat比较包含读更新atime而停在第六文件前，5已复制原件仍exact，空目录重试守卫再次拒既有5文件，后仅逐字相同复用完成原收集。失败回执仍为FAIL，原件未改；这些打包结果不算业务运行或测试PASS。

接续不是固定四优先阶段，按来源依赖和真实失败选择并行窄切片：

1. 在新命名空间接合连续门坡 helper，仅新物理规则门控；保旧1/2/3行为/坏档拒绝。用原14人需要、钱粮、目标与真实前件观察跨门、完整路程、到柜台扣钱库存税及需要恢复；分别验证189 moving/37 riding，不凭图连通认成交。
2. 基于已封 v9 图处理市场真实泊位/转向和全部实体，先实现真实连续 grounded 支撑及动态碰撞，再接版本独立 cursor、有限门动画、holds/FIFO与完成后费用占位。66m方案需真实地形、基础、建筑、护栏门和车角扫掠验收，不能直接设新默认。
3. 使用既有自然同厅实薪两议员、真实有限财政和真实短缺触发 V2；逐记录核 request→两份授权→款到账→合法具名供货→真实师生或医患现场分钟→结果及full/partition24。保留没有自然价格触发的现状，不制造请求/报价/资金。
4. 在真正需要长周期验证时，以新默认4图运行十四日届满/续任及财政、食物、岗位、企业和玩家生存；记录坏档/cap/存储拒绝。当前一天是短期回归；不能借旧244十四日（居民616活、玩家死、公库−74.35%）替代。
5. 同时逐领域推进物理输配电、完整医疗与教育产业、自然虚构疫情和卫生末端、结构火震/救援重建、整栋产权安置与新拓扑、家庭文化、真统计/流式及另一地图诊断。美术用合法原出生/连续走路/室内原图对参考验收；Mac Safari/Chrome/Firefox实机操作与CPU/GPU/帧时间/内存单独测量。

源代码ZIP已由根独立验证：316原文件+1filemap、13,658,167B，SHA `f086c8686d3a70b14a2006d225a60257db5a2d12e421b5691c9eddcd5bee6242`。根已复制289个选择原件到公开ROOT14文件目录，历史/道路两个完整原件包另保；不能合计为测试数。literal credential-shape扫描616文件及展开tar/zip为0命中，只是字面模式检查，不是语义安全审计；报告/矩阵最终文件需根交付阶段追加扫描。

最终发布补充位：`ROOT14_COMMIT_PENDING_ROOT_RECEIPT` / `ROOT14_PUSH_PENDING_ROOT_RECEIPT` / `ROOT14_LIBRARY_PARTIAL_IMAGES_REAL_OTHER_FILES_PENDING`。本阶段实现与相关运行可交付，不宣称全部目标完成。
