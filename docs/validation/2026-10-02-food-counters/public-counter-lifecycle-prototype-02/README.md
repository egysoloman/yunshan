# 现场食粮柜台：真实工班续段与现场交班隔离候选

本轮完成旧布局隔离候选的跨结算保存、原日工时保护、真实来日公共班审、同人续班、双人现场交班、暂停/取消、结算打断后责任保留和次日真实退库。最终**18/18 定向检查（新生命周期9 + 原柜台9）通过，strict exit0**。共享 v4 生产没有接合；本包不能当作默认城市恢复或完整项目完成证据。

实现目录 `/tmp/yunshan-food-counter-lifecycle-prototype-20261002`。增量基底是 `/tmp/yunshan-food-counter-prototype-20261002`，须已经包含第一阶段 located freight 与 counter prototype。增量 patch SHA-256：`c45324af5c32d474a9c8416a5f8428f9e7c52c45793a370c644f99f1cb7d5b99`。四个路径为 `src/simulation.ts`、`src/simulation/food-distribution.ts`、新 `tests/food-distribution-lifecycle.test.ts`、真实捕获的 `tests/fixtures/food-counter-paid-v1.json`。只在基底独立副本实际 `git apply --check --whitespace=error`、apply、reverse-check，均 exit0；应用后四文件逐字节等于候选。**没有对当前共享 v4 做 apply/check/build**，其核心日程与合法室内使用点须另行审查。

## 真实失败与修复

| 观察 | 原始结果 | 本轮处理/证据 |
| --- | --- | --- |
| 17点工资清 attendance 后调回10点 | 冻结 v1 实际复演 import 拒绝：任务劳动须包含于原实际出勤 | 单调时间1020，工资44.16 = 480×0.092，柜台43.792 = 476×0.092，普通工班4分钟0.368；现金残差约3.49e-10。`v1-reproduction/clock-v1-replay-failed.log`与JSON保留。 |
| 初次新增7项 | **5pass/2fail** | `lifecycle-expanded-first.log`。一项是身体已经回家而接班正确拒绝，另一项是真删除未来班承诺仍通过的存档缺陷。 |
| 原职工自然通勤 | 抵达既有室内工作点，仍不能达到门柜台0.05m条件 | `day1-commute-failed.log`/JSON。接受真实原岗位到岗资格后，由柜台任务沿实际距离去门柜台，并用原班分钟记账；不改 position。 |
| 未来班本体删除 | 保留日1授权却删 publicShift 仍可读 | 增加柜台班审回执，交叉核对原 shift id/day/cap/两签；保持原拒绝断言。 |
| 关闭后全区粮20+退8预期28，实际84 | 第一条货批实数仍28，退8仅一次；原车调钟后另真卸56 | `return-quantity-failed-diagnostic.json`。保留两辆既有28货车的新事件；按20+8+28+28核对，仍严格断言原lot28、退货一次、全粮及现金不变。 |
| 17点打断交班后误选最后新增来班者 | 双方未完成交班，日1旧保管人接班失败 | 对照副本仅退回两处“最后task选择”，`interrupted-handover-baseline`实际1fail/0pass且src起止相同。修复按是否真正完成交班寻找负责劳动段；真实日1原人续段与退库通过。此对照是明示构造的局部回退，非发布版完整基线。 |

第一次失败捕获JSON曾被后续固定测试同名写回覆盖；保留初始失败日志后，从冻结 v1 源码重新实际复演得到 `v1-reproduction` 原件，生产src逐字节匹配冻结v1，未用固定版JSON冒充原失败。初始 v2 文件已经改名 `*-v2-initial*`，只是中间验证记录。

## 合同、工资与库存的实际契约

