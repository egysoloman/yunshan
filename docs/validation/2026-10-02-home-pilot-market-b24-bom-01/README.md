# market-b24 三层可住民居 BOM（修订02）

这是实际已有粗楼体的制作清单、接口和原始证据包。精细民居、全部家具、成套独立外模与完整自然生活体验尚未完成。新增外模0 READY；没有模型生成、收费或共享源码修改。

## 先看这四份

- `bom-full.csv` / `bom.json`：原固定12列后补计数/尺寸/挂点/复用新制/数量状态，共67条。
- `component-masters.csv` / `component-list.md`：47种物理母版＝45必需＋2可选；21粗程序集升级、26新增。
- `reference-interface.csv` / `.json`：同47 ID的参考风格族、独立原点/单位/朝向/真实挂接接口及依赖。是规格规划，尚无新统一参考图，也未证明单张城市图可拆成完整资产套件。
- `pilot-evidence-summary.json`：实际本栋受控测试的通过、失败和未运行范围，原件在`evidence/pilot/`。

11装配配方（床/办公桌/茶几/餐桌/沙发/柜/厨卫等）、6材质包和3生活语义接口另计。47不是47栋楼、617/680不是母版数，67不是全部城市资产数。N0/N1/N3只是后来选择的生成方式，所有47种需求仍保留。

## 实际楼体与计数口径

冻结世界`current-v4`、seed20261001，pilot `market-b24`（千灯市集·钱庄街·里居7），40×34.4×10.2m，3层，rotation0；楼基(-390.8,76,316.2)、外门(-390.8,76.6,333.4)，门洞4.8×2.8m。脚面层高76.6/80/83.4。完整近楼体含屋顶到y88，不能把header10.2m与屋顶最高点混用。

617实际近部件：floor15 / wall483 / window53 / furniture15 / stairs38 / roof13。680跨三个balanced-floor视图的装饰去重部件：bracket36 / door32 / frame32 / lantern4 / masonry19 / sign5 / tile174 / window378；680不代表同一帧680件常驻。三视图分别346/432/331，raw1109，经descriptor去重680。1297个near＋detail ID恰好各归属一项旧粗母版，没有重复或漏项。

48真实wall descriptors、502 panels；15真实门洞（外门1＋院门14）；54窗洞而near53玻璃；3床/3通用桌。门框32细件来自8已装饰门洞，不是32扇门；窗378细件来自42窗口×9，不是378扇窗。灯笼4细件是1盏装配，牌框5细件是1组。floor0的7interior矩形/11court矩形是几何分解，不能称7房间/11院落。

楼梯真实34踏步＋4连接/换向平台＝38部件（4跑）；另外3baseLanding已计在楼板。草稿按1.6×.4外形误把两块lower-link当踏步，36/2现已按真实provider surface kind改34/4；草稿合计38没变。当前源没有独立地基台基mesh，地层石板不等于已验实体基础/全地形接合。

## 最新实测范围与失败

唯一GPU原run为2026-10-02 06:13:05..06:17:39 UTC，`source99`/入口`index-DV9HXMzR.js` SHA fee4c40b14b4ac44f0e1ea475b469df689470a1f3446f8d67fab1a2b7a0c1711起止相同；原批exit1，12原PNG保留。此是controlled DOM KeyW监听＋原生产Controller.step(dt≤.015)、4.8m/s motor诊断；不能称普通原生elapsed-frame玩家旅程。

到真实桌前service点租住：600→520、homeId=market-b24。真实服务点休息：fatigue89.514→100、钱仍520。入门、到桌前/床前/庭院及0→1两跑上楼通过；1→2首踏步waypoint3受阻FAIL。完整到2层、下楼及追加自然20s NPC观察未运行。服务点与床约12.093m，service休息通过不是床专用睡眠/休息已实现。

