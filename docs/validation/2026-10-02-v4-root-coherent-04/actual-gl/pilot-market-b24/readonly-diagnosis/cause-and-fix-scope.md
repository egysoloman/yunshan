market-b24 一层到二层首踏步失败：只读因果审查

本次实际浏览器运行保持 FAIL。没有重跑、绕位、改玩家位置或修改生产 source。GPU 已关闭。

实际最后可支持脚点为 [-404.59997341778063, 80, 308.791474723644]。正常 .015s、4.8m/s 的下一段 z 增量为 .072m，目标 [-404.59997341778063, 80, 308.863474723644]，局部点 [-13.79997341778062, 3.4, -7.336525276356042]。floor2 权限允许，blockedAccess 为 null。

精确原 provider 的 floorPlanSupport 先按迈步前的 local.y=3.4 筛选 nearStepRects，范围 [2.98,3.62]。第一踏 top3.6 入选，第二踏 top3.8 被排除。上层有真实 stairHole，slab 不覆盖孔，因此这一步的支撑 union 在 z=-7.0 结束。身体中心到边界 0.336525276356042m，小于身体半径 .35m；diskSupported=false，choices 为空，尚未进入任何 localSolids 拒绝。Controller 的 within&&!actual 分支先返回 false，未进行 targetHeight=80.2 后的运动碰撞测试。

仅作为只读数学比较，同坐标 local.y=3.6 时第二踏入选，union 边界扩至 z=-6.6，距离 0.7365252763560424m；up-1 的 top3.6 choice 无 solid 拒绝，真实 body support 返回80.2，按该高度检测 movement=false。诊断没有将此假设高度赋给实际角色。可见失败发生在候选支撑的选择顺序，并非墙、上层 slab、下层楼梯、屋顶或权限阻挡，也不是 route 选错拐角。

零层没有 stairHole；完整 base slab 使同一局部位置 diskSupported=true。因此已有7楼体的0→1两跑及回程通过只覆盖该范围，不能证明1→2或全部更高层通过。market-b24 本次0→1通过、1→2失败、随后下行和20秒自然NPC观察未运行，全部保留。

建议最小修复范围（尚未实现/未验证）：仅 provider 支撑选择，将可达候选 surface 的升降约束继续相对当前脚高检查；对每个候选 top 单独构建该高度的真实 slab/tread 支撑 union，再以 .35 身体圆盘检验。继续使用现有 .22/.42 步高约束、真实孔、真实 treads、完整 solids/headroom 和权限判定，不能扩大步高阈值、填孔、降 body radius 或给 controller 注入高度。需实际回归一层到二层全过程及回程、.2/.35圆盘跨相邻踏步、真实孔/外边缘负例、6.6m两跑和权限阻挡；修改后必须新 source/entry 快照再做真实浏览器复验。

诊断代码在 exact-support-diagnostic.mts。architecture-floor-plan-exposed.ts 是不可变原 provider 全字节复制后仅追加内部 helper exports，用于观察原私有函数。脚本对每个 probe 强断言诊断复制的 public support 等于未修改冻结 provider。sourceStartSHA=sourceEndSHA=9e3b35a9e3b667466e0360c287bd5b828b35e1fd2f1cd2a00228f2bb5f74a724。原浏览器 entry 为 /assets/index-DV9HXMzR.js，SHA fee4c40b14b4ac44f0e1ea475b469df689470a1f3446f8d67fab1a2b7a0c1711。