* 工班日按 `extension.lastUpdate` 单调时间计算。登记柜台时保留真实已有公共 attendance，后续只从核心 `registerAttendance` 的真实 public credit 更新 `dayUsed`；17点清 attendance 不清当天使用量。普通工作、装配、搬运、等待、零售、人员交班都共用原480分钟上限。调回10点不能再得另一份480。
* 结算周期独立记录 epoch。只有原 people 工资清算前的私有 callback 能写实际雇主、工时、冻结rate/gross；只有 finance 真扣公库、真入钱包/税后的私有 callback 能记 `paidGross`。普通 `emitEvent(wage-paid)`不结算这份证据。未付部分仍受原 wages/arrears 总债权约束，旧已赚金额和履职身份不删除。
* 结算时结束旧劳动段，保存 `endedAt`、原因和原合同。真正新日/结算周期重新绑定新的 funded 原岗位合同，通过 `continuationOf` 连接旧段，按既有assembly/carrier/shelf/closing状态选择继续阶段。新 finished 段观察时间与已赚分钟不得超过真实结束时刻。
* 来日班审必须两个原任职公共官员真实同场、在岗、健康、在原法定窗口。显式提前审议复用既有公共现金/旧已赚及到期债/必要运维/授权预算/未来班承诺保护。实例真实授权日1的141个原岗位、每人480分钟、cap6226.56；只保护真实已有公库，不转现金、不新建岗位、不改角色/workId。存档须保留该真实授权本体。
* 交班双方必须真实同在既有门柜台、有原职资助分钟。空手/已上架交班至少各1分钟，实携8份各2分钟；每个人仅在自身真实 people callback记一次劳动。未齐全则不完成。来者只有实际完成才成为负责者，原货主、有限数量、冻结报价和 FIFO来源不变。暂停释放普通需求行为，取消保留双方已赚分钟。17点打断则保留原保管责任。
* 一材料、10装配分钟、cap40、8份批次和原价12保持不变。闭柜释放剩余授权，不退款创造现金；实粮只由新正式原工班真实走到原node才退回原lot。自然到货与柜台退库分笔，不能把最新全区货量当原lot数量。
* v2 独立 runtime marker 与 body/payroll 双向检查。真正旧v1只增加明确迁移元数据，不猜旧已付历史；旧任务工资、食品、采购款和引用不改。旧无证当前日保守暂停公共新授权，等真正新单调日；已验证迁移保存及同日24tick，**未运行旧v1迁移后的实际次日续班**。新局正式日1续班已单独运行通过。

## 最终实际验证范围

`node --import tsx --test tests/food-distribution.test.ts tests/food-distribution-lifecycle.test.ts`：`lifecycle-delivery-functional.log`实际18/18、0fail/0cancel、exit0；`npx tsc --noEmit`：`strict-lifecycle-delivery.log`exit0。`lifecycle-delivery-source-start/end.json`记录全部**33个src资产（32 TS + CSS）和8项测试/配置输入**，41项起止SHA相同。此前18/18只记32 TS的中间manifest保留，不能冒称它检查33全资产。运行与root完整规则并发，日志耗时只是functional，不是benchmark。

真实保存及24tick覆盖携货/上架、交班中途、日1正式续段、调钟后已支付工资与旧v1迁移；保留逐字节 `exportSave` 比较。坏档用原子拒绝断言覆盖缺body/marker、消除日用量、删工资期、篡改已付值、未来班丢失或预先劳动、假交班人/位置/处理分钟/完成状态/保管人等。时薪、每份服务2分钟、钱款/库存原强断言保留。

`payroll-clock-v2-fixed.json`现金残差约3.49e-10；`day1-continuation-proof.json`残差约1.16e-10、粮残差0；`two-staff-handover-proof.json`现金/粮残差0。原角色、workId和材料消耗均严格核对。原 `public-counter-prototype-01`校验表的39项内容全部SHA不变，详 `original-39-archive-preserved.json`。

## 尚未接合与限制

**v4 marker (`floorPlanProfile`) 仍在注册/存档/移动时明确拒绝**，不能直接覆盖当前共享代码或把旧door当新room使用点。尚无native UI/NPC柜台机会广播、自动许可、自动招聘/换班、跨区搬运或新增默认柜台；没有新增钱、粮、材料或员工。本轮只证明合法既有有限资源下的生命周期，不证明缺区默认会自行获粮。

原有来源定位/货权 patch 尚须与当前正式几何、分块和第10模块保存契约协调；公共班审显式控制目前只在隔离 controller，未变现有玩家政治权限。仅已有原岗位人员可以接受；缺可用工作人员、身体条件、现场到岗、资金或粮时仍暂停/等待。现场交班要求双方亲到；死亡/无人能亲到的长期库管处置未新增。

工资期、任务/成交/交班档案当前保留原型256条上限（柜台64），没有长期归档压缩；结算证据满会明确阻止继续清算，此生产接合阻挡须先解决，不能拿短测证明无限期恢复。没有full npm、GL/UI、14/30/60d审计或CPU/macOS benchmark。生产粮196/day 对约853需求/day、默认缺区零售路径与长期财政问题没有在本轮消失。

Library上传是本证据包的一次独立官方创建尝试，结果另存父目录上传回执；无真实ID就明确为0个，不能用本地zip路径冒充LibraryID。包只含这些模拟代码与功能记录，不含Tripo密钥或私人参考图。
