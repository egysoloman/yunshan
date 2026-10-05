# ROOT16 原件与重放

源码 ZIP 包含最终325冻结输入、依赖锁、项目入口、必要文档及本次构建产物，排除 `.git`、`node_modules` 和旧交付 ZIP。所有原322业务输入与初始实现相同；新三文件为纯观察。先校验 `SOURCE-INPUTS-325.json` 和 `ARCHIVE-ENTRIES-SHA256.json`。

在独立目录解压源码，用正常 `npm ci` 安装锁定依赖，再 `npm run build`。纯诊断：

```bash
node --import tsx --test tests/food-access-observations.test.ts
node --import tsx scripts/food-access-audit.ts --world /absolute/world.json --save /absolute/save.json --out /absolute/new-report-directory
```

输出目录须未存在；CLI只读参数、0Simulation/0step，不验证未来实际到达。CLI完整旧失败/新成功回执都在证据包，不能只摘成功输出覆盖旧记录。

证据 ZIP 按 producer 原目录名封存完整文件：食品原World/原日末/两段续演终档、逐笔收据和路线、generic787和geographic124分块及未来存档；纯因果与候选01/02；医疗旧240帧FAIL终档、自定义World、原实际driver、预运行修订、有限购粮赠送/生产/采购/治疗/工资/产污、44分块/未来24及完整闭包；完整需求阅读回执和最终325构建回执。每个 entry 均有字节数/SHA256，ZIP已做CRC和逐项SHA读回。

观察 driver 的绝对路径保留 producer 运行时原字节，未改成“重放后实际跑过”。要重放，可在隔离环境恢复记录的 `/workspace/yunshan-work/ROOT16-…` 目录及各 `baseline-source`/`source`。证据包含原输入哈希；从源码325中去掉新诊断三文件可恢复原322业务输入集合。为这些目录提供该独立安装的node_modules链接，再按原 `run-phase.py` receipt所列命令及预算运行。driver引用的继承ROOT15原件已在医疗 `inherited-originals` 与食品 `originals` 保留；使用记录路径前先逐SHA核对，不生成替代fixture。

同一时间只运行一个大型Simulation。旧失败/超时目录不可复用、不可改上限后覆盖；新验证使用新目录、新声明和新预算。医疗world是47建筑/11组件自定义fixture，不能拿默认612建筑world代替。原controlled headless宿主和高速倍数边界仍适用；重放不等于浏览器、Mac、美术或长期稳态验收。
