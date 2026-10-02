# 云山 v5 市集街台：隔离原型与原始验证

本包是 `current-v5-market-block-01` 的局部、显式启用原型，默认仍为 current-v4。没有修改共享生产树，没有合入 coherent04。固定原型的 102 输入来自 coherent03 的 99 输入加三个新文件；它不等于父任务当前 coherent04 的 99 输入。`source03-to04.json/.patch` 列出两个存档编码文件、三项测试及备忘录的六个实际差异。父任务已报告 fixed.patch 在当前树 apply-check=0；合入后仍须重新冻结验证。

局部实现：market-b0 前一段物理宽 52m 街台、原入口、三处真实 sale 柜位、有限台基和四棵实体街树；三柜共享原来的同一真实商铺及库存/账户，不是凭空新增三个店。保留原 v4 楼体、房间、权限、水系。钱庄到市集增加 3.2m 步行连接，含十级 0.2m 台阶；真实图长度用于公共规划。新步行段禁止车辆，原高路后缀仅继承，未做全面通达验证。根基底部取 min(真实地形,铺面顶)-0.2，真实填挖包络不得超过 4m，不将整个 54m 街区压平。新种子未验证时拒绝不支持的 b0 尺寸，不静默兜底；本轮 v5 正向验证种子仅 20261001。

## 实际结果

| 原件 | 结果与范围 |
| --- | --- |
| diagnostics/final-run-status.json + final-targeted-v5.log | 首版严格构建成功，局部测试 6/7、exit1：真实台基底高于顶。原失败和首版 102 源完整保留。 |
| diagnostics/fixed-run-status.json + fixed-build.log | 修后 strict + Vite exit0，102 输入起止逐文件相同。 |
| diagnostics/fixed-targeted-v5.log | 修后局部 7/7、exit0：有限基底、实体步行/购餐/楼梯、双向钱庄接合、树与矮边实体、实际 Three 发射铺面射线、0-tick 存档及错误身份/非法汽车原子拒绝、规划真实边长度。不是全 npm test。 |
| diagnostics/legacy-worlds/candidate-fixed/report.json | 五种已有配方 × 三种子 = 15 个世界、2265 个原位置查询：整体世界原字节、共享房间/屋顶/用途点、水系及查询值与原 baseline 精确相同。五份主种子 0-tick 原档导出/恢复字节相同；没有声称 24-tick 或多年续演。r5 配方原来返回 current-v2 的契约也保留。 |
| diagnostics/motor-telemetry.log/.json/-summary.json | 外部只读记录器三个原步行案例 3/3，5006 个实际 Controller.step、9 次连续 W 行程；半径 .35m、眼高1.72m、4.8m/s、每步 dt≤.02，无路径间传送。每步水平≤.096m、脚高差≤.2m，权威脚高查询误差均0。CPU EventTarget 正常 motor，不是浏览器真人旅程。 |

物理街台宽 52m，身体实走 51m（端部各留 .5m）；不能称恰好走完 52m。钱庄门(-490.2,74.6,220)到市集原门(-469.4,70.6,309)实际 1859 步、水平177.73455m；三柜路径均实际 W 到达，三次购餐扣真实现金、库存与营收、没有虚构公库入款；上层工作点通过真实楼梯，原 traveler 权限不改。初始定位是受控案例前提，连续段间没有 reset/teleport。第一轮 telemetry 的 Three 导入失败也原样保留，之后只修外部诊断环境依赖路径。

## 源与原件入口

- `candidate-fixed/`：完整冻结 102 输入和实际生产构建 dist。启动仍默认 v4，v5 需明确 createWorld(seed, 'current-v5-market-block-01')；不是默认新游戏已启用 v5。
- `baseline/`：原 coherent03 的完整 99 输入；`candidate-final/`：完整首失败冻结源及构建。三份源均不含 node_modules、浏览器 profile 或凭据。
- `v5-market-block-fixed.patch`：修后可审查 patch；首版 `v5-market-block.patch` 保留，不能误合入。
- `diagnostics/legacy-worlds/baseline/` 与 `candidate-fixed/`：15 世界/房间/屋顶/探针及五份原始0-tick档的前后原件，不仅摘要。
- `review-plan.md`、`candidate-contract.json`：初始规划原件，包含未解决/后来失败的提案，不是最终实现证明；`sitefit-initial.*` 保留真实高差/入口冲突失败采样。
- `evidence-index.json`：逐文件原始路径、包内路径、字节和 SHA256；ZIP 校验另见包外 delivery-manifest.json。

## 尚未运行与边界

GL、普通 URL/WASD 原生 UI、新 v5 的 24-tick/分区/长期经济续演、Mac 实机及性能基准都没有运行。完整真实地形壳/森林近远实例审计 `terrain-actual.mts` 仅写入、NOT_RUN；它默认还指向首版 candidate-final，不能当修后完整 terrain 已验。实际三维铺面发射值/CPU 射线通过不等于画面通过，街树不同视距预算和全近远地形的视觉验收仍待。

旧五张 GitHub 原参考图本轮确已逐张查看，其只读来源摘要附在 reference provenance；原 PNG 不重复装入此局部源码包。最新八张图的实际像素尚未取得，视觉验收 BLOCKED；父描述中的现代 CBD 主塔群、中式冠部、机场和多瀑布整体组织不是本局部原型已实现内容。本包不包含新私有参考、API 凭据、浏览器 profile、node_modules，也不将父任务正在运行的全规则结果算作本原型通过。
