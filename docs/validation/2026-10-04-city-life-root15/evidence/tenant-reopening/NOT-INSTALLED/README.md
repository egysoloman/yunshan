# 租户续营候选：NOT INSTALLED

本目录仅保存原私有生产补丁供review/接续，未向共享源码应用，未启用新policy。原文件名为 `PRODUCTION.patch`，不是本轮已安装变更。

- 原来源：`/workspace/yunshan-work/ROOT15-tenant-reopening-20261004-01/PRODUCTION.patch`，45,149字节，SHA256 `d04fe9b6fc5d0a72dfa2d50ff1b9bc8383c5ea4c0a594e9404ed0df3e7f73928`；复制字节完全相同。
- 基线：实际304输入/71生产源，对应 ROOT14/f1e26ff 原范围；[原基线快照](../BASELINE304-SNAPSHOT.json)，输入映射按sort-key紧凑JSON计算的图SHA `5603eaaf84575d2d59a2886b186096a6916b84c4924cd1840bd10631e4daf129`。
- 私有候选：最终311输入/73生产源；[原静态候选清单](../STATIC-CANDIDATE-CURRENT.json)、[types07原311输入](../scopes/types07/inputs-before.json)，映射图SHA `e17934ece6fd660fdb50ae518c9294bfddcc9658f24f4e11e10e3733eb6fe103`，输入文件自身SHA `64ea33cf49e371eb5235b1c35fcc9ac7323a5175b9286b3035431fd33d875118`。
- 与主任务关系：当前共享为318输入/78生产源、b5b126b8…测试隔离图；本补丁基于304，不得整层覆盖当前318源码。原HANDOFF只记录对private exactbaseline304的dry-run适用性，没有声明当前318可直接应用。7个生产hunk包括两项新host/policy源以及partition、product-city、simulation、city-ruleset、shop_lifecycle；私有proof依赖baseline304/外部原件，不能冒drop-in共享测试。

实际验收边界：pure10/10、compact4/4各自PASS；default120 TIMED_OUT_PARTIAL，即使raw1PASS/exit0也超原cap；两段256合计512普通步第三轮NOT_OBSERVED、原困难三AND均0。没有新waiting/endPending/reopening/ended实际来源，相关新状态future24未验。最终状态见 [原HANDOFF](../HANDOFF.json)、[SEAL](../SEAL.json)、[报告](../REPORT.md)。完整公共目标未因候选或归档完成。

本补丁未修改原内容；本目录整理没有运行patch、测试、Simulation或GPU。原OWNED.patch继续留在私有producer供后续按其原范围取证。
