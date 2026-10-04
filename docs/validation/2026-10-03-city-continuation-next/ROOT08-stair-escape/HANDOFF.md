# ROOT08：原生楼梯顶端出路修复候选（已验证、未接共享）

生产者目录：`/workspace/yunshan-work/ROOT08-stair-escape-20261004-01`。本组将以最终 DELIVERY.json 为关闭回执；没有额外 review 子组文件。所有工作独立于 `/workspace/yunshan`、ROOT07 冻结源、私有 MZ、Git 和 Library，没有接合、提交或上传。

## 精确原因与改动

真实 ROOT07 14 日审计仍是 **FAIL**：citizen-45 叶舟在 tick9559 死亡。记录的 before 坐标 `(-171.73600000000002,80,190.9869782779261)` 位于原 home market-b18 的 0→1 canonical 梯线 segment21 内，投影距离0。完整 .35m 支持为 stairs/floor1/y80，但上层 slab 支持选择没有 link；slab-only `canStandInFloorPlan` 为 false。原 `needsStairRecovery` 的 `if(!support?.link)return false` 让端点直接拒路。独立复制原241输入后实际 pure query 同样24合法无体素床侧点及地面门全部null，raw 与另一独立诊断逐字相同。

最终只修改 `src/architecture-floor-plan.ts` 的路由恢复：

- 非平面 supported stairs 起点寻找相邻真实 canonical link；无 link 连接仍逐点同高、完整身体支持和静态墙检查。保存实际验证的投影点，沿该连接接到真实梯线，按包含段选择上/下方向。
- 用 null 与空候选数组区分无需恢复/恢复失败；失败不能降脚高进入 planar 路由。动态阻挡时尝试有限候选，完整拼接结果的每段（包括外门 tail 与接缝）都执行原 callback。
- canonical 出口必须真正平面可站才进入递归 tail，避免异常可变 descriptor 重复恢复。没有增设几何 revision、修改任何 building/World、放宽半径/净空/ACL/route cap/存档上限或改变移动速度/时间。

`floorPlanSupport`、几何生成/共享 descriptors 和其缓存生命周期没有改变；原 support descriptor 仍无 link，并未改它来掩盖路线原因。

## 最终同源实际验证

final production SHA：`c95e83f8f61920877f3207dbebe1f62183700f6ec4aa49e1e4403e9ef486f513`。完整 as-run 源246输入及哈希为 `candidate-final-source/` / `candidate-final-inputs.json`，多出的两个临时 scripts 只用于诊断，不接共享。

| 实际范围 | 结果 | 原 raw SHA256 |
| --- | --- | --- |
| targeted03 新7案，03:50:22—03:53:05 | 7 PASS /0 FAIL /0 SKIP | e539dae72e6b73a794f7a1b71df4c07230a9fe46befbb93deae0603c3f9a167b |
| related02 原楼梯10 + 商业路线2，03:50:22—03:52:35 | 12 PASS /0 FAIL /0 SKIP | 6a90836cb25528dffb57edb9f9dc7605f823a66e099933a6c2752da6a20909d7 |
| six-recipes02，03:50:22—03:51:20 | 原1案内六旧配方×3种子=18完整World文本/指纹一致 | b3ddd90fa2dc0138be5078aa62d50fb7610adb5d66eb2f586e89e374f9797386 |
| build03，03:50:22—03:50:53 | TypeScript + production build PASS | 174407d75d3973b9515add48fd42b56a4337e256332285024166868e5163c3c2 |

以上四范围各自246执行输入首尾稳定、非超时、自有 activeDescendants=[]，没有运行新14日、GPU或benchmark。生产入口 `index-CQ4tifGu.js` SHA `0ba6e7fbbff938d32b89ad91c1bd3c52033b9054c5ecc5dc2b2c5b0fc0d2921f`；软件构建不证明 Mac 性能、美术或新浏览器全流程。

新7案的实际证据：

