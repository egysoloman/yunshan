# 云山 ROOT11 / ROOT12 集成交接

当前267输入/60个src已按264基线逐SHA守卫接入，第一人称城市生活实现继续保留。**自然一天与日末严格读档及24步一致性、构建、原浏览器11项均通过；完整游戏目标尚未完成。** 本报告为 2026-10-04T12:00:16.044119+00:00 的源码与交付快照，Library保存及工作分支发布结果另以最终publication receipt为准；此快照不倒写后续结果。

## 实际基线和修改

实际仓库 `/workspace/yunshan`，工作分支 `takeover-city-life`，本轮开始commit `a2e9cb1ab9e2455fe9a543bba23e31486bc21c16`。它是工作基线；10:23实际remote main仍 `6955d374a7d5bd928d2dadf4d0fdda74d416ca57`。没有重建脚手架、丢弃用户更改或把旧文档当任意发布许可。当前冻结入口为 `../2026-10-04-native-city-life/current-frozen-inputs.json`，对应本报告267；旧258与264原件及结论分别保留，不改成新结果。

ROOT11接入17个实现/测试/审计路径：六个真实旧门口受阻路线的完整绕行、原速度/3D耗时/身体净空、学生实际到场与教师实薪授课窗口交集、只读食品与建材/真实吃饭观察、原床桌柜材质与经营/库存反馈，以及资源回收。264组合六文件25/25、原医患2/2、构建及原browser11/11各有独立原件；这些是264结果，不冒充最新267重复验证。原95学校范围仍93PASS/1原基线字节FAIL/1原SKIP，旧18政策第11仍FAIL，未删除或放宽原断言。

ROOT12额外修复真实一天后终档自拒。264原坏档 `b0af5576bc587ed474d2a09f36e10f54a91666c5fef60ed6aa8929529dc20972`（2,974,315B）仍完整保留并严格拒绝。38个显式cursor均合法；唯一563合法身体的planned floor route把起点z `-2.4499999999999997` roundtrip为 `-2.45`，差1 ULP。新native2 writer精确保留真实from bits及缓存原点；旧v1逻辑、身体/相位/权限/速度/预算和reader守卫不松动。当前simulation SHA `39b445dc1554bfe3fa1f77c03adb99817d876e84fa042f2286697438c51df60d`。新增实际原坏档gzip与provenance及回归共3输入，总267。

## 当前267实际运行

| 范围 | 结果 | UTC开始与结束 | 原raw SHA256 |
| --- | --- | --- | --- |
| build-origin-fixed01 | PASS | 2026-10-04T11:18:27.384673+00:00 → 2026-10-04T11:18:58.820023+00:00 | `f2d81422d31cbaa6ad1853416d29e93ce7a4d74fa47f7b96633f559e88b2e497` |
| audit1-origin-fixed01 | PASS | 2026-10-04T11:18:27.394048+00:00 → 2026-10-04T11:37:24.352517+00:00 | `270711edf73015e7bbabf96197c36bffba2d5700d3c35842f398a6c44885a826` |
| original-browser11-01 | PASS | 2026-10-04T11:38:13.568325+00:00 → 2026-10-04T11:47:08.167964+00:00 | `dab4b08b0179b78cb82f2fd51580dbc524af2335bfea4e3451b48c065df137c1` |

以上三scope267首尾逐SHA相同，递归PID/start-time身份所见owned active均0；各自完整source-as-run、原driver、原终档、dist和日志都保留在全原件包。构建真实入口 `assets/index-DaiH2i1E.js`，SHA `751df3c01e63f9731ca93bf6a3a3600e0c9296748112c49c61419e7a5696773f`，1,112,855B；served7产物逐字同build，历史未引用dist原样保留。

