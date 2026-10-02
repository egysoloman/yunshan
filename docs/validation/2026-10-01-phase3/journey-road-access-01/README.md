# 连续道路起点接入与实体柜台回归

本次生产修改仅 `src/journey.ts`，规则回归仅 `tests/journey.test.ts`，并保留原生 r7 下载存档的 gzip 测试原件。修改不会迁移存档、传送玩家、改变世界布局或支付票价。根代理负责备忘录、全套候选构建和唯一浏览器运行。

道路中段的起点先投影到真实 road/bridge 折线。当前 `getWalkHeight` 所占楼层、短连接的实际步面与碰撞决定可接入的折线，保留通向两端节点的剩余折线，再按真实剩余距离执行多起点 Dijkstra。转乘规划使用同一接入段，原有上下楼共享楼梯路径保持。短接入按 x/z 轴依次检查共享柜台、交通栏杆、建筑墙体、河流和 Controller 的 2.6m 断崖条件。柜台描述按世界缓存，读取不会改变实体库存或资金。

## 原生 r7 失败与修复

原下载：`artifacts/phase2-player-journey-r7-export/resume-ui-export.json`，1,537,646 bytes，SHA256 `669e7bc4ed83c970ee942ab34f557ed92669d8b2d34c5eb108478efca305a76b`。测试原件：`tests/fixtures/journey/r7-native-ui-export-coherent02.json.gz`，解压字节与下载严格相同；没有读取或操作 Chromium profile。

`old-native-failure/` 保存 coherent02 的完整 81 源清单、原失败脚本和原始日志。原精确身体 `[-379.7179431004984,49.707051422487545,516.9469250512725]` 被最近节点引向低层钱庄门，再指向 `[-380.4,45.4,520]`。实际生产 Controller 的 KeyW 复现 z 轴停住；候选步面跌落约 4.461m，超过 2.6m，交通栏杆检测为 false。

`pre-counter-13/` 是修改旅程接入后、加入新的实体柜台契约前的 82 源验证：13/13 与严格类型检查通过。该结果保留其原有范围。

`final-28/` 是 coherent03 完整 89 源的只读副本，仅替换本代理的旅程源与测试；不是把 coherent02 运行与后加源混在同一计数。实际原生 r7 身体接入 z=512 的原上层街道，沿原折线通过实际 KeyW Controller 232 次 step 连续抵达 market-station `[-330,52.6,460]`；转乘接近段保留相同起点与投影。完整 walking/transit points、各节点身体位置和地面高度在 `journey-proof-results.json`。原存档及所有 89 源 SHA 前后保持相同。

## 柜侧真实阻挡反例

`old-counter-failure/` 独立保留 coherent03 漏掉柜台谓词时的失败，不把这个固定小型路网称为 r7 原档。柜台由生产 `marketCounters` 生成，支撑高度由真实 `getWalkHeight` 得出。西柜真实尺寸 3.2×1×1.2m，中心 `[-9.6,.5,13.2]`；站在柜外 `[-13.2,0,13.2]` 的旧规划直连 `[0,.6,13.2]`，实际共享 Controller 的 100 次 KeyW step 停在 `[-11.76,0,13.2]`。旧规划画出的线穿过实体柜台。

`final-28/counter-check-results.json` 再次按相同 provider/步面/Controller 验证。新步行和转乘规划均明确返回 null；这里只有一条穿柜垂直接入线，没有承诺自动绕柜的自由地形搜索。世界、玩家、资金和真实柜台均不变。

实际命令及退出：

- `node --import tsx --test --test-isolation=none tests/journey.test.ts tests/site-fixtures.test.ts tests/controller.test.ts`：28/28，旅程 14、Controller 10、柜台 4，exit 0。
- `npx tsc --noEmit`：exit 0。
- `node --import tsx proof.mts`：原生 r7 身体连续道路前缀 PASS，exit 0。
- `node --import tsx counter-check.mts`：旧穿柜路径明确拒绝 PASS，exit 0。

归档 `frozen-code/` 包含旧、新规划源及各自 Controller；新共享柜台源也保存。各原始运行的清单和日志独立保留，`status.json` 记录精确范围。归档 SHA 清单用于后续只读复核。

## 未完成范围

本次实际身体检查走到首条道路的端点；没有把剩余学校路径或浏览器正常键鼠旅程记为完成。根代理的 coherent04 全套规则与唯一 GL 续行尚待执行。短接入不是自由地形绕行器；现有纯规划 API 未接收玩家新增体素障碍，实际身体仍服从这些障碍。保存原件为暂停状态，CPU 前缀检查不推进模拟时间或修改存档。统计化远区模拟未实现。