原床/窗内框图片仍ART FAIL：3床是橙白大块，内侧细窗框不可辨。没有厨房、卫生间、厕具等实体。3真实current-v4居民citizen-67/276/485 homeId本栋以及route/state快照现有，但只读快照不证明逐帧自然跨门或使用床。旧current-v3同3居民绑定仅历史佐证；本栋无额外成功serialized-save/bed-use证明。

## 制作/摆放约束与TBD

新家具优先精细程序体素和真实材质，不能仅粗Box换色称合格。不预设所有家具Tripo。现3通用桌可转办公/茶几/餐桌，不把配方需求直接变成另加3桌。新位置、隔断、门扇叶片数、扶手连接、柜体总数、排水、整栋窗帘等未确定数量写TBD；计划数字不是当前安放数。每个新家具必须进入共享fixture/路径/碰撞，并另接真实到场、库存、费用、时间、离场暂停和保存规则。

单位m、+Yup、+Z向外/使用者；接口原点逐件列。允许90°正旋转和经占用批准的正均匀scale；不负scale镜像、不非均匀拉外模。程序参数变型重生成几何，原FloorPlan/支撑/门洞/楼梯/生活点/资金仍权威。

36粗bracket挂点都是.4³。候选斗拱1.2×.8×1、即使.5缩成.6×.4×.5也不全包络fit；批准外模挂点0。楣浮雕1.6×.4×.2的8门头＋42窗楣源挂点，可推17门段＋42窗段＝59潜在段，首批只建议入口3段；未知mesh保护净空/三角相交未验，0批准/0READY。

54→53玻璃缺片是floor1 wallPanels[43]零厚x=5.6的既有量化问题；未改provider/旧指纹。`appendix/river-b2-window-coface/`是另一栋river-b2的既有共面静态诊断，不把该栋11层图当本pilot实测或已修复。

## 生成报价与交付状态

父Mac此前实际仅读独立组件配置H3.1/1200tri/普通2K PBR/去光：45积分每新母版、无纹理30；该历史配置N0程序=0、N1软垫=45、N3加两可选装饰=135，只是对同配置的算术，不是批准生成。重复instances不另当新模型收费。原2K贴图保存，runtime1K优化尚未做；GLB导出额外费用UNKNOWN。

父最新另一配置是单对象分割60、无纹理、纹理选项互斥。单对象分割≠独立组件套件；独立GLB/重组/导出成本尚待实测，民居壳60授权PENDING。本任务没有调用Tripo、imagine、图像生成或订阅。报价来自父实际仅读工具记录，本生产者未重新查价；两不同配置不可覆盖合并。

原草稿CSV（SHA8bb5e81a9a1dead50d0730fdf4f6d931380181994fb4e72337920e2a91da7d3f）已先成功上传Library：libfile_3c87ce7ef38c8191b7c19f6cafd527b3 / file_00000000232481f6ac8431e74b91f480；其字节保在`history/uploaded-draft-v1/`。草稿旧证据说暂无pilot、36/2分类和reference自ID等由修订02明确纠正，不悄改已上传原件。新修订ZIP按官方app另一次上传，结果另有原始记录，不把草稿ID冒充新包ID。

## 原件与制作范围

`raw/`是短CPU emitter/provider元数据采样（约158ms，不是性能benchmark），无新Simulation/长tick/重生成整城；`history/`保存初次collector漏floor参数的诊断和原草稿。`source-excerpts/`含冻结源片段和source99完整SHA manifest，不是全应用源码包。`producer/`为本BOM元数据修订/打包脚本；不接合生产，也不是新增游戏测试。所有JSON可解析、CSV ID对应、part覆盖及ZIP CRC/SHA另记录；这只是交付完整性核对，不是美术/生活功能验收。

本任务仅读原运行与PNG（另实际查看bed/window两原图），未重新跑CPU规则/GPU/浏览器/收费生成。ZIP不含用户浏览器profile、node_modules、凭据或未授权私人素材。新refs暂只规格族，不假称已经取得新imagine图或已支持组件自动分拆。全部共享src/tests保持原样。
