# ROOT23 只读正确性复核

状态：`STATIC_NO_REMAINING_BLOCKER_IN_AUDITED_BYTES`。此结论仅为当前列明源码的静态检查，不能写成已运行 PASS。本代理未执行 Simulation、tests、tsc、build、browser、performance、npm 或安装；没有修改任何产品、测试、脚本或仓库文档。两个发现由各文件拥有者修复，本代理只读回修复。

复核快照时间：2026-10-07 05:18:21 UTC。基线为 `/workspace/yunshan-work/ROOT23-ledger-scaling-20261007-01/baseline` 的原 397 文件。已完整读取 AGENTS.md、提示词.md；开发备忘录采用团队无截断全覆盖阅读：文档子代理读取 1—1880 行，本代理完整读取 1881—2031 行并重点复核 ROOT21/22/23。历史 PASS、实体计数及性能结果未用作当前代码运行证明。当前实际城市规划保留 612 建筑、616 居民、344 车辆、210 商店，未复用先前错误 117 车辆分母。

## 已定位且已静态修复的发现

1. 共享冷读器先读取 `body.history.count`，随后才验证引用账的自身字段描述符，可执行输入 getter。当前 `power-grid-hydro.ts:365` 在首次 count 读取之前执行 `dataObject(body.history, ['count', 'pages'])`；新增纯回归覆盖 count getter 及公开编码 selector getter 均不执行。发现仅来自静态触发链，没有执行修复前 FAIL。
2. 新原生验收脚本把 `hydroGridWindows(shared)` 展开的未冻结分表直接传给 `appendPagedHistory`，会触发原 runtime 的冻结新窗要求。当前 `scripts/hydro-dispatch-history-actual.ts:83` 使用 `Object.freeze(window)` 后追加。这是只用于保存表示归一化的局部对象，不授予实时资产能力。发现及修复均未执行。
3. 新共享路径不再把旧图按实体数量的宽系数当作完整新上界。当前新 `hydro-grid-budget.ts` 按整个允许字段结构计算完整快照、完整当前 dispatch 和全部允许诊断；旧缺省路径的原保守公式保留。节点同时隔离和受限的误导注释已更正为保守包含两份完整数组。

## 字符预算与整个 step

`hydro-dispatch-history.ts:181` 的分页字符差公式对合法稠密分页成立：追加同页增加新行及一个逗号；新页增加 `{"firstIndex":,"windows":[]}` 的 28 个固定字符和 firstIndex 位数；新分支再增加两括号及非首分支一个逗号；count 位数差单独计入。单次元数据增量保守最多 38 字符，涵盖 256 页和 8192 分支边界，不依赖历史遍历。

`power-grid-hydro.ts:324` 的私有累计使用当前完整 body 初始精确 JSON 长度，再累加 grid header 差、hydro header 差和 water/reference/必要 snapshot 的分页追加差。两侧 field 集合不变，遗漏的字段名、冒号、逗号均相消；current dispatch 和 totals 的变化仍包含在 grid header 中。旧历史后代由私有完整深冻结保证不能更改，字符计数只存在 WeakMap capability，不读取公开计数提示或摘要。

新未来上界采用 `J(object)=2+max(0,n-1)+Σ(quoted(key)+1+valueBound)`、`J(array)=2+max(0,n-1)+ΣvalueBound`。所有有限 binary64 数预留 32 字符，布尔预留 5。建筑/车辆分表用全部绑定 ID；nodeId 覆盖 null 与最长声明节点，vehicle edgeId 覆盖所有 World 交通边；全部商店行及维护图的 equipmentAvailable 均保留。六个诊断数组分别按完整建筑、车辆、节点、机组、线路、节点 ID 集合计数，即使真实同窗无法同时全满也不预测缩小。完整 12 字段 snapshot 与 17 字段 dispatch 均计入；水窗上界 804、两字段引用上界 72；8192 余量充分覆盖 3×38 分页元数据及 hydro/header/totals 的有限标量差。现有 definitionKey 和显式编码字段在当前 body 已精确计入且固定。

私有 `appendCharacterReserve` 在可信初建、无 owner 初始绑定、完整恢复处各计算一次；每次推进前仍检查原 World/声明对象、完整物理 key、shop ID+building ID 与 vehicle ID 集合。因而实际每 tick 新增字符不超过这份固定完整上界，不依赖当前重复率、车辆当前边、当前商店许可或 gzip 压缩。

`Simulation.step:940—945` 在写 accumulator 之前计算整个 prospective tick 数并调用 `prepareHydroBeforeStep`；后者以 `currentExactChars + tickCount × privateReserve <= 4_000_000` 检查整个 step，并预检所有未来时钟与结构容量。对于已授权合法固定身份集合，可用每 tick 字符上界归纳保证不会在后续 energy 阶段才因域预算拒绝而部分推进时间。当前计数为精确实际前缀，未来每窗保守假设新增完整 snapshot。

此证明只覆盖能源域 4M；没有假称其他模拟模块总和必定小于余下 4M。原保存读取/分区组装仍对完整活跃 8M、2M visited、depth24 执行原 guard，新 driver 每实际帧也保留这些断言。无扩大资源上限或把 gzip 大小充当字符预算。

## 冷读、能力与不可变身份

