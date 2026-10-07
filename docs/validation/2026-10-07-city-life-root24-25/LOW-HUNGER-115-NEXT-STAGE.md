# 默认城低饱足115人的原件诊断与最低接续验证

本分析0Sim、0step、无应用导入，只读原World291、初始/344/最终完整save、native04的16份完整ALLbus和末窗十稳定phase。逐居民岗位、现金、随身食品、任务、位置、原routePool解码剩余折线、目标shop/owner/funds以及原件SHA见 `LOW-HUNGER-115-ORIGINAL-ANALYSIS.json`；生成器 `analyze-hungry-cohort.py`。JSON约691kB，没有复制新save或巨型ZIP。

`hunger<30`人数初始14→终点115是端点类别变化：只有citizen-450在两端都低30；原14中的13人恢复到至少30，另114人进入低30组。新cold suffix64分钟内原checkpoint低30的134人中20人恢复、114人仍低30，再有1人变低，总115。不能把净增101写成同101人持续一整天挨饿。

直接观察支持的当前原因证据：

1. **115人全部正在处理eat任务，113人仍在旅行。** `runtime.activities`全部eat；原state为103moving、10riding、2shopping，随身food全部0。全组剩余原保存折线路程中位690.8448020041922m、平均698.7319832485928m、最大1648.4332977544816m；此读数是原路线剩余折线，不是新规划结果或未来抵达证明。16份原ALLbus给其他居民实际50sale+8stored-meal，但最终这115人没有一笔sale/stored-meal；该suffix的“没有吃到”有原事件依据，不代表全日都没吃。115人的钱最低141.19589600963045、中位346.29093624414276，均高于自己的目标店报价，且均存在有库存营业的可负担食品报价。不能归因为这组普遍无钱、全城无粮或全店关闭。
2. **目标集中五店，局部断货与等待重新处理有实证。** 115个目标都是market，全部open=true；112个目标库存≥1、3人目标east-b37库存0。这3人是citizen-153（moving）、457与489（shopping）。457/489在原clock5280/tick2055有两笔people/customer事件，随后16窗无sale/stored-meal；终点两人都在原购物位置`(1062.6,172.6,-196.8)`、routeIndex=route.length、hunger5.500000000000159、food0、cash235.05945833189793/391.92475191069894。末窗people与commerce前后原phase仍记录目标库存0、两人位置/饱足/食品/钱包不变；这是局部inventory<1这一原销售门明确不满足的证据，未声称其他销售门均满足。
3. **统计/区域处理频率与目标时效需要下一门核验。** 115人79statistical/36regional，无active；原pendingPeopleMinutes0–60，33人的decisionAt已不晚于5340。上述断货3人pending均60，decisionAt分别5316.064978541108/5308.177302622935/5320.991180494893。`simulation.ts:1836/1841–1845`原频率为statistical16、regional4，当前speed16每ordinary是4游戏分钟；原needs/重选目的地只在该居民的处理窗执行，实际pending而非即时时钟会暂存任务。`1905–1909`只有走到居民处理逻辑、到deadline且满足原重选规则才会重选食物。这说明为什么“deadline已经过了”与“原字段还留eat目标”能够并存，但未执行下一次居民更新，因此没有宣称它们会成功重选/买到。

目标店原字段分布：

| 目标 | 低30居民数 | open | 食品库存 | 原报价 | owner/保存role | 原经营资金 | employees |
| --- | ---: | --- | ---: | ---: | --- | ---: | ---: |
| east-b37 | 3 | true | 0 | 19.182557120508253 | citizen-19/医生 | 2169.4825729764584 | 0 |
| east-b50 | 39 | true | 24 | 15.33677327244797 | citizen-151/商人 | 981.8052855174154 | 2 |
| summit-b2 | 24 | true | 11 | 16.218408715431472 | citizen-18/官员 | 852.9334770096552 | 0 |
| west-b22 | 1 | true | 31 | 15.208109420108492 | citizen-80/商人 | 54.14452489432132 | 8 |
| west-b41 | 48 | true | 28 | 17.204174608669618 | citizen-531/商人 | 1823.1765722302362 | 1 |

这只是终点库存与已经选定目标的分布，不假设这些人会同时抵达或把目标人数当未来实际需求。owner仍在原保存居民中；owner身份与employees/funds是原字段，不替代营业授权、实际出勤、供应商报价或采购物流证明。

岗位/家区分布也有边界：低30的老师26、驾驶员20、官员18、医生15、钱庄职员12、学生9、工人6、科研员5、警察1、商人2、scientist1；workKind为school36、clinic15、hall18、station19、bank12、workshop11、starport1、police1、market2。家district为academy42、government27、core25、starport19、west2。没有通过role/workId推断当前isEmployed或工资是否到账。唯一终点hunger0的citizen-450是工人、money325.46933460446945、eat/moving、food0、目标east-b50有24库存、余原路线70.78359197699399m、pending32；此时点不能冒已饿死或下一步已救回。

源码解释严格指向已有规则：

- `simulation.ts:1592–1594/1606–1611`比较原walkingAnchors/tree的实际有限travel，过滤真实food/open/inventory/现金与关系，在低30时增加eat优先分；`1635–1643`保留最高分，再由 `simulation/meal-route.ts:4–10`对**完全同分**eat报价选择较近原travel。原save envelope与runtime均为nearby-food-v1。102人的当前目标不是欧氏最近可负担有库存食品门，51人欧氏100m内、88人300m内有这种门；欧氏距离不等walking-tree路径/权限/功能点可达，不能由此直接判定chooseNearestTiedMeal错误。
- `simulation.ts:1844–1845`原饱足每处理游戏分钟下降.05，有随身食品且低48才consume一份并加52；因此随身0与持续旅行使该即时恢复路径不满足，未补食品。
- `1927–1938`原移动与真function point到达先行；`1974–1976`eat到达才shopping/customer。`2002–2019`真实营业、食品分类、同目标/shopping、money/库存、实际sale point/身体阻挡等须满足；`2026–2038`报价、寄售结算成功后才扣真钱粮并加52、带剩余食物发sale。断货两人至少明确不满足库存门；没有用端点位置单独推断全部销售条件通过。

下一阶段最低可验证建议（本分析尚未执行）：由root唯一门从当前最终完整save SHA `6e4812acde393a9436dfe09f4b3994a3721ccaba6ddb972c9623a9e369d02d48`原样cold导入并正常ordinary推进，保留实际cash/food/债/canonical bus与阶段原件；不改钱包、需求、库存、身份、tier、身体或时钟。先覆盖一个原statistical16窗，逐名确认457/489/153与450真正得到people处理、pending清算、重新比较原可达报价/目标变化/原移动，再确认真实sale/stored-meal或明确阻塞原guard。该窗只可验最小复现，不能作为全部115抵达或长时稳态结论。

对113个旅行者，按当前实际目的地与原合法路线选代表并持续到真实到达/明确阻塞，记录candidate原travel、score同分关系、route是否因deadline改变、门与sale point净空、客户原事件、库存消耗/owner采购物流/真钱支付。特别核102个非欧氏最近目标的**真实合法**近门是否有限可达、是否同分及是否在实际重选时已营业有库存；若不满足，保留解释，不给捷径或穿墙。对五目标的库存按到达顺序、原寄售/供货/财政约束核真实补货，不能根据终点总粮大就跳过局部库存。最后另门延长至原14日目标，才能判持续现金、供粮与财政反馈。

所有最低门是建议，不是已运行或父代理的执行授权；完整38域PARTIAL、ART_FAIL、MacNOT_RUN与原FAIL/缺相继续保留。
