# ROOT14 连续圆柱/Box扫掠纯函数候选

**新独立候选已通过23/23纯规则与strict tsc；原14条终档门坡腿的真实源Box连续扫掠无碰撞，而未改旧守卫仍阻。** 本组未接入默认295产品或v9消费者，未观察实际居民移动/到店购买。它是可接合的纯几何原语及来源证据，不是已解决食物通路的产品验收。

原240审计已独立CLOSED，在 `../ROOT14-default-food-route-audit-20261004-01`；此处不改其原报告/文件。295/68全部原输入精确复制，新helper+纯测试组成297/69；旧blocksFloorPlanMovement、旧1/2/3源和所有默认运行规则未改。实际共享295与原terminal/World也在闭组前再次逐SHA检查。

## 实现和实际结果

最终可接文件为 `candidate02/source/src/geometry/upright-cylinder-sweep.ts`，4527B/SHA `9cb9693aabbb58abc267d5251c89404ab38584f1302296191a560c4520d6fe7f`。版本 `upright-cylinder-sweep-v1`。

`blocksSweptUprightCylinder(from,to,box,radius=.35,height=1.72,footAllowance=0)` 对同一固定坐标系的线性脚部路径和轴对齐 `{x0,x1,z0,z1,bottom,top}` Box，先裁剪真正竖直重叠时间，再在该时间范围求XZ线段到Rect的精确最小距离。保留原水平接触合同 `distance² < radius²−1e−7`；竖直严格开区间，不加时间epsilon。原身体尺寸不变。独立证据接口 `sweptUprightCylinderBoxEvidence` 返回vertical interval、最小距离和blocked，输入不改、不采样、不构造World/Simulation。

默认footAllowance0为真实几何；`.01/.22`只能消费者显式传原墙/可踏过政策，helper不自动决定用途。固定yaw可先用原buildingLocalPosition变换两点；不支持pitch/roll或随时转动的Box。零宽/零深的有序闭Rect面合法；`radius<=sqrt(1e−7)`、倒序/非法高度、非有限及明显溢出路径明确拒绝。接口不承诺零半径或任意巨大数值。

唯一修后scope `pure-rules-types02` 于16:17:23.301907→16:17:36.564259 UTC，原owned wrapper `c53609fd…` /cap120自然PASS，exit0、23 tests全部通过、strict tsc exit0。297输入首尾同，递归owned active[]，raw SHA `1d4397244247ca8c88e479843100e69789627dc31676746d35223f60bdf9b4a3`。驱动顺序明确是纯23后类型检查，不是完整npm test/build。

首轮 `pure-rules-types01` 真实11PASS/12FAIL、tsc NOT_RUN、raw `b88b0437d2073c30a7c1f92c0411cad37a711ffd860855da4712035cbb222140` 保留。新helper首版过严要求Rect两轴有正宽，11个fixture在输入校验阶段抛RangeError；原实际wallPanels在.2网格上生成29条退化wall-glass面，属于合法闭面。最终只修新helper的有序Rect输入合同、补薄面真阻和原Box合法断言，保原23全部强断言。原失败base297不改，candidate02仅改两个新文件；两轮原owned/输入/完整raw分开，不覆盖旧FAIL或增时限。

## 原14腿与真实Box证明

fixture `FIXTURE-14-ORIGINAL-LEGS.json` 保留原ID/role/needs/money/food、原body/from/to/routeIndex与完整原World building descriptor，68197B/SHA `6e5956b5f907f95c0e2f016f2909fe14885527206192dfd3ac711e4842034413`。来源终档SHA72ce8b…/WorldSHA2912839…；不改钱粮需要或身份。

实际纯测试调用原 `getBuildingBody`/`wallPanels`/fixtures/treads/landings/upper slabs/roof regions，导出14人的5451个Box记录（相同楼的多个人分别列出，非5451唯一实体）。`ORIGINAL-14-BOX-EVIDENCE.json` 1477675B/SHA `42a79dbacb07e9051301e21847205d3168648ca67d889f51fa24d92263af97b1` 含actual original header、完整Box/楼层/来源类型、局部原腿及实际vertical interval/最小XZ距离。

14人的旧原 `blocksFloorPlanMovement(site,0,from,to,.35,1.72)` 全true；新continuous在原墙.01/台阶.22和默认真实footAllowance0两套条件下，全部Box hits=[]。屋面采用原region完整BBox（严格包含gable真体），对这14腿BBox也clear，因此这14腿不靠忽略屋面才clear；**未因此实现通用gable扫掠或声明任意路线完整安全**。原门梁actual高度2.8→3.0/3.2；每腿用实际Box降低底面至1.6后均真阻，反向原腿仍clear。真实低门、薄墙/退化面、升降、静止、擦角、严格接触、小非零移动及yaw另外通过。

例 citizen151/east-b27 的actual门梁local Box为x±2.2、z13.0–13.4、y2.8–3.0。原脚0→1.2m；真正头部可达到门梁高度只在t>0.9，其时最小XZ距离²=94.09，远大于.35²−1e−7。原守卫把max脚1.2+头1.72=2.92与门处XZ配对，明确假阳性。这个actual provider证据补足此前只读审计仅源重建Box的边界。

## 接合边界与仍未运行

只给root/road_owner候选API与精确SHA；不得自动替换旧architecture-floor-plan函数或旧规则。新的v9物理recipe需独立门控，使旧1/2/3加载/未来24行为原样。消费者必须提供同一来源/坐标系的真实Boxes，明确足部政策；楼层权限、support、market counter、voxels、road closures、native cursor、载具/站台floor都仍有各自守卫。helper不生成业务来源、工资或到场分钟。

通用楼体集成、所有斜屋面/动态几何、实际NPC/controller跨门、原14人以原需要/钱包到店交易、旧档exact24、新产品保存/分块、全部npm test/build/browser/GPU/Mac/长审计在本组均NOT_RUN。真实验收应记录原主体跨门、到sale point、扣有限钱包/库存/税、饥饿真实恢复，并保等待失败证据。此纯helper不能让189 moving/37 riding的最终购买自动变PASS。