原浏览器harness SHA `e5e09812badada0731f289dc2d9e717c9ad7bb25b208729fd535dd2b2232d082`，11/11、errors[]；原90/120/20/30/60秒期限及断言保持。包含真KeyW/驾驶、城市军机与无人机取得/登机、实际返航落地/退出/身份规则/24费用/恢复速度。原harness中的交易、身份、位置安排仍明确是受控fixture，不能冒普通出生到柜台的完整日常行程。没有observer/强制RAF/新initScript替代。独占功能范围以已关闭CPU owner和本次实际递归进程观察为依据，不作全历史进程或性能证明；初始只读substring预检误匹配其自身shell，exe扫描因权限不充分，原观察及后续stat勘误均保留，不借此声称FPS。

新writer强案为两个独立scope：origin03 2/2与whole-city native24 1/1。合法前件只取消563未完成intent，非route身体/616居民非route字段/全其他state/runtime及38cursor同原坏档；它是明确受控派生，**不是自然前tick**。真实第一腿19.477968969m、629个.01分钟原速步进，每步身体支撑/扫掠/.031m预算不变。新整城720→744、48游戏分钟，原模拟/完整读档/分块重读每tick全字一致并强验证phase，bridge立即及24后重开一致。原600秒14/24 timeout及首次100步上限FAIL、仅新test typecheck FAIL均保留，不改成单scope3案PASS。

原native17单scope、三份true old-v1各24单scope也均实际PASS。其运行267 copy仅未执行的新test后来补纯TypeScript类型；60runtime及实际目标tests完全相同，真实esbuild emitted JS逐字一致（见TYPE-ONLY-EQUIVALENCE）。不声称两个完整267哈希图相同。新finaltyped origin03/native24及root build/自然一天/browser均用最终精确267。当前完整npm test未重跑，绝不把定向数量相加冒全套通过。

## 自然一天的边界

原CLI `node --import tsx scripts/economy-audit.ts --days 1 --out artifacts/root12-current-one-day-origin-fixed.json`，seed20261001，显式8x，720tick/1440游戏分钟。财政/真实工资/科研/生存守卫及终档严格读取与24未来tick全字一致均passed。

616/616 NPC存活、0居民死亡，日末玩家在世；公库80000→71997.154470660069（约−10.00%），居民现金变化 1.774726843%，真实科研完成1/支出200；财政与货币残差分别 `-1.4842953532934189e-09` / `-1.57160684466362e-09`。终档 `2994874`B，SHA `7cff50b17dfa41e3ec937761588d2254c4eec9f30db869ad0f03d1f89e8d5e5b`；未来24 SHA `0a7f7bca3e5cae694658c2657d4db2528cabdc273a741455d042fdc4ae581594`。12公司且0资本归零，只是这一日终点；`steadyStateEstablished=false`。旧244/C7十四日616活/无人玩家死/财政−74.35%仅属于旧244，新267十四日 **NOT_RUN**。

实际观察食品产出 125.072869288814、材料 527.171171143282，零售食物 928、现场吃饭 553、携粮吃饭 53、观察吃饭合计 606，未知归属零售0。终食品店库存 15407.072869288815、居民携粮322；241饥饿且无携粮者能付某个营业有货offer，**routeReachability仍NOT_OBSERVED**。窄边界16210+125.072869−928=15407.072869，0+928−553−53=322；这是有限shop/personal观察边界，不是全食材/货运/长期供需证明。264食品543/库存15478/饥饿249属于原FAIL那一天，不改写为267结果。

31农场开场160而统一生产target120，农场有真实到岗有限工资记录，positive-only production observer不记录库存阻断劳动。不能说农民全没到岗，也不能直接上调库存或送钱掩盖流通/可达性。新只读food原因审查用264原件，未被冒成新267逐店运行。

## 动态城市与完整目标

用户追加环境/建筑/卫生/虚构病毒、商铺倒闭买租新开、居民/身份推动拆迁安置改路、火灾地震均保留。既有有限生活/买租经营/道路损修/清运/临床/实薪能源维修/科研/教育/预算有实现，但默认自然一日很多模块未启用或未触发，不能凭可选fixture完成就称日常闭环。完整缺项与具体源码见dynamic-city只读矩阵；其中已纳管经营店经济再次困难缺自然二次停业入口；纯World参数还发现109个market均缺同区private workshop与farm/dock同时供料的必要条件，现空店复工采购不能凭本区账目成立。两个都是源码/参数证据，不冒本轮新运行或所有未来绝无复工。下一窄实现从合法原主到场二次停业及实际供料合同继续，不是假设系统完全静态。

