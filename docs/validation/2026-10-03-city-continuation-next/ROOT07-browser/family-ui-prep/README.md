# ROOT07 原生家庭课程 DOM7 准备

状态：**NOT_RUN**。本目录提供外部驱动、原件归档和静态检查；本次准备没有启动浏览器、GPU、应用、build 或 tests。此前候选 UI45d7 的 DOM7 PASS 不代表 ROOT07/source55 + UI0a5b60 已通过。

本轮应用源码固定为 `/workspace/yunshan-work/ROOT07-city-continuation-20261004-01/source`，运行时文件有 55 件；`src/ui.ts` SHA256 为 `0a5b600ea4be90b4f5aaa0c919a4a999a7bf84245c13bc7dd39dac31493deecf`。历史生产者的 `FINAL_SOURCE_MANIFEST.json` 是另一份 219 件完整候选清单，其中 `src/` 有 53 件。两组来源分别归档，不混合计数或验收结论。

`family-fee-ui-root07.mjs` 的三个位置参数严格为 `SOURCE NEW_OUTPUT ROOT07_AUTHORIZATION.json`。依赖由 SOURCE 的 `createRequire` 解析；Vite root 指向冻结 SOURCE，`configFile:false`，cacheDir 位于 NEW_OUTPUT 下。三条 fixture 路由读取归档原件字节，不重新运行 fixture generator。源码、dist、旧原件与既有运行目录保持原有来源。

这里的 `staticcheck.py` 核对 v1 驱动。已准备 family-fee-ui-root07-v2.mjs 与 read-only-evidence-v2.diff，父代理已读后冻结，实际运行使用 v2：包装原 screenshot 返回后读取学校/家庭的实际 PNG、save/world/calls/DOM，并在关闭浏览器前另取死亡后保存和观察 PNG。新增 clone 导入逐字相等、取证读取前后保存相同是独立检查，不并入原七项计数。v1 原文件与哈希继续保留；本 README 不将 v2 取证描述为已执行。

原输入位于 `originals/producer-native-evidence/`：

| 文件 | bytes | SHA256 |
| --- | ---: | --- |
| ui-world.json | 6032 | 983612f2783926d51285d2b33249bc424ca32b7a30079507a8c3f6f559386eb2 |
| ui-opening.save.json | 444557 | a6f1ae16a11222fbbf9ceffa620c2bf2d4e703e9c0f4fcd9faab7d5a4bb224ef |
| ui-controls.json | 78397 | d6de9ad58df8c7b2ba7a436e601028f5e2e914d8bff039146ac97aab00bcdff1 |

原 patch SHA256 为 `32f3c26b2af6b57ab817fba533d76f8375161b5108d03ae5c3c625be16cdba6d`。`FINAL_SOURCE_MANIFEST.json` SHA256 为 `a1973816aa4df8d580155767641a6565f182219ec7e4bb9896fff624515220cb`；三输入由 `ARCHIVE_MEMBER_SHA256.json` 绑定。`ui-fixture-generation.log` 只声明 GENERATED、child、teacher 和 cash，没有生成时的完整源码绑定，不能将其描述为 ROOT07 生成回执。

保存 fingerprint 为 `f4c1d68a`、seed 为 20261001。学校一层公共课堂点为 `{x:180,y:.6,z:-13}`，家门为 `{x:0,y:.6,z:6}`。孩子是 `resident-1`、教师是 `citizen-2`，另一生物家长是 `citizen-206`；玩家为 traveler，钱包460，孩子学历0。opening 保存有404居民和20孩子；385条 pins 只覆盖384名原居民与 `resident-1`，其余孩子保留原保存。

从原驱动 `const card =` 起至原 `catch` 之前的七项断言块，以及页面 HTML 模板，须保持逐字相同：

1. 孩子缺席禁签，共同到场实际扣40形成原钱包托管。
2. 真教材 receipt、实际付薪教师与部分分钟可见；孩子学历仍0。
3. 离场暂停、到场恢复原课，没有补算或第二次扣款。
4. 取消仅退未赚托管，已付但未耗教材留原学校。
5. 家庭面板可见同一取消历史。
6. 原声明控制直接设置孩子 `alive:false,health:0` 并推进一tick；原付款权利仍可见，新签禁用。
7. 取消后的保存逐字导入，浏览器 console/page errors 为空。

原 byteexact saveCheck 位于受控死亡之前，因此证明的是**取消后、死亡前**的保存。取消和第六项死亡均由原 DOM7 同一实例继续产生，归档的 Node care/death 端点保存不能替代这些操作或扩大 DOM7 结果。

legacy-qualified/current-guardian 标签只作当前 UI0a5b60 源码静态核对，**不是七项实际 DOM 证据**。真正旧reader三件 gzip、metadata、原始 raw，以及原生 care transition/death 保存归档供来源审查；旧保有学历不算本轮新赚资格，受控健康/年龄边界不算自然成长或通学。没有新课程、补钱、教材、资格或时间状态构造。

静态检查仅读取准备 manifest、归档清单及源文件，输出 stdout JSON；不会导入应用、启动服务器/浏览器、运行测试或写文件。静态准备收尾已执行该脚本，实际 exit0／STATIC_CHECK_PASS；另对 v1/v2 驱动及原内联模块执行 node --check，均 exit0。这些均只读文本/语法检查，未运行应用。原始输出和命令结果见 family-v1-staticcheck.json 与 static-receipt.json。复查入口：

```sh
python3 /workspace/yunshan-work/ROOT07-browser-20261004-01/family-ui-prep/staticcheck.py
```

以下 v2 命令说明三个参数契约；本准备代理未执行。NEW_OUTPUT 必须是父代理选定的新目录；AUTH 必须是明确授权 family7 的 JSON，不能把原归档的较早通用授权文件当作新执行授权：

```sh
node /workspace/yunshan-work/ROOT07-browser-20261004-01/family-ui-prep/family-fee-ui-root07-v2.mjs \
  /workspace/yunshan-work/ROOT07-city-continuation-20261004-01/source \
  /workspace/yunshan-work/ROOT07-browser-20261004-01/family01/family-originals \
  /workspace/yunshan-work/ROOT07-browser-20261004-01/execution-authorization-family-and-context.json
```

父代理的 `run-family-root07-v2.py` 通过 owned-process wrapper 执行，并保存进程身份、raw、源码前后SHA与清理回执；本轮 owned family 进程限时300秒。900秒仅为可配置运行窗口说明，不是本轮 family 实际期限，也不替换原七项浏览器等待。独占执行与最终 fresh output 名称由父代理确定；不在准备阶段启动上述命令。

DOM7 的受控站位、需求补足与声明死亡控制只证明该原生交互范围。没有 renderer/WebGL/GPU、普通键鼠通学、自然六年/十八年成长、完整城市、14日稳态、Mac/FPS 或美术通过结论。原 UI rights FAIL、旧reader FAIL 与对应原件持续保留。

冻结的执行文件：v1 SHA 5ed1329018313a420a71ddbdbdd68ba02860f089d0345c3ecdf39c562b8c0478；v2 SHA 2881919d55d86df58508257e9b0c265964d6fb24afd5532c347bd4ae14f41768。原七项断言块 before/after SHA 均为 2e7cf67eb83bff4a7489fcc7d447625e632d10238e428eb5d8c40e3d648fe251。v2 分别保存 school-partial-course、household-cancelled-before-death、after-death 的 native save、原 World 字节、observer DOM/calls/reader记录；原两张截图不改变，死亡后观察 PNG 另名保存。运行结果由父代理的独占实际 scope 记录，不修改这里的准备状态。
