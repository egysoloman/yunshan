# 阶段原件收集：只读审查与调用准备（2026-10-04）

没有生产ZIP、上传Library、改repo或修改root收集器。只在本独立namespace保存调用清单、原工具字节快照、dry inventory、只读解码计数和建议。实际producer和上传仍由root完成。

## 实际核对结果

对root脚本 `package-phase-originals-20261004.py` SHA cdea1f78f270cee32eb5be393d3e74da8a6a1033a482534048eda1a709523666 完整读取。它对filesystem regular文件递归收集，跳过symlink，计算每路径SHA，包后重新gather、比原文件SHA、检查ZIP CRC和各member SHA，再生成64MiB分片并校验拼接SHA。没有按扩展名删src/fixture/save/raw/PNG或旧producer archive。

26个closed group的独立重复dryrun与root先前inventory的files SHA/size和excluded逐项一致：14,143文件、2,190,267,987原字节，变动0，外层凭据pattern计数0。原目录排除项共40，38个node_modules依赖link及2个临时.git，没有实际误删src/原件证据；`.cache-9`等原fixture文件没有因`.cache`目录名规则被删。

补充只读ZIP/gzip递归解码计数：716原archive路径，内容去重后9个ZIP/18个gzip、485,760,779解码字节、4,962成员；pattern计数0、解码错误0、跳过大成员0、深度截断0、source SHA变化0、symlink-mode member0，10.14秒。不会提取成员或把内容写盘。去重仅节约审计CPU，原交付仍保每一个路径。这个有限regex计数不是所有格式/所有凭据类别的全面分类。

重复内容统计：1,935个unique SHA，12,208条额外同SHA路径，重复字节1,610,899,191。原10个producer ZIP有9个不同SHA。原public教育ZIP的两个相同副本、家庭v1/v2、城市地图前后包、道路source/runtime包都保留；归档中的唯一manifest/旧版说明或只存于ZIP的成员因此没有丢失。不得因为新包看似相同就删除原版本/FAIL来源。

## 31组完整建议与五组等待

`complete31-plan-await-freeze.json` 在原27组上补四组：

- roadwork-replacement-delivery-20261004-01：两份已经制作的道路source/runtime原ZIP与producer原recipe、SHA/member receipts。root已完成的26组dry plan已含它，原27组future plan尚未含。
- ROOT07-browser-20261004-01：原before/as-run/source-after、build副本、原driver和tools-only修补、WebGL/captures初次FAIL、PNG、现有receipt及后续再验。整个producer还在追加，不能只打包现有PASS子目录。
- ROOT07-report-draft-20261004-01：报告、矩阵/备忘录草稿、声明索引、完整提示词/AGENTS/矩阵快照、历史审查和各run当时快照。必须等待producer最终改写结束，不能把现稿当终态。
- root07-economy-readonly-observer-20261004-01：实际观察器source、binding、原before-spawn wrapper rejection、运行日志、增量观察和最终结束证据。需等observer真正ended。

五个WAIT group：old-company-regression、ROOT07-city-continuation、ROOT07-browser、ROOT07-report-draft、root07-economy-readonly-observer。前三组有尚缺final receipt/仍执行的owned scope，report和observer也尚在写入。checkpoint共17,646路径、2,803,516,306字节只是瞬时统计，不是可打包的终态。`group-coverage-checkpoint.json`按组记录source/as-run/raw/实际失败receipt/fullsave/PNG/既有ZIP覆盖；文件名计数是查漏指标，不能转作测试通过数。

原stairs namespace目前只有7个motor/geometry/query/fullsave JSON，包含source/revision标记，没有独立src/as-run全文。collector没有排除它的source：这是当前原件存留形态，不能凭包内最新ROOT07代码补称旧独立motor运行的完整源码原件存在。实际Git旧源和ROOT06/07组合源另保，旧/tmp证据缺失仍应按原历史审查标记。

此外root顶层collector、实际使用plan、run-phase-v2.py不属于现31个directory group。已在 `inputs-original/` 保存本次读取的4份字节+SHA供review，root最终生产包前应把自己实际执行的最终工具/plan快照纳入一个closed辅助group。root可在本review代理final之后将本namespace作为第32个group；若此后修改root工具，应另冻结实际修改后的最终producer版本，不能只用本次旧快照替代。

