# ROOT15 npm test 串行进程隔离独立只读审查

结论：同意这次 package-only 修复。Node v24.19.0 的原生 CLI 支持 `--test-isolation=process --test-concurrency=1`；它让每个测试文件使用独立子进程，逐文件串行执行，同文件内原多个测试与helper模块缓存仍共享，文件进程退出时释放其整个模块堆。117个测试文件、所有原断言／seed／layout／自然step bound原件保持不变。本次静态检查没有发现默认suite必须依靠跨文件共享内存或另一test模块导入的具体依赖；存在一个既有条件旧fixture通道，见下文。没有运行新的测试或模拟，也没有声称修后完整suite已经通过。

实际原失败已经明确：full-rules01于2026-10-04 20:33:19.446694至20:45:19.759837 UTC退出134，timedOut=false、318输入稳定、owned active[]。原raw包含约4076MB附近GC及 `JavaScript heap out of memory` fatal；完整raw SHA `2473a9aa29be0b9f4612535061fb788f91be85db701c3d2e5f335013f91d7b3a` 已实际读回核对。原OOM文件／receipt复制为证据，不改原件。先前静态报告对“当时尚不能确认OOM”的判断保持封存；本报告记录随后发生的实际退出事实。

## CLI与对象生命周期

本地 `node --help`列出test-isolation与test-concurrency；另直接执行 `node --test-isolation=process --test-concurrency=1 --help` 退出0，只有CLI帮助／参数解析，没有执行test模块。已封存本地Node natives，`internal/test_runner/utils.js:306,326–329`读取isolation并在process模式读取concurrency；`runner.js:879`只接受process／none，945–965以显式1建立worker并发上限。995–1016给每个testFile创建FileTest，492–523在FileTest body中spawn独立child。`test.js:680–683,904–905`设置数值concurrency并以activeSubtests门槛排队；本CLI并发1意味着同一时间一个测试file worker，不是117个worker并发分配。

`runner.js:getRunArgs`保留原`--import tsx`等执行参数，并为process worker传入单个path；parent不会先import全部117用户test模块。同file全部顶层test、shared factory、before/after和缓存仍在一个child内；因此public-employment-transfer的自然预运行、market-shopfront共享simulation、world.test三世界及同file的continuation cache不被拆散。进程退出使跨文件的已加载module／world缓存累积消失；不会跳过单文件里的原重构造／自然模拟，也不保证任何一个文件本身绝不超限。

原“117模块导入完成后才启动test”的bootstrap屏障现在分别发生于各文件child内，避免同一JS堆同时保留全部17模块的19套完整world与后续cache。相比修改17个test模块的describe/before/after生命周期，这次已证全套none heap OOM的首步适合只改package CLI；无需为此先重写测试源。以后若单个文件仍有实际资源失败，再针对那个文件做保断言的局部生命周期修复。

原命令与读回新命令：

```text
node --import tsx --test --test-isolation=none tests/*.test.ts
node --import tsx --test --test-isolation=process --test-concurrency=1 tests/*.test.ts
```

共享package实际读回SHA `5c354ed4cc632ced189e9dd93f40e29c03a7725c136d955d31a27c50fafc5c57`，原package SHA `078a94b045a55653aee7f6ff131ed6a58a70e50c0c5ea839a2c81ed6c0f51a03`。JSON语义只差scripts.test这两个参数，没有增heap、改clock、删用例或改seed。独立逐318共享输入观测仅package.json变化，78src与117个test文件SHA均保持原final318；观测图 `b5b126b81c81726c85e6c6d7ac1ff486c2ede464aa5deb2825ba405ff861eff3`。这是只读观测图，不冒称parent新的source-as-run回执或修后实际运行。

## 跨文件依赖审查

AST扫描117个原 `tests/*.test.ts` 和14个transitive test-side helpers共131模块，parse diagnostics=0；没有静态import、dynamic import或require另一 `*.test.ts` 的路径。原glob不含adapter目录另两个test，该范围未扩缩。没有发现默认测试用例以另一个test文件的module变量、browser对象、global DOM桩或模拟实例作为必要输入。

已读的globalThis window/document/performance临时桩均有本file finally恢复；persistence的browser-page `globalThis.__name`只注入该page。不能把名为global的save-document局部变量误判成Node共享global。14个shared test helpers的唯一可变module状态是family-fee-education-fixture.ts:9的WeakSet，73 add(sim)、141 has(sim)用于同一个模拟实例的受控continuation，未发现需要另一个testfile先填充它的调用。

bare hooks仅chunk-residency16／17、persistence20／34、trade17／18、world-layout19／20、world-v4 16。初始化变量、证据数组、browser/server消费者都在各自模块内。process隔离仍执行每文件所有原before／after，persistence浏览器完整用例与清理仍保留；先前跨全suite保留browser的问题自然缩为该文件进程的寿命。静态检查没有发现其他file依靠persistence的browser/server开启。

条件式旧fixture通道必须保留：research-offsite-causal.test.ts:17–23可按 `YUNSHAN_RESEARCH_OLD_PENDING_DIR` 写pending-save.json／pending-provenance.json；research-labor.test.ts:167–169、182–183读取同配置目录。写端19行要求旧baseline job.laborVersion===undefined，读端未配置则原样skip。本任务没有读取环境变量值。该目录应是显式预制的旧source fixture，不能期待本轮新source某个test先生成它；process串行不制造旧fixture，也没有删除这组条件断言。此fixture关系原none命令也已有，不是CLI新增依赖。

静态检查不能排除所有运行期动态依赖；原完整命令的新实际结果仍是必要补证，不用只读结论代替。

## 必须保留的验证范围

process模式下裸sourceHashes before/after自然变为每文件自身执行窗口；原none的root hooks覆盖更广的整个suite。为保持原整套源码／fixture不漂移的证据，外部runner仍须使用全部318输入的before/after manifest（含新package），不能只依靠缩短后的文件内部hook或只核对78src。parent已计划保持该wrapper与整体cap3600；本任务没有更改它。

外部cap3600仍限制整个原完整suite；测试内部默认Infinity和同步CPU循环不能被JS定时器强制中断的限制没有被这两个CLI选项改变。没有扩大cap，没有加heap来下结论。进程隔离会重复TSX/source导入并增加启动成本，实际总耗时、单文件峰值、退出状态必须由新scope完整运行确定。失败与PASS只属于各自不可变source-as-run图，不能覆盖旧exit134失败或旧GPU318结果。

## 只读边界与自含证据

本任务0测试／0world factory／0Simulation构造／0step／0GPU，未写shared、package、harness、CLOSED、Git、旧封存报告，未读取环境值或凭据。共享package修改由parent完成，本审查仅读回。

AGENTS及提示词SHA与先前完整阅读相同；备忘录当前431354 bytes／SHA `bb74b8a3d4aa8f77166bce1a6ca1130919ab94afe2d7ac7396fc7d2619c07dda` 与已读完整原体＋3465-byte prefix逐字相同，无新prefix。复用完整read-ledger与原文快照在新root-evidence中。旧两份REPORT/EVIDENCE-INDEX SHA读回保留在新目录，不改它们。

`root-evidence` 保存CLI help、本地Node natives、原／新package、原OOM完整raw/receipt、318逐输入观测与文档ledger；`cross-file` 保存131 AST、全原source与条件fixture通道审查。`EVIDENCE-INDEX.json` 索引本任务材料SHA。新完整套件运行由parent串行执行，本报告不写成独立已运行。
