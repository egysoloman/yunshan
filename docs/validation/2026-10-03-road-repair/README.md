# 阶段交付与原件入口

先读 `REPORT.md`，再看 `validation-results.json` 中每个实际 scope 的起止、源码稳定性和原日志 SHA。各回归范围有重叠，不能相加称为全套规则检查。

原证据 ZIP（或 `.part001` 等分卷）保留第一次失败、修复后的通过、冻结源码、原完整存档、执行脚本、回执及未加工截图。`original-evidence-receipt.json` 记录交付文件和整包 SHA；`original-evidence-manifest.json` 逐成员记录字节与 SHA。

在此目录执行 `python3 verify_originals.py`，会在独立临时目录重组分卷并检查 ZIP CRC 和每个成员 SHA。脚本不改原件，也不运行游戏。

`source-manifest.json` 是最终执行输入清单；`shared-source-integration-receipt.json` 证明工作区的全部输入与实际构建、验收的冻结源码逐字节相同。原件包的 `originals/` 下以各 scope 的原目录名区分失败、候选和最终来源。

官方 DOM 检查的旧开公司 fixture 有继承失败：原 b1 和本阶段同为前 16 项通过，然后 `scripts/ui-test.mjs:291` 断言失败。该 fixture 选择了另一个居民经营的市集；现有产权规则要求本人已经合法拥有该经营资产。未放宽规则或将此失败记为通过，后续应明确修复该独立 fixture。

软件 GPU 检查只验证功能与原生交互。美术、macOS 性能、长期经济稳态和完整城市建设目标仍按报告列为未完成。
