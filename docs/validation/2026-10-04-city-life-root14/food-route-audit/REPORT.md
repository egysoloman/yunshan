# ROOT14 默认城市240人食物通路：原终档只读因果审计

**240人不是“缺钱且全城无粮”。原终档中每个人都付得起全部156家食店，当前都在执行吃饭意图；14人已有真实 `physicalWaiting` 状态，原下一参考腿被身体守卫拒绝。** 另外189人仍在移动，37人仍乘车，不能据静态查询宣布最终到场、买到或恢复饥饿。

来源是 ROOT13 `product-day01` 的原3292022字节终档，SHA `72ce8b457cc689ec030459aad63f8e44f00a22175e4be614b2a75d16545dfb67`。tick720/day1/08:00/clock1920，save3/civic-local-v1/motion2。复用既有1832308字节保存World，SHA `2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512`；实际用原295源码重算完整World fingerprint仍为 `b85fa6ec`，原day的70个sourceHash也逐文件相同。未调用createWorld、Simulation constructor、step、命令或业务事件。

## 实际运行边界

唯一TS纯查询scope `pure-query01` 于15:52:31.745878→15:52:44.157594 UTC自然结束，原wrapper/cap120，exit0/PASS；295输入首尾一致、递归owned active[]，raw SHA `885f4e9ac07f030c07ed982b0ac84f62ba485225546e5cd9c894bbda1ec48993`。完整原日志、argv、进程身份与before/after在该scope中。

`Object.create(Simulation.prototype)` 只挂原解析/解码state、原runtime和独立查询maps/路由缓存，**不是初始化完整Simulation，也不生成工资、身份或模块来源**。实际调用原walkingAnchors/floorPlanRoute/chooseFacility/native describe、validate及只读工资方法；原walkingPrefixAllowed内部对独立假设cursor执行有限advance，仅验证prefix，未移动原actor。查询前后完整state+runtime JSON、World对象JSON与原save/World文件字节分别严格相同。route decoding仅发生在解析克隆中，未重写原保存。

随后 `postprocess.py` 只对原JSON、查询结果和源级门楣公式做数值整理，生成CSV、门楣时间区间、财政事实。未再执行TS scope或任何Simulation。原所有失败、旧CLOSED、shared、terminal均保留；没有测试、build、GPU、Git、Library、新长审计或候选接入。本审计PASS仅表示只读查询完整和守卫通过。

## 逐ID结果和供货

`RESIDENTS-240.json` 保存每人的原身份/年龄/健康/四需要/钱包/携粮、home/work、当前body/site/presence、完整原route索引与当前腿、rider/dispatch、原目的店报价/库存、原工资债权/出勤/工作allowance、假设重新选择和全部156份offer资格。`RESIDENTS-240.csv` 是同240人的可筛选摘要；`OFFERS-ALL.csv` 共37440个逐人逐店offer，包含跨区1200m、关系、ACL、道路component、门内sale路径和评分层级。

| 原终档状态 | 人数 | 本次可证明 | 不能据此证明 |
| --- | ---: | --- | --- |
| moving | 189 | 原当前下一腿的road/body守卫均通过；有合法prefix及可达食店图候选 | 后续全部腿无阻、到店前不闭门、实际成交 |
| riding | 37 | 原骑乘/停靠目标具名，当前吃饭目标与库存/钱包成立 | 已下车、车道当前位置就是合法步行点、到店 |
| physicalWaiting | 14 | 原下一腿road允许、body拒绝，恰与全部14等待状态相符 | 已修复、真实后续购买 |

原food库存15420.94804409，156家全部营业有≥1粮，最低居民钱包150.10564425高于最高原food报价13.55906692。当前240个目标店全部仍开门有粮且可付，没有这240人的“真正缺供货/现金不足”终态见证。全城674道路节点在一个开放road/bridge component；这只证明图连通。地面374个sale点原door→point路由均存在、native materialization未见block，当前actor经ACL至少有可用点；仍不证明整条街路的完整身体路径。

4个anchorless ID为32/83/523/560，**全部正在乘车**，其车道/高程位置不能当行人出发点。这时纯假设chooseFacility会回落rest；合法未来下车节点尚未在本次模拟中观察。不得把4人归成永久不可达或移body来补证。

全部240的原activity=eat、原开门有货能付目标满足 `simulation.ts:1681` 吃饭承诺；它们不会仅因重新评分有更近店就立即换店。原静态fresh choice为236 eat/4 rest，99个假设目标不同于原目标，其中含乘车位置特性。156位moving的剩余原参考步行时间大于按原.05/min饥饿降至零时间，61位moving已饥饿0；这只是当前路径/速度的风险比较，没有模拟下一天/健康死亡或重选。

