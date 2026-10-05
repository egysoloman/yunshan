# 云山城市生活阶段交付

当前ROOT08244输入已接入通用楼梯原点恢复；原14日审计FAIL保持，修复后新14日未运行。完整游戏、参考美术和Mac验证尚未完成。

`REPORT.md`为当前及历史版本说明，`validation-results.json`将各运行源分开记录；`current-frozen-inputs.json`是当前输入清单，`root07-frozen-inputs.json`是原审计版本。新7案/原相关12案/旧18 World身份/严格构建通过，安装后244新构建与World全JSON守卫另通过。

- `ROOT08-stair-escape/`、`ROOT08-current/`：最终修复和当前冻结原件。
- `economy/`、`ROOT07/economy14d01/`、`ROOT07-death-diagnostic/`：原FAIL、完整终档、死亡诊断。
- `ROOT07-browser/`：原11城市图、3家庭UI图与各界面范围，ART仍FAIL。
- `city-map-v6/`：真实数据2D地图PNG/SVG/PDF与WorldJSON/CSV。
- `economy-plots/`：原14日六图原PNG/SVG/PDF，actual存活FAIL与存档24PASS分开。
- 最终`delivery-receipt.json`及`originals/collection-receipt.json`：Library和分卷/原件真实状态。源码ZIP生产时的快照不包含之后产生的最终回执；从Git此目录读取最终状态。

启动：Node>=22.19，`npm ci`，`npm run dev`；发布构建可`npm run build`、`npm run preview`。`npm test`会运行所有永久规则，用定向命令可只复核楼梯：`node --import tsx --test --test-isolation=none tests/stair-escape-origin.test.ts tests/stair-continuity.test.ts tests/world-v6-commercial-routes.test.ts`。Safari/Chrome/Firefox在Mac实机尚未验证；软件GPU检查不作FPS结论。历史MZ编译资源不冒当前核。

所有能保留的source、as-run driver/raw、FAIL/timeout、完整save、原PNG和原生产者ZIP保全原路径。Git64MiB parts是一个ZIP的顺序字节分段，单part不能解压；用同目录恢复脚本按collection-receipt重读SHA后重组。最终归档校验和Library保存均以真实回执为准，没有ID即没有送达。
