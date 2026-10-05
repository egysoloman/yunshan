# 接续与复现

先读项目 AGENTS、提示词和开发备忘录，再核对当前 HEAD 与本目录 SOURCE-INPUTS-351.json。不要把旧主分支或参考图当作此组合实现和游戏截图。

在 Node >=22.19 环境安装 package-lock 锁定依赖后运行 `npm run build`。本阶段完整范围为 TARGETED-PLAN09.json 的23个模块，以及 `node --import tsx --test tests/building-alteration.test.ts`；前者实际在source349验证142项，后者在最终351验证18项。不要把它们写成完整npm测试。

日常界面：步行靠近合法入口按 E，场所卡点击“检查整栋改造影响”，展开“改造现状检查”。它读取当前参数和账本，报告保护事项，不能据此执行拆楼。供电地图由 WorldDefinition.powerGrid 显式定义；无声明旧地图保留原合同，不把管理建筑自动改为发电站。

旧城市不会暗中升级装货规则。主机可调用 `upgradeFreightPickup(simulation, exactCurrentSaveSHA256)`，必须在用户已选择升级的拷贝上操作；拒绝错SHA、等待期间漂移和重复升级。原EDF拷贝、两个声明的差异、物理124分块和每一步完整SHA见默认EDF原件ZIP。本阶段的升级是验证场景，不改用户手中原档。

原件ZIP按 ARCHIVES.json 给定大小/SHA核对。电网/医疗等ZIP采用内容去重时，运行包内 restore-originals.py 重建原路径后再次核对其清单；它不是新模拟结果。源ZIP不含 node_modules。截图保持原PNG，不以参考图或CPU模型投影代替游戏实拍。

下一段可直接接续：先在真实默认城观察具名货物装卸后的供应商收款，按已封存钱粮观察器审计工资、库存与需求；不得补钱/放宽守恒。同时推进已有产权及路工规则到合法拆迁、全体安置和World generation替换。未就绪 owned geometry 候选必须先诊断默认造城成本、确认模式真正启用，再做旧EDF逐tick等价，不能以legacy回退宣称提速。

输入图SHA74aee7的复算口径：按`SOURCE-INPUTS-351.json`保存的键顺序读取字典，再以`json.dumps(inputs, separators=(",", ":")).encode()`编码，计算SHA256。不要重排路径后与同一图SHA比较；逐文件SHA是代码字节核对的依据。
