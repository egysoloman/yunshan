# 真实住宅上层楼梯支持修复

现有 `market-b24` 在一层进入二层的首个0.2m踏步卡住；现在同一楼体经实际编译浏览器身体完整完成0→1→2→1→0。这里只修支撑判断，未新增精细美术、厨卫或模型，也未完成整座城市。

## 原因与修改

原失败脚位 `[-404.59997341778063,80,308.791474723644]`，身体半径0.35m。旧实现按当前脚高80m构造支撑并集，排除了下一块80.4m踏步；上层真实楼梯孔使该并集边界距身体中心仅0.336525m，因此完整身体被拒绝，尽管首块80.2m踏步可到达。底层整块楼板掩盖此问题，之前0→1通过不能证明1→2通过。

`floorPlanSupport` 仍以当前脚高±既有容差选可到达的中心表面，然后在该候选落脚高度计算整个身体的支持并集。没有缩半径、改踏步/楼梯孔、写脚高、放宽权限或绕过固体/头部碰撞。同一查询按高度缓存布尔结果。两个原3.4/6.6m层高回归扩为完整三层往返，新增原浏览器精确失败坐标的正常W回归；保留原断言。

## 实际证据与边界

| 检查 | 实际结果 | 范围 |
| --- | --- | --- |
| 原坐标及底层连续上行基线 | FAIL保留 | 原provider，原真实楼体 |
| 独立CPU候选 | 18例通过，30,540个W样本 | 10真实楼体逐栋投影，不是全城浏览器运行 |
| 根相关规则 | 26/26，exit0 | access、floor-plan、controller及v4 controller |
| 根严格类型/构建 | `npm run build` exit0 | 新provider与测试，94运行输入前后相同 |
| 新单栋WebGL | exit0，19路径=17正通过+2预期孔阻挡 | 真实600初fixture，默认1x、自然时钟、租住600→520、服务点休息；单栋受控运行 |
| 原共享几何/指纹 | 保持 | 旧配方×3种子、当前v4及旧r5指纹，不冒称r5已重新恢复推进 |
| 新源完整规则套件 | NOT_RUN | 原465/465只属冻结04 |
| 美术、NPC自然门床、普通旅程、macOS | 未通过或未运行 | 不由此次功能通过推导 |

新05冻结99输入的manifest SHA256为 `e570d80062e24c9d56555cbd9c5cd87f92c2e28b26d7aaa1bd2e64ce3feb9fc8`。真正加载HTTP入口 `/assets/index-BwWZW0hZ.js` 为200、634784字节、SHA256 `fb95a40c52a9a18c86510d004398d89128ee473994c3c53359c964c4d736581c`、非ServiceWorker响应；99源、入口、helper、wrapper、fixture与READY前后哈希一致。

原旧04失败未替换。新运行原件在 [actual-gl](actual-gl/roundtrip-results.json)，根独立核对在 [root-review.json](root-review.json)，相关检查与strict/build原日志在 [root-validation](root-validation/root-verification.json)，独立CPU原失败/候选/几何契约在 [cpu-contract](cpu-contract/README.md)。初次外部准备的日志解析未识别Node `ℹ tests`格式，在GPU启动前失败；只修该外部解析器，仍要求真实26通过/0失败，未改游戏或测试断言。

近景自有组/mesh/instance/geometry/内部refs处置后均0；全局GPU纹理仍1，不能叫全部GPU资源归零或模拟流式完成。根实际看过门外、上二层、二层孔、返底层4张PNG；黑压檐、浅色块、窗框斜纹、无栏踏步及返回仰天坏构图仍保留，美术FAIL。

## 真实附件

生产者单次官方Library上传成功：`libfile_fa2204f82bd081918b575a8962f18927`，fileID `file_0000000078d081f6bb52a16d8ab79dfc`。原ZIP 11,921,198字节、183成员，SHA256 `0e652f6a442c5f74261a8a82d7dc9e3a1a9eb24038fedd1a1a8a78b2657d8751`；包含8原PNG、58运行/阅图原件、99固定源、真实dist和执行准备/相关检查。根独立CRC、182有manifest的逐成员SHA和58运行文件原字节通过；12 gzip解压后也扫描，凭据模式0命中，Library版本xattr0且文件字节未变。成功回执见 [library](library/v4-upper-stair-market-b24-delivery-01-library.json)。未再次上传旧失败批。

墙、窗、门、盆景的真实安装接口及28条参考映射已完成并实际Library交付，见 [四类生产规范](../2026-10-02-home-fallback-four-modules-01/README.md)。这是静态规格，精细模型/批准挂点/安装仍0；下一步补局部原子视觉替换、共面墙裁切及门叶/盆景共享权威，再核独立米制回件。父实测唯一60积分整栋Trial技术15网格独立保存重装PASS，但模块美术FAIL/0合格，不能直接集成或把15 fragments说成15可复用资产；root未收到GLB。模型外观不改变支撑、碰撞、权限和存档权威描述。床专用休息、完整厨卫、居民自然使用及参考美术验收继续开放。
