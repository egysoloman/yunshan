# NPC 床侧动态体素窄修复候选

最终源只修改 `src/simulation/home-rest.ts` 与 `src/simulation.ts`，新增独立 `tests/npc-home-rest-voxels.test.ts`。基线是冻结09全102输入；before为同基线加同一新tests，共103项。生产、冻结09和所有旧源/旧断言未修改。

## 修复内容与范围

- 抽取原玩家 `.35` 半径、`1.72` 身高、体素中心 `±.1`、脚底 `.01`、径向 `1e-7` 的纯净空判据；玩家消息与判断次序保持。
- NPC 床侧选择仅在最终可选返回值排除动态阻挡侧；同床预约依旧用全部静态权限合法点识别，已有延迟预约不会因旧侧被挡而隐式释放。
- NPC 最终住宅休息前检查实际身体位置，因此合法 `.4m` 近床范围内的站位被挡时只衰减需求，不获得休息恢复。
- 不修改 `moveCitizen`、完整路线动态障碍、防隧穿、静态世界/床/楼层、分钟预算、资金、持久化模块或旧 unmarked 合同。此补丁不能证明通用 NPC 沿途无穿模。

## Fixture 与实际证据

5栋小城：原真实v4三层住宅recipe与4个unmarked公共设施，保全384个原生居民、原生needs/年龄/职业/钱包和所有实体。初始快照控制仅成年居民已有合法床侧位置、完成route、rest activity、decisionAt、公开setTime23及公开focus。没有写恢复、elapsed、出勤或给钱。

两缺口回归都先在同一合法初始床点实跑一个 `.25` tick，证清晰时正常恢复，然后用 **schema-valid synthetic placed snapshot** 加一块 `.2m` 网格cube：扣1个原生block、constructionId增加、不清旧cube，并经真实import成功且即时export逐字相同。它不是native build/普通Controller旅程证明。支撑、静态净空、权限与在点身份都先断言。

端点筛选病例：旧09仍保被挡canonical点并恢复，fatigue净增加 `0.07875`。实际站位守卫病例：`q=p+.4×outward` 与 cube `p+.8×outward/y+.8`；canonical p 清晰、实际q身体被挡，旧09错误额外恢复 `.25×.35=.0875`。最终候选7项通过，含上述两项、严格径向EPS/脚底头顶相切/player原占床优先、不同楼层、真实regional cadence延迟同床预约、全侧被挡公共回退、unmarked预算；actual guard和预约都经过原save import/export exact及24实际双实例ticks逐字续演。体素、住宅分配、钱包和fixture fingerprint保留。

独立command探针是 **NOT_REPRODUCED_BY_BUILD**，保失败：真实rent80后钱包600→520；当前fixture最近首层床侧距service `10.652699188468619m`，受控setFocus到床侧的build命令拒绝“请到有使用权的建筑入口附近改造”。库存32与voxel0未变，拒绝before/after save逐字同。根因是buildingNear实际要求在功能点2m内，而非NPC重叠拒绝；没有改build规则或重跑该probe。

## 保留的初稿与失败

- 初稿先dynamic过滤points会丢已有blocked-side预约，仅静态发现，NOT_RUN；2源原件保在history/prototype-before-reservation-review。
- v1 candidate6/7：纯边界fixture用 `-.09+.1`，实际浮点值比 `.01` 大，原oracle因此正确返回重叠。保原件；v2输入改为真正端面相等并显式assert，生产规则未改。
- v2 candidate6/7：player纯query复用了已经实际占床的受控NPC，原先占床消息正确优先于体素；保原件。v3选择另一实际无居民占床的bedId，并新增同床优先强断言，不清NPC或削弱guard。

## 最终实际结果