`library-current-20261003-04`仅三个Library转移/上传helper，按明确规则不收provider/凭据/上传请求响应；不把它补成游戏原件组。原ROOT05两个Git ZIP继续单独保留，不重复塞全部repo历史：

- ROOT05 Runtime：19,820,137B，SHA5478cd05781c43795d498745b326df891e212d8c6d21833178f286fb9b8d4bc9。
- History Evidence：19,709,812B，SHA7487a493cc01231de058a99d1f8b459afab4ae095fcec827a1b9024282af97f0。

两个当前file git-blob SHA都与tracked index相同，引用清单见 `ROOT05-existing-Git-archives-separate.json`。没有复制、重新打包或上传它们。

## 收集器建议，尚未应用

1. 原收集器不会检查producer/owned run是否ended，也不enforce plan中的packAllowed/waitingGroups。不可直接对future31计划加--pack。`collector-plan-freeze-guard.suggested.patch` 仅让--pack要求packAllowed=true且waitingGroups为空；SHA cba6f560497c071a65065f999760dd785f9f185e6d1f27d70849acbc605e78eb，原root脚本readonly git apply --check exit0，未应用。这只是metadata守卫，真实ended/输入守卫/producer冻结仍须root核对，不要求用户重新授权。
2. 原secret_count只扫regular文件外层字节，无法把opaque ZIP/gzip的0解释为其解压内容计数。提供独立 `decode-archive-secret-count.py`，root冻结所有组后的最终inventory可以同法再计数。失败/解码不完整只报counts，不输出敏感内容；不得用旧26-group报告替代新增31/32-group检查。
3. 建议在producer最终版验证group为BASE下唯一真实directory、output resolve后在所有source组外，并检查声明的excludedNames与实际EXCLUDED一致。目前真实plan组均为flat名字、output在组外、excluded契约一致，未观察到此处收集错误。
4. `--pack`时manifest目前先写PACKING，最终VERIFIED收据在外部。root转发必须同时保留final collection-receipt，不把内manifest PACKING当失败，也不从无收据的包推断成功。原script在changed/CRC/member失败时保留失败ZIP和分片；这类失败原件可以留存但不得冒称可交付验证通过。
5. 全部预期原member加ROOT_COLLECTION_MANIFEST，建议最终核zip成员集合恰好相等（当前script只查重复与原members正确）；并记录最后actual collector版本。没有已观察到多余member，属于可复现性边界补强。

## 可调用入口与成本

只读inventory包装脚本不接受--pack：

```sh
python3 /workspace/yunshan-work/phase-originals-review-20261004-01/inventory-only.py --output /workspace/yunshan-work/任选全新inventory目录
python3 /workspace/yunshan-work/phase-originals-review-20261004-01/decode-archive-secret-count.py --inventory /workspace/yunshan-work/最终全组inventory/source-files-before.json --output /workspace/yunshan-work/任选全新decoded-count.json
```

`ready26-plan.json`只供26组dry inventory；`complete31-plan-await-freeze.json`只供收口查漏，packAllowed=false。独立重复dry用了约30秒；小样本deflate估算3.32秒，没有生成ZIP。稳定26组预计ZIP约664.8MB，保守0.53–0.86GB，约8–13个64MiB部分，点估计10个。按当前31组checkpoint比例估计约0.85GB/13parts，范围约0.68–1.11GB；新增最终fullsave和PNG会继续增加。总raw checkpoint约2.80GB，final会不同。

完整压缩、二次gather、CRC/解压SHA、分片等生产动作预计数分钟（稳定26约2–5分钟，当前31约3–8分钟，CPU/磁盘竞争时可能更久），不是实测producer时间。root需要预留原ZIP和其分片各一份以及失败保留空间，不能把生成完ZIP的时间当上传/Library已送达时间。

下一步：先等五组实际结束及各producer终稿；把实际最终工具source/plan加入closed辅助组；更新完整final inventory及解码counts；root自行生产并校验ZIP/分片，确认final receipt后上传并返回实际LibraryID。本代理没有生产新ZIP、上传或LibraryID，也没有扩大规则测试/长期经济/浏览器运行范围。
