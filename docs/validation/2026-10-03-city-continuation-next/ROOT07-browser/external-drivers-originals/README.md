# ROOT07 实际浏览器与原图验证准备

状态：PREPARED / NOT_RUN。此目录仅为准备，不含 ROOT07 应用运行结果；ROOT07 source 尚未由 root 提供。ROOT06 是旧 DRAFT，不得改或运行。

等待 root 给出最终冻结 source 路径和明确执行许可。随后按冻结执行输入逐 SHA 写入 `execution-authorization.json`，内容为 `status=ROOT07_BROWSER_EXECUTION_AUTHORIZED`、`scope=ROOT07`、`sourcePath`、`exclusiveGPU=true`、`inputs`（以 source 相对路径为键的实际 SHA256 表）。这只是落实已收到的 root 许可，不向用户重复索取批准；准备阶段不填写授权成功。

`run-root07.py` 单次仅执行指定 phase。每次 NEW_SCOPE 必须不存在。保留原命令、raw、失败/超时、自有 session PID 与清理回执、所有执行输入 before/after 原件与 SHA、dist before/after 原件及每轮 artifacts 原件。原 test 脚本不改，DOM35 与 WebGL11 的全部原内容保留。原 artifacts 未变化文件标为 preexisting，不能冒本轮产出。

命令模板（仅在 root 许可后运行；SOURCE/AUTH/NEW_SCOPE 均填写真实新路径）：

```sh
python3 run-root07.py build SOURCE NEW_SCOPE AUTH
python3 run-root07.py rendering SOURCE NEW_SCOPE AUTH
python3 run-root07.py dom SOURCE NEW_SCOPE AUTH
python3 run-root07.py webgl SOURCE NEW_SCOPE AUTH
python3 run-root07.py captures SOURCE NEW_SCOPE AUTH
```

顺序：如 root 已提供同冻结源的实际 build/渲染规则回执，就引用它们，不重复；然后 DOM35 → WebGL11 → 新受控光学截图。DOM 端口4318、原 WebGL 固定4173、光学4197均 strictPort，自有 server 独立退出后才进入下一 GPU scope。仅一个 GPU 进程，禁止接管他人端口或广播 kill。失败不覆盖，修复必须新冻结、新 scope，保旧 FAIL。运行时每一分钟向 root 报真实进度，不将有界超时写成 PASS。

九张独立真实 PNG：

|文件|相机与真实用途|
|---|---|
|spawn-day / spawn-night|原六机位的固定 eye/quaternion，15.5/22时；与真实 fresh opening 单独记录，原 WebGL day/night 仍是实际初始旅程图|
|overview-day|eye 1780,1040,2040；target 0,180,0；15.5时|
|core-waterfall|eye 440,325,640；target 210,215,-45；12时|
|market-street|真实 market 区 market 楼栋的门坐标+5,+1.72,+18；12时|
|residential-first-person|真实 west 区 home 楼栋的门坐标+5,+1.72,+18；12时|
|commercial-skyline|按实际五座 commercialGeometryRevision=1 银行坐标与高度计算相机；记录每座真实 ID/尺寸/楼层/route revision；15.5时|
|commercial-ground-bank-reception|真实银行 floor0／中文一层接待厅，声明门前受控站位→实际原 interact 进入→真实 service 点受控站位；未执行存取款，记录原界面按钮/权限/钱包|
|commercial-first-office-floor|真实银行 floor2／中文三层首办公楼层，声明门前受控站位→实际原 interact 进入→真实 work 点受控站位；未 W 爬楼、未执行有薪工作，记录用途/权限/真实支撑与楼层|

截图驱动仅在隔离诊断页暂停模拟并固定 controller 帧步进，相机使用真实 renderer；1440×900，deviceScaleFactor1，FOV48，balanced，动态分辨率按实际 pre/post 分别记录。没有调色、裁剪、合成或后处理。原 DOM/WebGL 测试使用全新上下文，不受相机固定影响。真实厅层/办公室不改用途、尺寸、角色、资格、钱包、产权或规则。实际普通 39 层 W 路径已由 root 另有 CPU 证据，不重复扩测。

每张图保存原 PNG SHA、caption、相机、时刻、控制器/真实楼栋、场景规模、渲染 calls/triangles/geometry/textures、动态分辨率与光源；served bundle 与 dist 的 SHA 必须相同。不能将 diagnostic 图标作普通游玩旅程，不能将软件 GPU 功能证据冒 Mac 实测或 FPS。

最后实际查看九张原 PNG及原 WebGL原图，再写视觉差距：之前参考美术 ART FAIL、Mac NOT_RUN、/tmp 事故原 PNG/raw LOST 继续保持；新 ROOT07 实测不覆盖旧结论。Library 统一原件 ZIP由 root 制作上传，本 agent 不制作 Library ID、不推送、不新外部资产、不付费生成。