自然公共职业/居民补选/学校供料与预算授权仍待实施。ROOT12 enable-policy只读方案为PLAN：browser/headless同一显式product factory；core noarg和旧1/2 load原样/24 exact、不得首次使用暗升级；新save3/rulesetId与motionVersion分开、受信任升级只cutover空历史；真实现场实薪/缴费/票数/任期证明及独立natural budget签名，不改原official职业或旧publicEmployment-v2历史判据。MZ独立rpg2d-v1仍按已接受stableID与实际到场分钟接口推进，不整包迁移或直通旧3D档。

卫生末端处置/自然病原/NPC自动清运、结构火震/疏散救援、土地租权安置/新道路拓扑与原子CityPatch、物理电网/产业设备、完整生育继承/制度文化日常、真统计区/流式加载/分块存档、任意城市与真实地图适配仍有缺项。无renderer参数core可运行，不等于任意地图语义都自动适配。

参考ART继续 **FAIL**，Mac实机/FPS **NOT_RUN**。本人查看本次原day/interior，真实遮挡、高架读感、空街和室内过亮仍存在；只有有限材质/原床桌柜/库存牌和资源预算改进。原22视觉PNG/受控五机位与真实native W30.476m原件保留，受控机位不能冒自然行程；真实mesh/pixel road owner命中仍UNKNOWN，下一步先证真实owner再改共享街道authority/净空，不能只隐藏道路或搬出生点来过关。沙发/显示器/办公桌等真实设施仍不足。

## 直接接续

1. 先按enable-policy PLAN落最窄自然公职/现场补选/有限预算与学校供料新版本；保旧档原子读取和24 exact，不免费资格、工资或教材。
2. 依据food只读证据增真实库存阻断劳动观察，再验已有资金和合法柜台路径的供粮流通；不能把静态报价当可达。
3. 按dynamic-city合同实现已纳管店的二次自然困难→原主人实际到场停业→自筹/合法挂牌/买租复工，保债权、租约、身份与旧版本。
4. 新独立GPU真实ray/instance/source owner见证后做局部出生街道净空和真实室内照明/设施；保持空间authority与旧recipe/save边界。再以足够长自然运行、真实Mac与参考图验收继续，完整目标未结束。

## 原件与交付

本次12具名ROOT11/ROOT12 namespace保全部现存regular原件、FAIL/TIMEOUT、原driver/source-as-run/dist/save/PNG和索引。打包验证范围及64MiB恢复分片以 `delivery/DELIVERY-MANIFEST.json` 为准；旧34 scopes缺25种path+SHA的历史事实继续，不保证所有历史可回放。此文生成时新Library与Git发布尚未执行；最终实际LibraryID/既有备忘录版本/提交/远端读回见另附publication receipt，不假装附件已送达。

## 本报告快照后的实际交付更新

2026-10-04 12:08 UTC：源码包29,785,295B/SHA37bb4917…；十二组全原件353,283,217B/SHA19c1d659…/8,616原文件/8,617 ZIP成员，6个64MiB上限分片。生成器与公开恢复脚本独立源ZIP和分片重组逐成员SHA/CRC均验证，literal成员凭据形状扫描0；不声称nested语义或旧缺原件恢复。见 `delivery/DELIVERY-MANIFEST.json` 与 `delivery/independent-restore-result.json`。

Library本批15件实际连接失败于保存开始之前，新LibraryID0，原备忘录仍version5/286307B，未替换、未重试或改写入途径。原文件改以本目录Git交付，whole原ZIP按6分片恢复，不能冒Library附件；见 `delivery/LIBRARY-SAVE-RESULT.json`。来源完整ZIP/源码ZIP保持preLibrary/publication cut，最终此公开报告追加回执不倒改原件。当前工作分支发布尚待正常commit/push及远端读回，main不修改。
