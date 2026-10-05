# coherent09：住宅交互与连续时间的阶段原件

本目录保留冻结09的已完成检查，**原完整规则496/496通过**；城市完整目标、参考美术、长期经济稳态和macOS实机均未验收。09原完整命令于2026-10-02 14:10:27 UTC结束，exit0，0失败/取消/跳过；102输入首尾相同。后续动态床侧窄修已另冻结10，不能将09结果冒称10全套。默认首夜和编译3D/原生IndexedDB床旁操作尚未运行。

- `npm run build`：exit0。
- 原住宅17项＋NPC连续时间12项：29/29。
- 原native r5逐字导出/24步续演、模块manifest及旧扩展迁移：3/3。
- 官方 `env YUNSHAN_UI_PORT=4193 npm run test:ui`：35/35、errors=[]、exit0，2026-10-02 12:54:50—13:02:05 UTC；102源首尾逐SHA同。

这些检查范围分别记录，不能相加成完整套件计数。DOM与完整规则计算有约7分钟重叠，不是性能基准。DOM使用真实Simulation、CityUI及PlayerController的受控地点/身份/需求fixture，没有实例化CityRenderer；图中背景和FPS/绘制数量是fixture ViewState，不能作3D截图、普通玩家全旅程或实测帧率。当前新源码35项不是沿用旧07的结果。

## 直接查看

[床旁进行中](ui-home-rest-active.png) · [桌旁按钮禁用](ui-home-rest-table.png) · [离床暂停](ui-home-rest-paused.png) · [完成20分钟](ui-home-rest-completed.png) · [明确取消](ui-home-rest-cancelled.png)。根代理已实际核看当前active/table原件。

[DOM完整原件ZIP](dom09-original-evidence.zip)包含102份as-run输入、12个新UI原件、原日志、回执、运行器及校验清单，共120成员、7,188,882字节，SHA256 `1b1c74c3774cf48a361d3e0f75715679c0d365e718c9453a8909f0ff0eb8de53`；CRC及逐成员原字节/SHA核验通过。ZIP内备忘录是冻结时的输入；另附13:04审计副本，不能将两者冒称相同时间版本或最新Library稿。

## 已实现修复的范围

住宅休息必须在合法真实床側累计20实际分钟；离场暂停，返回后明确续休，取消保留已恢复值。NPC延迟更新累计实际tick分钟，交通到站后只将到站以来的分钟用于步行/恢复，未抵站不会因停驶且距离小于40m而提前下车。旧已到站档没有时间戳时保持初次逐字导出，首次真实traffic tick才物化加载时观测时刻。

未标记床几何的真实旧r5档保持homeRest缺席及原9项manifest；现代有床世界的合法缺席档初始化新模块。当前模块被删仍原子拒绝。原r5 fixture/hash/严格字节与24步续演断言未改。

## Library交付阻碍

本轮DOM ZIP与13:04审计备忘录原件新有序保存任务仅一次，13:08:34 UTC在准备前因网络失败，0 Library ID/0file ID/0版本；未传输或完成，未改旧Library实体，未重试或切换direct。见[原回执](library-delivery-run-status.json)与[原错误](library-helper.stderr)。两份原件保存前后SHA同，白名单/敏感模式计数均0。此目录是本地准备的Git备份，提交/推送以真实后续回执为准，不是假称Library附件。

[原完整日志](whole.log)与[最终原回执](whole-run-status.json)记录496/496、exit0及102输入起止；不得根据本阶段原件推断通过、删去历史失败或宣告全部城市已完成。