- v3旧09：2 FAIL/0 PASS，exit1；候选：7 PASS/0 FAIL，exit0；strict exit0。
- v2已有clock12/12及原home拒绝/床满2/2通过，绑定与v3相同2源SHA。测试新file自身v3经strict验证。
- 每次run old/candidate103项及freeze09/production102项起止全SHA同；全部原stdout/stderr、命令/environment/UTC/退出及真实save保留。
- 未运行默认612城市、全套、GPU、浏览器、普通旅程或性能验证。未上传、未提交、未整合生产；父代理选择后续统一freeze验证。

## 文件 SHA256

- `src/simulation.ts`: `607d7e55a7bf8042b7abed1e2cfa03cc22216b2429f0f8261c4356ecb5f31213`
- `src/simulation/home-rest.ts`: `60b2126e46cc0207ee8ce5de0312b9ca9d8003291325a359d026e9093d0bb006`
- `tests/npc-home-rest-voxels.test.ts`: `421a0169234fd2dcb465433970f19bbaed8c329a1ad55ce6446cb8f3ad076479`
- `npc-bed-voxel.patch`: `d1192fa01de57470c62416e02e63144c1995fce3971019b9c8e99d082d9dba43`

## 每次实际运行原件

| Run | UTC | Exit | stdout SHA256 | stderr SHA256 |
|---|---|---:|---|---|
| v1/before-two | 2026-10-02T13:55:41.890538+00:00 → 2026-10-02T13:55:46.257345+00:00 | 1 | `f2f8cd92f0bba598016dd70bcc5912585485750fda4428527196fd7612017db2` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| v1/candidate-seven | 2026-10-02T13:55:46.258274+00:00 → 2026-10-02T13:55:55.248250+00:00 | 1 | `7a91f11f3e96bd448447692f960cbe2021c48f1c5c8d7575d42a9af386378588` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| v1/candidate-strict | 2026-10-02T13:55:55.249090+00:00 → 2026-10-02T13:56:06.175106+00:00 | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| v2/command-probe | 2026-10-02T14:00:31.281855+00:00 → 2026-10-02T14:00:33.487206+00:00 | 1 | `02a5ce6b489a79823af52543d4745cf8dca8ce035db1166be529f92dc86bc13b` | `74d8702c6000f7eb298627b7e4d97a63bdf4c9282f95c016b52fc6c3cf468c14` |
| v2/before-two-v2 | 2026-10-02T14:00:33.488369+00:00 → 2026-10-02T14:00:35.621432+00:00 | 1 | `0703977f1df4561b5d01a748dfa2194f376995885ca08c273b6fed23e230ced5` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| v2/candidate-seven-v2 | 2026-10-02T14:00:35.623041+00:00 → 2026-10-02T14:00:41.282049+00:00 | 1 | `3032712c22e69ec189a149f1f7e947e2f412c248cde1e1101daaff3ec3674f3f` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| v2/candidate-clock-twelve | 2026-10-02T14:00:41.283191+00:00 → 2026-10-02T14:00:44.139487+00:00 | 0 | `6f61db023d2e49cb97a3770f31037357ecbd48db2cdac0de5f24ca4a26678e6e` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| v2/candidate-original-home-two | 2026-10-02T14:00:44.140709+00:00 → 2026-10-02T14:00:52.471886+00:00 | 0 | `a65db617f7610183dcdb44223549febd7808f826e08491b7e4eda0898953d4a4` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| v2/candidate-strict-v2 | 2026-10-02T14:00:52.473030+00:00 → 2026-10-02T14:01:03.261377+00:00 | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| v3/before-two-v3 | 2026-10-02T14:04:23.223848+00:00 → 2026-10-02T14:04:24.702622+00:00 | 1 | `2500fb4b4980a8aa35867f2b478e828e6c32444bcfc9cf7b909d68f9aa366d96` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| v3/candidate-seven-v3 | 2026-10-02T14:04:24.704253+00:00 → 2026-10-02T14:04:29.506514+00:00 | 0 | `b85c780d0a1e10b66278822e3b6e7adc53e598d6b7a80def843023cf94b46608` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| v3/candidate-strict-v3 | 2026-10-02T14:04:29.507790+00:00 → 2026-10-02T14:04:38.921462+00:00 | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
