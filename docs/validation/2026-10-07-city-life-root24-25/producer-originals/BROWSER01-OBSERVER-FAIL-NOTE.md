# ROOT25 browser01 原失败与W观察器证据

原门 `/workspace/yunshan-work/ROOT25-reference-visual-20261007-01/browser01/receipt.json` 为FAIL，08:14:56.199748→08:21:02.484687 UTC/366.284939s；417输入stable/active[]，raw SHA `d86bded7f60f6631d556697756b11e2b9080be6f8d0c4d5cf289011fffc9761c`。原RESULT `/tmp/ROOT25-reference-browser-originals/native01/RESULT.json` 24120B，SHA `f9d7d106a5e49dfd7b334d1e5557b92a14d6843c1870f85cca66ac3ffcca5a67`，结果前原件15930784B。九动作八PASS，第九首次W在观察器预算断言FAIL；整门不能改为PASS。

首次W原action `/tmp/ROOT25-reference-browser-originals/native01/00009-W-public-road-to-market-1.action.json` SHA `0d8825c5d045c60774f948d9f33f54bc9aa4b717f0df09dcfeb26c545c3474eb`：

- 真DOM keyboard KeyW请求hold200ms；原trusted keydown timeStamp313846.1000000015，keyup314052.1000000015，真实事件差206ms。
- 原游戏body `(-279,80.4,408)`→`(-279.3895074024349,80.4,407.09114939431834)`，原记录bodyMetres0.9887999999997532、realFrameCount3、tick80→92/+12。
- 旧keydown捕获到的accepted.keys为空、inputAt14744.60000000149；旧keyup捕获到accepted.keys仍含KeyW、inputAt313846.1000000015。它们是原Controller对应bubble handler执行之前的输入状态，不是对应down/up处理后的状态。
- root源核指出旧capture queueMicrotask可在原window bubble Controller前运行。用这两项错位accepted.inputAt相减会得到约299.1015秒，从而误触发“Observed real held-W budget exhausted”。真实trusted事件时间与实际body/原frames不支持一次约299秒W按住。

root仅修私有 `ui-plan/native-reference-browser-v2.mjs`：晚注册window bubble observer，在实际Controller同步处理后读取accepted；没有改417冻结应用输入或build，未重写旧事件和动作结果。新BOUND-PLAN02 SHA `42eaf7fd34cb111fb7c4161ed1ac3861db75749d97f03325bf89f73f770ec394`，driver SHA `1b9c2dd5b5d9a6ae8a518ec836aaa069dc2a0524292882eb5d024f0206f08d7e`，同input graph `610e16a8dd76c2f7366107f6aac9d87a439c15a5a5936d52b0bf86698daea167`。native02是新的fresh实际门，不能回写native01失败或继承其未完成购买/退出动作。

仅一张真实出生PNG `capture-01-ACTUAL-BIRTH-CAMERA.ORIGINAL.png`，788249B SHA `eaaff8a1cf53a44742f601013590458615e61b7bd5c138684b63826520c57f1e`；capture前后完整save/相机未变。原RESULT artResult为NOT_REVIEWED；root另行实际view判断仍ART_FAIL：曲檐、门、柜台、地铺和远高楼可见，悬空台基层、遮挡与光照层次不足。这个人工判断没有篡改原RESULT。Linux软件GPU产生原PNG不构成Mac实机性能证据，MacNOT_RUN保留。

本备注只读既有原action/RESULT/receipt与root修正消息，未运行browser/GPU或测试；native02最终结果仍需真实回执。
