# Final29 独立控制元数据交叉核对

时间：2026-10-04T08:47:48.732635+00:00。状态：`METADATA_CROSSCHECK_PASS`。

**仅 JSON 控制/manifest 对照；未读取或重哈希 payload，未打开 ZIP/parts，未运行验证或测试。** 本报告的 current SHA/bytes/CRC 来自打包 manifest/receipt，旧 SHA/bytes 来自已保存的前阶段实际核证记录；新阶段只检查它们是否相等。

| 项目 | 准确数量/结论 |
|---|---|
| 冻结计划集合 | 29 |
| manifest文件 / payload字节 | 11561 / 1619221273 |
| receipt ZIP members / ZIP字节 | 11562 / 504545705 |
| parts / 声明分片字节合计 | 8 / 504545705 |
| 安全排除 | 37，全部node_modules；manifest内排除子树行数0 |
| 旧控制文件SHA/bytes对照 | 16/16匹配，报告漂移0 |
| 旧CLOSED引用SHA对照 | 24/24匹配，报告漂移0 |
| 前阶段9组完整inventory行对照 | 5386/5386匹配，缺失/变化0 |
| plan closure evidence在manifest | 29/29存在；新控制未重hash |
| 其他元数据约束检查 | 42项，失败0 |

执行计划与 source-files-before 内嵌 sourcePlan 的解析 JSON 完全一致。receipt声明 `VERIFIED_ORIGINALS`、originalFilesStable=true、changed/memberSHAErrors空、crcError=null、secretPatternMatches=0；这些实际payload结论在本次均为 **PRODUCER_DECLARED_NOT_REVERIFIED**。独立restored verifier仍按父代理状态为运行中，本报告没有读取其结果。

归档声明SHA：`e4f12462404f8eaf0e9d80499b27e681371b79a2bb58477fb7282f6e77dc3d88`；与 receipt.partConcatenationSHA256 相等。分片名称连续，最后一片 34783657 字节，其余七片均 67108864 字节。

## 控制与已列项覆盖

| 前阶段集合 | 旧index列项声明 | 前阶段inventory匹配 | 控制匹配 |
|---|---:|---:|---:|
| ROOT09-collision-self-20261004-01 | 321 | 323/323 | 2/2 |
| ROOT09-npc-tread-motion-20261004-01 | 0 | 1370/1370 | 1/1 |
| ROOT09-sanitation-20261004-01 | 556 | 558/558 | 2/2 |
| ROOT09-visual-city-life-20261004-01 | 235 | 1251/1251 | 2/2 |
| ROOT09-public-employment-transfer-20261004-01 | 932 | 941/941 | 2/2 |
| ROOT09-fiscal-readonly-20261004-01 | 17 | 19/19 | 2/2 |
| ROOT09-integrated-fixture-cause-readonly-20261004-01 | 628 | 630/630 | 2/2 |
| ROOT09-post-stair-economy14-20261004-01 | 4 | 270/270 | 1/1 |
| ROOT10-natural-public-staffing-feasibility-20261004-01 | 22 | 24/24 | 2/2 |

这些旧index列项计数合计 2715，并不等同最终全29文件数。npc-tread-motion前阶段没有独立authoritative flat index；本次从已保存完整inventory的manifest行对照补充覆盖，未据此改写原CLOSED/index。旧control/index内容是否保留由前阶段实际digest与current pack manifest字段相等支撑，不表示本次读取并重新计算了其SHA。

## 指定保留项

旧review控制清单的40项全部SHA/bytes匹配，声明字节合计 9074489；其self manifest另被收集，review命名空间现有 41 个manifest行。self manifest声明 7797 字节与当前控制文件元数据大小相同，但其SHA本次未独立重算。

finalplan原件四个已列项在producer/final-plan-preparation备份全部SHA/bytes匹配，含index自身共 5 项 / 71683 字节；原CLOSED声明 furtherWritesAllowed=false。index自身被保留且声明字节与当前JSON元数据大小相等，其self SHA本次未独立重算。

财政ROOT07旧几何至少保留 1 项：
- `ROOT09-delivery-producer-20261004-01/original-dependencies/root07-architecture-floor-plan.ts`，50032 字节，SHA `510accde2f5d6363bf8b754facfb3e4f0d3cbcc322ec585d5f66c2f9850d84e1`（manifest字段对照；未读取源码）。

## native candidate 与 root05边界

冻结计划明确 `nativeCandidate258WholeEqualsRoot05=false`。当前manifest的native candidate source前缀 268 行、root05 source前缀 335 行（各含dist 7/7 行）；共同前缀相对文件 265 项，SHA/bytes字段不同 2 项。这是已收集manifest的元数据比较，不是重新核证full258输入图。

已明确保留不同版本的两项fixture：
- `tests/public-employment-fixture.ts`：candidate SHA `a74b625fdfc1e50c916b202c66a03c14f984c526161a0c59d94e3a02bfb4c37b`；root05 SHA `fea43f0da8c65334bac9e57a088aaeadd601b1794ddd988cd96b18497ec5aeb7`。
- `tests/roadwork-replacement.test.ts`：candidate SHA `4700d1ef728d157f539c28311c84717c3db20cca67fe26919b02e4f22014423c`；root05 SHA `6cb50c0c282dd3e0c39c66718492a6b806d1d9565b64e5bf3f474dacc967dc44`。

不能把runtime59或所选patch目标一致解释为native candidate全258与root05全258一致；两套原始fixture版本继续分别保留。

## 安全排除与剩余不足

37项排除均为各组node_modules，producer reason为 dependency/private/cache/git or symlink。本次未查看这些目录或跟随链接；current manifest没有任何已排除节点或其子路径。实际symlink状态本次没有重检查。

历史缺失仍保留冻结计划声明：34个历史run、25个独特path/SHA对，不能声称所有历史输入已找回或可全部重放。manifest.completeGoal及receipt.completeGoal均false。uploadStatus=NOT_ATTEMPTED，newLibraryIDs为空；没有Library操作，也没有全量上传结论。

source-files-before.status=PACKING，以及冻结计划archiveCreated/partsCreated/uploaded=false，是pre-pack快照；它们与后续receipt VERIFIED_ORIGINALS属于不同阶段，不应把快照字段当成当前上传/验证状态。

本报告只能报告控制元数据没有发现漂移。独立restored ZIP成员真实SHA/CRC、nested scan及payload完整性，需要父代理正在运行的独立verifier实际结果。本报告不能替代其PASS。

逐控制、CLOSED引用、review40、finalplan备份、差异、排除和约束详情：`metadata-crosscheck.json`。只在本次新的独立review目录写这两个文件，未写任何已关闭组。
