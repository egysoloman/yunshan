原件入口：

- 修后源：`/tmp/yunshan-v5-market-block-01/prototype-01/candidate-fixed/`（102冻结输入），实际构建入口 `/assets/index-ASf8ucTH.js`，SHA256 `d6bc280c37703b558669bcb5eeeb1ea9ee3d907f204ef4abb82f0bad661bd89f`。
- 首失败源：同级 `candidate-final/`，首失败日志 `final-targeted-v5.log`、`final-run-status.json`。不得将此首版当修后原型。
- 原99输入：同级 `baseline/`，原来源 coherent03。当前coherent04差异完整列在 `source03-to04.json/.patch`；只有apply-check被父报告通过，尚未合入或按coherent04验证。
- 构建及局部7项：`fixed-build.log`、`fixed-targeted-v5.log`、`fixed-run-status.json`。
- 15世界/2265固定探针/5份0tick恢复：`five-recipes-report.json`；全部前后原字节在ZIP `diagnostics/legacy-worlds/{baseline,candidate-fixed}/`（亦在隔离目录），没有24tick/长期续演声明。
- 5006步实际CPU motor：`motor-telemetry.json`（每步记录）、`motor-telemetry-summary.json`、`motor-telemetry.test.ts`、`motor-telemetry.log`；其中街台51m身体行走，钱庄门→市集门177.73455m。初始Controlled placement不是普通玩家旅程。
- 全原件索引：`evidence-index.json`。546个ZIP条目全部CRC/原件SHA一致，ZIP包本身不变；新私有参考、浏览器profile、node_modules和凭据均排除。
- Library实际确认、完整原始返回及本地身份结果：`library-delivery.json`；仅一次direct create，实际ID见 `delivery-manifest.json`。初始包装器未读direct structuredContent，随后解析纠正并补metadata，无第二次上传。
- terrain-actual.mts只准备未运行，默认首版candidate-final；GL、画面、Mac、全套规则和新v5持续运行未验证。
