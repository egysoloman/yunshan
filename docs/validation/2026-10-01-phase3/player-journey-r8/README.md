r8 原生恢复通过，但由生产者停止流程而未行走

使用89源三方一致的 `/tmp/yunshan-phase3-root-coherent-04`，严格入口 n3tM-54D/SHA ebdd21602dfac48e4dfb958ec980f4fa8ddc24d543eb6739c92a3c5d9c38067b，原9945c52…脚本、原4193/r5 profile。2026-10-01T23:05:29.910Z 实际原生读取恢复 r7 的 [-380,50,517]、509.16云币、第1日20:57、住所/身份/成长全匹配。实际原生导航及纯生产planner记录同层 z512→market-station 的正确线路，剩余规划1620.98m。没有 KeyW 或 walk 输入记录，学校未到。

生产者先误认为启动仍无resume记录，23:06:49停止了核对过的自身Node；停止前日志已有resume，程序只记录progressExists=true却未据此取消停止。这是生产者的停止判断失误，导致 mouse.down page closed，最终failed/exit1，并非生产导航/碰撞失败。原 interrupted-startup.json 的scope基于较早观察仍写before any resume，保留原件不改，以上述真实时间戳及results/trace为准。

完整89源、入口和执行脚本起止保持一致；所有原始文件逐字节复制，profile未归档。浏览器上下文恢复旧标签页的怀疑尚未由page URLs实证，进程数不可替代GL页面数量。下一外部脚本将只改启动页管理/日志，保留89源和旧脚本，先实际核查公开URLs。关闭时的自动保存可能推进了实际时钟，后续必须真实读档核对，不修改保存字段或把断言预期改成通过；必要时原生记录新的真实checkpoint。