## 14个真实身体等待与门楣假阳性

| 原ID | 原挡楼门/edge首坡 | 当前吃饭目标 |
| --- | --- | --- |
| 151,569 | east-b27 | east-b37 |
| 181,445 | government-b19 | market-b42 |
| 195,613 | east-b33 | east-b37 |
| 247 | government-b41 | summit-b2 |
| 261,393 | east-b37（进门） | east-b37 |
| 267 | west-b32 | west-b12 |
| 278 | west-b33 | west-b9 |
| 301,609 | academy-b54 | market-b0 |
| 327 | east-b59 | east-b37 |

14个原下一腿全部native `legacy`、road guard=true、`citizenReferenceSegmentAllowed=false`，blocking witness各在上述floor0/1、counter=false；不属于当前楼梯cursor materialization、ACL或封路拒绝。这里只报告本次原终档14个ID，不与旧六门口数据混用。

`architecture-floor-plan.ts:432–446` 对每个solid用**整段两端最大脚高**与头高检查，再把它与任意XZ交点配对。实际9个门首坡是door0→门外+1.2至1.6m（或其反向）；原门洞2.8m，door header底2.8、顶3.0（住宅）/3.2（east-b37商铺），厚.4。整腿max脚+1.72为2.92–3.32m，原guard会把远处抬高的头套到门处XZ，产生门楣block。

`DOOR-LINTEL-WITNESSES.json` 提供每个原世界尺寸按原makeBody/wallPanels公式生成的local/world header Box、floor区间，以及半径.35身体与该Box的真实XZ时间交区间。该区间只覆盖门前后约.55m，原线性脚高在区间内头部最高小于1.8m，距2.8m门楣仍有>1m净空，**该门楣贡献确为源级可证明的假阳性**。Box是原源公式的精确数值重建，未冒“导出现场Box”；本次没有枚举原所有solid的连续扫掠，所以不把门楣clear扩大为完整身体路线clear。

`PENDING-LINTEL-SEGMENTS.json` 还找出39个当前原路线包含同类长腿（14 waiting/16 moving/9 riding）。16/9只是后续源码数值风险候选；没观察到它们未来在该门失败。不能称39人已被阻，也不能把连续小步方案直接作为已验修复。

## 工资/财政因果纠正

原 `snapshot.wageArrears` 实为**逾期public=0、private=0**；publicEarnedNotDue=1366.2115628558938、privateEarnedNotDue=410.14547796683894。ROOT13摘要“私营欠410.14548”是未到期已赚工资，不是逾期/国库拒付。本报告不修改原摘要或原artifact。

私薪实际资金来源是雇主绑定company.capital或shop.cash，`simulation.ts:1910–1917` 私营只扣该账户，公共才扣treasury；选择食物与购买直接读取居民money，未读取国库/工资债。240已过现金门槛，因此此刻不支持“私薪欠付或公财政耗尽导致这240不能买”的直接因果。原available公共预算56645.982605258345、国库72688.81129934225；只说明此终态有限预算仍正，不能证明长期财政稳态。

农场有原9611.8597556有薪分钟但库存高于target120而0产粮，与14身体拒绝是不同证据；dock有125.94804409实际粮产出。真实一天counter539+carried56=595 meal，不能把混合food/material production647.3都叫食物，也不能拿全城15k库存替代到场购买。详情见 `FINANCIAL-AND-SUPPLY-FACTS.json` 和代码因果审查 `food-choice-static.md`。

## 可接续实现和强验收

先独立纯helper解连续3D时间：先求身体与原Box竖直区间真实重叠的t范围，再在此范围精确求圆盘与rect XZ距离，不把一个地点的最大脚高套到另一个地点。保持radius.35、height1.72、原钱粮/需要/速度/目标与断言；低门/真实墙仍应阻。收集上述14原腿fixture、实际源导出Box与0距离/升降/反向/旋转/擦边反例，实际运行窄纯规则/types。不能全局改变旧blocksFloorPlanMovement，旧1/2/3 exact24必须保；仅作为新物理recipe的接口候选，默认295仍不接。

之后由root在新候选上才做原actor/原需要钱包/原旅程的真实mover/售粮/出勤验收，分别观察14人跨门、原店仍有货成交/饥饿回升/有限现金库存税、旧档原子拒新marker与旧版本24字节。189移动与37乘车还需要实际路径/下车/到店闭店窗口观察；不把本报告表静态路线作为到场事件。完整最新npm test/新14日、Mac/FPS和ART验收均未在此运行，经济稳态未达事实保留。
