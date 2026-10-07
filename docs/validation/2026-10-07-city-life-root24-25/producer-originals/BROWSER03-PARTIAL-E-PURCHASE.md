# native03 原生 E 入店与有限购买局部原件

只读提取时间：2026-10-07T08:53:32.490934+00:00。本文件没有执行 Sim、step 或 browser；完整压缩/解压 save 与 PNG 逐件 SHA/长度回读 exact。原件根目录：`/tmp/ROOT25-reference-browser-originals/native03`。本次读取时 RESULT 存在：False；完整 action 文件 28 件。该计数随运行增长，不是最终回执。

原动作 `00017-E-enter-actual-market` 局部 PASS：原生暂停 tick200→200，身体从 (-281.6119685714569,80.4,401.9054066665991)、insideId null，通过真实 E 到 (-282,80.4,399)、insideId market-b26；身体位移 2.931203897352714m、4 个真实帧。前后完整 save 原件保留并 exact 回读。它与 native02 自然 W 入店、以及中断前 E 尚未执行的失败分别记录。

原动作 `00027-ACTUAL-SHOP-UI-PURCHASE-TWO` 局部 PASS：实际店铺 UI 买 2 份，原生暂停 tick360→360、身体与 insideId 不变、7 个真实帧。钱包 600→577.0541691571732、店库存 90→88，cost=22.945830842826787；shop revenue 0→同 cost、customers 0→2、profit 0→13.110164375400643、shop cash 52.480365440715104→73.59052981611575。1 份实际吃掉、1 份携带，food0→1、饱足81.84999999999775→100。完整 before/after exportSave 保留有限钱包、库存、结算/寄售/税效果；不把 revenue 与 shop cash 当作相同净入账。

`ACTUAL-SHOP-PURCHASE-PROOF.json` SHA `16d580e179236cab589b04abbbc5387f0c1bc0deeb44162e67d2c1995ad7ced7`。两动作原 JSON、四件完整 save 的编码及解码 SHA 与所有已存在 capture 的 PNG SHA 见 [局部统计 JSON](/workspace/yunshan-work/ROOT25-reference-visual-20261007-01/delivery-draft/BROWSER03-PARTIAL-E-PURCHASE.json)。

capture01..05 原 PNG 均已生成，涵盖出生、真门、E 后室内、柜台和购买 UI；每件 completeSaveUnchanged/cameraUnchanged 为 true。root 已实际查看门/室内/柜台，**ART_FAIL 保留**。这些局部证据不替代退出、完整保存恢复、整体 browser RESULT 或普通 URL 验收；上述项目尚无完成原件/回执时均保持 PENDING。旧 browser01 FAIL 与 browser02 FAIL/OPERATOR_ABORT_PARTIAL 不回填。
