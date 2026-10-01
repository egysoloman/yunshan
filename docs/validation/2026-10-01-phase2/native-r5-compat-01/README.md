# 真实 r5 原生导出 CPU 兼容验证

输入由普通 UI 在原 4193 浏览器旅程读取原 r5 存档后点击“导出”产生，未使用制造的替代 JSON。原始 1,798,521 字节的 SHA256 为 `7ba76f550f9f5413cd712022b751599340cc24e9e48327674f88b2c122af6fe9`。逐字节压缩副本位于 `tests/fixtures/world-layout/r5-native-ui-export-coherent02.json.gz`；没有打包 Chromium profile。

使用 `/tmp/yunshan-phase2-root-coherent-02` 的完整 81 文件固定 SHA 复制到独立 `/tmp/yunshan-r5-native-proof-01`，运行 `node --import tsx native-proof.mts > native-proof.log 2>&1`。输入及源码前后哈希不变；01→02 的生产差异仅为 `src/rendering/terrain.ts`，其余六项文档、脚本与 fixture 差异完整列于 `source-manifest.json`。

可信选择结果为 `current-v2-r5`，输出旧标签 `current-v2`，世界指纹 `c70ebca5`，完整世界 SHA 与独立冻结的原 r5 三种子 fixture 中默认种子完全一致。真实原 JSON 在完整 import/export 及分区 split/assemble 两条路径都逐字节等值。

原始 Tick 1620、day 0（界面第 1 日）、14:45、暂停、速度 1；完整坐标为 `(-445.20000000000005,42.6,549.8000000000001)`，现金 `509.1676755148238`，住宅 `market-b21`（千灯市集·灯市街·里居6）。取整坐标、截断两位现金、界面日与住宅名都与 r5 原公开检查点严格一致。所有公司、股权、商铺归属、银行、工资债权、财政、随机数与路线都由完整导出字节一致覆盖；原公开检查点没有提供未舍入的金融数据，不能把界面值当作原始小数。

两实例均通过真实 `command({type:'pause',value:0})` 恢复，随后各运行 24 次 `step(.25)`，逐 Tick 检查十阶段顺序及完整导出字节。实际推进到 Tick 1644（6 游戏分钟），24 次全相同；最终分区装回也逐字节一致。详情及每 Tick SHA 位于 `native-r5-results.json`。

五项坏记录检查均拒绝且原实例不变：缺玩家分区、缺必需的空玩家临床托管数组、缺玩家劳动主体、缺真实地理区块、删去已声明的临床完整模块。原档真实临床订单与药品库存为零，玩家工作为空，必需空 custody marker 仍保留；有资金的临床订单另见既有 `clinical-food-cutover-01` 的 26 项存储验证。

这份结果只证明 CPU 恢复与确定性续演。没有操作浏览器 profile，没有新增 IDB 写入，没有代替普通玩家完成学堂、临床或返航旅程，也没有实现统计区模拟或局部 Simulation.restore。