1. 记录的真实 before 点→所有24合法床侧点（楼层0—11）及原门均可行。40,010个≤.05m样本检查实际 support-height 身体站姿/.35m全盘/1.72m净空、原墙碰撞和每步≤.2m，最大真实 rise 0.20000000000000284；门外短段另外由真正 Controller W 走过。
2. 六建筑族加商业楼，共126条双向路径；39个无link非平面起点、42个侧向合法起点。受控回调确实阻挡最近 attachment 后选另一个真实合法 connector；受控 malformed canonical exit 有限拒绝；最终门tail负例确实由原 callback 拦下。
3. 一次受控合法起点后真正 CPU EventTarget W 连续到床再到门，没有中途重置脚高/位置；108+656实际steps，最大水平步.072m、最大rise.2m。原上层 ACL 拦截仍成立。它不是普通 URL 操作旅程。
4. 原 ROOT07 终档原bytes SHA `79ec2e152163525fd8dbabcf3f6090b23c106460409175fed147a2729dacc547`，当前 reader 即时导出完全一致，完整/分块原样重组；两个当前 reader 正常24步每份完整档相同，死者持续dead、终 tick10104/alive615。**这不是与旧 reader 的未来 oracle 对比，也没有把终档死者复活成原9558续演。**
5. 原默认 fresh living c45 保原钱包183.34031272679567/商人/住所/工作/原健康89，只受控设一个合法初始站位为 before点和低疲劳0；之后仅普通 .25分钟ticks，真实68tick到 floor5原床，state atHome，fatigue0→.115，health自然更新为88.96458322717015。原 opening/after完整档与逐tick轨迹保。这是受控正常调用链正向，不能冒整个自然14日已通过。
6. 原商业 citizen562 writer仍482点，泛用1025坏路由原子拒绝、旧未发布draft拒绝，完整/分块及24续演保持；原受控 NPC 高层正常移动760步/maxDistance.042/maxRise.01878、双方向 midflight身体支持均保。

## 保留失败与真实限制

所有失败源/driver版本、原 raw、before/after输入与owned清理都保留。`original-query01` 是新工具相对导入目录错误；`original-regression01` 真旧源目标案0/1失败；`targeted01` 与 `geometry02` 新 raw-reference 逐段检查2失败；`build01` 仅新driver nonexistent wallPanels字段/新test counts隐式类型错误；`outside-tail-v5-negative01` 是候选v5重构丢失外门callback的实际回归，最终完整result guard及新negative已修。v1—v5 as-run改动源/driver snapshots与早期PASS均不冒最终v6结果。

raw-reference 两失败没有删除或改成PASS。精确 `segment-diagnosis01` 证实这不是换 floor hint 能解决：hint0/1及actual support.floor0 都 raw-segment blocked，原 reference feet y79.777→79.755 对应真实台阶脚高79.8。实际 Controller 按原 support.y 站姿移动，原碰撞检查通过。最终 checker 保 raw-reference support/gap数据，同时检查真实支持站姿；在这次24床/门扫描中仍记录 **4859个 raw-reference blocked 观察**，最大reference/support gap.152380952m，绝不称所有 raw插值段无碰撞。

原 NPC moveCitizen 的 y 仍沿 canonical waypoint reference 插值、只在原道路允许规则下移动，并未增加 floor-support snap。本补丁只修重规划出路。原 zero-length self-query 的 corner投影可能0/0→NaN，因此 selfBlocked=false 不能独立充当完整身体清障证明；实际 floorPlanSupport 的 full-solid 判据和非零物理站姿段检查另保。这两项留给下一独立碰撞/移动因果修复，不顺手放宽断言或修改速度。

原 death-before 没有完整save/route、最早卡住tick未被采样。只有其记录坐标、真实 immutableWorld、原终档与静态路线，不能造死前完整回放。原14日 FAIL不改，ROOT08 新完整14日仍 NOT_RUN；宏观经济稳态、美术、动态城市、家庭一生和Mac等完整目标继续开放。

## 安装与继续

根只接 `INSTALL_CONTRACT.json` 4文件allowlist：一个生产file、新独立可用test、两个相对 native fixture。原生产 beforeSHA `510accde2f5d6363bf8b754facfb3e4f0d3cbcc322ec585d5f66c2f9850d84e1`；完整241原输入中的240文件逐字不动，其他54 src不动。permanent tests没有 `/workspace`私有绝对引用；gz fixture570,848B解压仍为原终档bytes。两个临时 scripts 不安装。

`stair-escape-production.patch` / `PATCH_CHECK.json` 已对独立 before源实际 git apply --check PASS，未apply到任何共享树。独立 review 子agent final v6 STATIC通过，消息记录在 `STATIC_REVIEW_RECORD.json`；它未执行模拟/测试/GPU，没有另外的文件 namespace。

下一由root核4 SHA守卫接共享（保原两个test-only修正），新冻结实际仓库输入并验证build/完整World一致，更新memo/matrix及新版本范围；新14若执行仍另同源审计，不冒本7+12成全目标完成。原文件收集/Library/commit/push均由root另处理，当前新增 LibraryID0，不能说附件已送达。