显式 World `historyEncoding='shared-dispatch-v1'` 与保存状态标记必须匹配；未知标签、移除标签、缺 snapshot/ref、水账丢窗、稀疏数组、getter、额外字段、symbol、未引用 snapshot 与非单调 index 均有静态拒绝路径。共享 helper 在读取各记录值或 stringify 比较前检查完整自身数据描述符；新增引用账 count 检查补齐前述早读缺口。

每窗原 18 字段水账先由原 `validatePagedHydro` 从可信初始两库逐数重算。解码直接复制原水窗的 5 时钟字段和 transferredM3；reference 保留 dispatch 自己的 generatedKWh binary64，未用水力乘积替代。原排序 Flow 按该窗 shops、vehicle edges 和完整维护支付账再次求解；`exactData(window, expected)` 覆盖整个 17 字段及所有后代，累计 totals/current dispatch 亦精确比较，守恒容差仅是额外检查。

getter 结论仅覆盖新共享记录/helper 及已修的 history.count 早读路径。原基线 `bodyOf(state)` 和 `definition(world)` 的顶层路由仍先读取 `.kind`；直接给这些 API 整个非法顶层 JS 对象可以先触发 kind getter。原生 JSON 读取不能承载 getter，此原基线入口缺口没有作为新增 diff blocker，也没有被宣称已修复或已运行通过；若验收扩大到所有任意直接 JS 对象入口，需在该读取前增加自身数据 descriptor 检查。

读预览函数没有 `caps.set`。原 host 完整 save validators 在 live state 替换前运行，validateOnly 在 onLoad 前返回；安装及成功接受保存后的原 onLoad 才调用 bind。JSON/structuredClone 合法冷形状不等于 hot 身份；当前 owner/state/world/definition/physicalKey/loadIdentity/runtime 均要匹配。完整深冻结使用私有 WeakSet，只缓存本实现实际遍历过的后代，不因陌生浅 `Object.freeze` 跳过子项。新快照引用旧 immutable 后代的共享不改变能力或资产身份。

## 旧合同与验收脚本

缺省 v2 的 constructor/dispatch 仍写原 7 keys，water/current dispatch/totals/原 history 顺序与算术无变化。新 helper 没有事件写入、额外时钟推进或 2D/3D 接口改动。真正原字节和全部事件等价还需根代理冻结源后的运行结果，不能由这份静态审查替代。

原生 driver 最终编制为 10 构造、6 成功完整 import 加 3 拒绝 import；small 共 312 ordinary calls，large old 共 3（2 成功+1 拒绝）、shared ≤33（≤32成功+1拒绝）、3恢复支共12，合计≤360。独立原 World SHA 校验、可信 World 除 tag 全数据相同、仅完整共享表示归一化、完整 save 和全部 bus/十 phase 比较、branch-owned full gzip 原件、每帧 bus gzip、物理每个 part 落盘读回、真实缺数组 part 拒绝、冷读/clone 无能力、预算边界 whole state/runtime/clock/tick/accumulator/bus/phase 全字节保持均有静态强断言。没有把 32 窗、snapshot 重复率或 80MiB gzip 比例当作已经证明；真实边界和真实磁盘量由唯一 root gate 决定。

## 审查源码 SHA256

| 文件 | SHA256 |
|---|---|
| src/simulation/power-grid-hydro.ts | 545e0a55dca3b66f9005b79823ce20490e6508bdf99edf1fb1ab5aaed1688faf |
| src/simulation/hydro-grid-budget.ts | 56afa05a3ab62b97e1d0e240b9da23d747ca0d734a9cae28ff448d7226f9bd14 |
| src/simulation/hydro-dispatch-history.ts | ba8a9b957c35fa71e6dd5f6e70d93cf82cc526e89395aea09d3eeaba5e491f4a |
| src/simulation/power-hydro-runtime.ts | 1699090066685ff4aec46fe56baae81f745352cf03ef489bcfeb300784434c29 |
| src/persistence/save-resource.ts | b3d39c56b6d4d928d7be848b4f51fd2226ffc057a4041a4c0c769ab5fb23ed18 |
| src/persistence/partition.ts | aadacf7184fe7bcea89c95f0d79bc5addac5f112dee920e87b07df86c8b6e804 |
| scripts/hydro-dispatch-history-actual.ts | a7134f996b6524dfe16322e2b41b312d1ac70965eb76532151e0462fbf4112e8 |
| tests/hydro-dispatch-history-fixture.ts | 89a8eb8db11d6096dd7db06e3c579a96fd8b94322eb4d6a3c4c5cf43a763fb54 |
| tests/hydro-dispatch-history-grid.test.ts | 168276a22aaec0027abe60daa41ed5a28a13dc066fdb0654f848343e10bc596e |
| tests/hydro-dispatch-history.test.ts | 39e5c79c7ee7080a7ad18581b5eede9c46bb4e9c47c662c699ae897161adb568 |

power-hydro-runtime、save-resource、partition 的 SHA 与原 397 基线同字节。本轮唯一执行静态格式检查为 `git diff --check`，退出 0；它不是运行规则或构建证明。

剩余阻碍：本审查范围内无已知确定源码 blocker。类型/规则/native/build/legacy 运行结果仍由 root gate 给出；完整城市游戏、美术、Mac、默认城市供电启用、长期经济与无限账均不在本静态结论内。
