# coherent04 原生 DOM UI 验证

完整 `YUNSHAN_UI_PORT=4188 npm run test:ui` 在 `/tmp/yunshan-phase3-root-coherent-04` 冻结快照运行。实际30/30、exit0、browser errors=[]；全部原日志、JSON与四张PNG保留。

读取当前AGENTS、提示词与开发备忘录后执行；89文件与manifest/共享工作树起止SHA逐项核对，原始字典及差异均在run-manifest.json。actual dist入口index-n3tM-54D.js / SHAebdd21602dfac48e4dfb958ec980f4fa8ddc24d543eb6739c92a3c5d9c38067b仅标记冻结构建来源。UI服务直接加载本快照TypeScript模块，并未加载该dist入口。

套件用真实生成World、Simulation、CityUI和Controller配合隔离View fixture。Chromium明确--disable-gpu，未构造CityRenderer/WebGL；含受控位置/身份/患者及真实Simulation时钟场景，不能当作正常玩家地理旅行、市场新像素验收、参考画面通过或macOS性能。没有改生产或测试断言，root全规则套件并发运行，计时不作性能证据。

finally已关闭自有浏览器与server；结束后4188不监听、同cwd UI脚本/disable-gpu浏览器进程不存在。integration独占的真实GL未被启动、停止或干扰。
