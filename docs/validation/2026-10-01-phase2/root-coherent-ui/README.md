# 根统一快照原生 UI 复验

实际固定源码 `/tmp/yunshan-phase2-root-coherent-01`，81 个文件的运行前与运行后 SHA256 完全一致，并与根代理原始 copiedHashes 一致；原始源码清单也未改变。生产构建入口 `/assets/index-9RmW2nKM.js`，SHA256 `4c8d85a0c70ec591e5edd8ab1f8336b02408f812f0acfb6fb0bcb09b872d9e57`，运行前后未变化。没有修改快照或共享源码。

`YUNSHAN_UI_PORT=4188 npm run test:ui` 实际 exit 0，30/30 检查通过，浏览器错误 0。原始日志、结果 JSON、起止哈希清单以及诊疗采购/完成、手机和横屏四张 PNG 原样保留。浏览器与服务器已由脚本 finally 关闭。

本次从该固定快照的 Vite `/ui-verify.html` 提供 CityUI/Simulation 的原生 DOM 场景，Chromium 使用 `--disable-gpu`，没有 CityRenderer。它覆盖实际临床托管/采购/退款/医生出勤/20 分钟治疗、物料和随身食品交易消费，以及既有工作/银行/文化/家庭仪式/航空交互等。临床场景明确控制患者起始伤势和真实医生的现场可用性，交易与计时使用正常模拟结果。根代理全规则套件同时运行；此次不是性能基准、生产 WebGL 验收或普通玩家完整步行旅程。

`checksums.json` 列出各归档文件的 SHA256 和字节数。此前 UI 回归的失败保留在相邻 `ui-clinical/` 目录，此次没有失败。
