# LIFE226 清单只读质量审核

结论：清单数据结构通过，但“只有5行代码集成/220行缺失”的状态口径漏掉旧profile可复用粗件，也漏掉current-v4仍保留原发射器的天枢主阁专用粗家具与布局。精细资产和专业功能仍缺，不能因粗几何存在就称美术或系统闭环合格。

## 全表完整性

226个唯一ID；12列全非空；所有母版ID存在；4个变体均指基础组件；CSV和JSON逐行一致；无重名。未改源清单，原计数仍为基础160/组合50/变体4/材质12，状态集成5/缺失220/隔离1。建议的合并/拆分和状态改法没有直接写回，不能把建议当新最终计数。

## Legacy 与 current 的实际区别

1. `world.ts:7/546–550`默认current-v4给非core/非亭楼加入新profile；`architecture-floor-plan.ts:216–217`保留core-main和亭的原发射器。
2. `renderer.ts:279–287`有body则提前返回，旧407–459室内家具与523–589外部程序不会消费；`architecture-detail.ts:220–222`亦提前走新139–215详情分支。
3. 所以current普通住宅缺旧盆栽/晾衣，current数据/议会等翼楼缺旧专用器材，但current core-main的机柜、议席、档案柜、吊灯和市长桌屏仍是实际可达代码。历史旧布局不是隔离原型；它们是仍支持的正式profile。
4. 本审核没有GPU/模拟/实际发射计数，也没看图，只判静态可达mesh代码，不判可识别像素、美术通过或专业交互完成。

## 逐项建议

### LR-01 · LIFE-002 · 床垫证据行号实际指向楼梯与屋顶

类别：确切证据错误。
证据：src/rendering/architecture-bodies.ts:105–107；src/rendering/architecture-bodies.ts:110–118；src/renderer.ts:413。
旧profile：原near住宅床架/浅色床垫块在 renderer.ts:413。
current：v4床底框在106，浅色.2m顶块在107；112–118是楼梯/屋顶，不是床垫。
建议：保已集成状态；把证据112–118改95–108尤其107。床垫作为独立基础组件可自指LIFE-002，依赖接口指LIFE-001；若母版ID指床组合，明确这是组成而非尺寸派生，不新增模型计数。

### LR-02 · LIFE-197 · 晾晒杆和三衣片已在原详情路径发出

类别：状态范围漏报。
证据：src/rendering/architecture-detail.ts:292–307；src/rendering/architecture-detail.ts:220–222；src/rendering/architecture-detail.ts:443–455。
旧profile：住宅、side<0且seed偶数时发2.8m杆和3片衣物及挂点；详情管理器已建InstancedMesh，但受驻留与实例预算。
current：v4普通住宅在222提前return；新详情139–215没有晾衣分支。core-main不为home，所以当前默认普通住宅没有这一生活装饰。
建议：状态写已有旧profile代码生成，现有证据列准确门槛；验收要求列current普通住宅挂接/细化待制。若按current-only统计仍保缺失，但必须写既有legacy母版可复用，不说完全无mesh。晾杆+衣片是一套，不每衣色再计新模型。

### LR-03 · LIFE-118 · 数据通信机柜不是只有系统数值

类别：生产粗几何误写缺失。
证据：src/renderer.ts:424–425；src/world.ts:330；src/world.ts:541；src/architecture-floor-plan.ts:216–217；src/renderer.ts:279–287。
旧profile：原core城区数据设施/名称/楼层用途命中时有3×4木箱+cyan前板机柜。
current：core-main明确排除新body，floorUses的数据中心/信息网络/科学研究层仍触发该分支；新profile数据西翼仅通用table fixture。
建议：改已集成代码生成并注明current core-main粗机柜/旧profile已接、current专用翼楼专业设备待制；不得称已验高细度/PBR或真正可操作通信设备。

### LR-04 · LIFE-141 · 议事桌和排状议席已渲染，条目为布局组合

类别：生产粗几何/类型。
证据：src/renderer.ts:426–429；src/world.ts:541；src/architecture-floor-plan.ts:217。
旧profile：原council设施/名称/用途分支有会议长台+行列座面/靠背。
current：current core-main第19/20等议会用途命中；current council附属hall走新body，无专用议席阵列。
建议：可改已集成代码生成；类型建议组合模板，桌架复用LIFE-032，议席可定义一次通用座椅母版；记录按rows/columns实例排布，不每席/会议厅算模型。

### LR-05 · LIFE-146 · 档案柜粗架在保留主阁地下路径存在

类别：生产粗几何误写缺失。
证据：src/renderer.ts:414–423；src/renderer.ts:436–437；src/world.ts:540；src/architecture-floor-plan.ts:217。
旧profile：原地下两层有7×12柜架/四层薄板；原archives设施另有六柜。
current：current core-main地下继续用旧near emitter并保档案/金库用途；current附属档案馆已走新body，只有通用桌。
建议：改集成粗档案柜/架体状态，注明卷宗文件/书册详模、真实档案交互与附属馆适配待制；不要把薄板识别成具体卷宗模型。

### LR-06 · LIFE-028 · 吊顶灯具粗杆与发光面在主阁仍接入

类别：生产粗几何误写缺失。
证据：src/renderer.ts:455；src/renderer.ts:107；src/renderer.ts:804–815；src/renderer.ts:279–287。
旧profile：原near每层生成两块amber灯面与吊杆。
current：current core-main保留该灯具路径；普通新body无吊顶灯mesh，但室内PointLight仍按真实usePoint安置。
建议：记录已有原profile/主阁吊灯代码生成，current普通楼灯体待挂接；区分可见灯体与已存在的室内PointLight，不能把光源存在当灯模型完成。

### LR-07 · LIFE-066 / LIFE-108 · 通用粗柜/架体已有，但商业货架和书柜语义需分清

类别：可复用母版漏报。
证据：src/renderer.ts:407–411；src/renderer.ts:419–420；src/rendering/architecture-detail.ts:315–317；src/renderer.ts:279–287。
旧profile：原每near楼层发2.4m高柜块；原工坊/农场/码头详情发两立柱+三层搁板及小货块。
current：current core-main室内粗柜/地下架仍存在；current普通商铺/书院/工坊新body没有该架体。
建议：至少在066/108现有证据写原程序粗柜/架体及current主阁可复用；若改集成要把名称限定为粗架体，专门商店货架/书柜功能仍待制。066与108共享架母版，书柜作为用途/尺寸派生或组合，避免同一粗柜重复算独立母版。

### LR-08 · LIFE-071 / LIFE-072 · 四件工坊货箱粗模型已有，杂货/仓储不应重复母版

类别：状态范围与计数。
证据：src/renderer.ts:553–556；src/renderer.ts:523；src/renderer.ts:279–287。
旧profile：非core工坊near exterior发4个1.2×1.6×1.2mwood crate。
current：v4普通工坊在buildHouse287提前返回，不调用原programExterior；core-main不是workshop，所以这批crate仅历史profile现有。
建议：选072或071为通用货箱母版，记历史程序粗件已集成/current迁移待制；另一行按包装/用途派生。箱封条、货主FIFO与真实数量显示仍缺，不由四静态箱推现库存。

### LR-09 · LIFE-077 · 已有两柱三板架，梁柱可复用但非完整仓储系统

类别：证据补充/母版重叠。
证据：src/rendering/architecture-detail.ts:315–317；src/rendering/architecture-detail.ts:220–222。
旧profile：原workshop/farm/dock有2柱×3层水平板；小块放在板上。
current：新profile无这一program分支。
建议：077证据写已有旧profile三层架骨架；与066货架框架通过同一个通用框架母版协调。仓储承重、货位合同和current使用点仍缺，不能改成完整仓库已集成。

### LR-10 · LIFE-083 · 工具架不应把板上未命名货块当工具

类别：保留缺失/澄清。
证据：src/rendering/architecture-detail.ts:315–317。
旧profile：有旧粗架和小货块，但代码没有工具命名/几何/挂点。
current：新profile更无专门工具视觉。
建议：保缺失待制；现有证据加可复用旧架骨架/066或077依赖；工具本体与挂接另外核，不将小盒命名为具体工具。

### LR-11 · LIFE-106 · 书册母版未找到确切可识别几何

类别：未发现所疑误标。
证据：src/renderer.ts:419–420；src/rendering/architecture-detail.ts:317；src/rendering/architecture-detail.ts:139–215。
旧profile：地下柜中3.8×.5×.14的长薄条是层板/统一内容条；原货架.4m小盒没有book名称或封面/书脊。
current：current保留主阁柜条，但无具名书册/逐本书脊；新profile无书册。
建议：保缺失待制，不能为了增已集成数把未知盒条认书。可写已有架体但可识别书页/封面/脊母版待制，实际像素未核。

### LR-12 · LIFE-046 / LIFE-047 / LIFE-049 · 罐杯壶不应由未命名盒子推定存在

类别：未发现所疑误标。
证据：src/rendering/architecture-detail.ts:296–300；src/rendering/architecture-detail.ts:317；src/renderer.ts:412。
旧profile：296–300是有茎叶的长花槽；317只有货块；412为桌上扁块，均无jar/cup/pot器具语义和口壁几何。
current：current新body没有器皿分支，core-main桌面扁块也不能当杯罐。
建议：保现有器皿行缺失；若旧图像有罐需另做像素或具名代码定位，不凭尺寸猜。049多壶杯若是摆放套装，建议组合模板，依赖047，避免一套茶具和杯壶重复模型计数。

### LR-13 · LIFE-197 / LIFE-212 · 生活花槽/种植装饰未在LIFE226逐项列出

类别：清单遗漏。
证据：src/rendering/architecture-detail.ts:292–301；src/renderer.ts:526–534；src/rendering/architecture-detail.ts:220–222。
旧profile：原home近详情有长槽体、压边、三株茎/花叶；原外立面楼层还发绿色1.6×.8×.6块。
current：普通v4住宅提前return后不消费上述程序生活装饰；不是current已有完整花盆。
建议：没有现成LIFE盆栽ID，不捏造ID。补一次历史长花槽/槽内植物组合，或明确归ENV花槽/绿化且LIFE212引用该真实条目；不要新增重复独立花盆母版来冒称长槽为罐盆。

### LR-14 · LIFE-117 · 能源调度有旧专业粗件及当前主阁通用调度屏

类别：范围限定/部分可复用。
证据：src/renderer.ts:430–435；src/world.ts:333；src/world.ts:541；src/world.ts:546–547。
旧profile：原energy南翼分支发stone基座/cyan立件/光带；调度分支另发大蓝屏和两桌。
current：current南翼是新body，专用energy分支不消费；core-main能源调度用途含调度，命中433–435通用屏桌而非430专用立件。
建议：保专业能源控制台待制或拆明已有通用调度屏桌；证据必须写当前主阁部分粗几何存在。专用设备不能被通用cyan块当完成。

### LR-15 · LIFE-140 · 原发光公告板与主阁大屏可复用，政策内容绑定仍未核

类别：范围限定/部分可复用。
证据：src/renderer.ts:433–435；src/renderer.ts:562–566；src/rendering/architecture-detail.ts:460–480。
旧profile：原hall/school/police exterior有amber板；主阁调度层有大cyan屏；详情有实际建筑名称/功能Canvas门牌。
current：ordinary v4外观板被提前return绕过；core-main大屏存在，v4真实门牌仍生成，但不是公告内容屏。
建议：别笼统写无mesh；保公共公告屏功能资产缺失并注明已有粗板/牌接口。门牌归BUILT，政策公告板不复计同一门牌，内容须真实政策/预算状态。

### LR-16 · LIFE-147 · 城市查询终端不能把数据柜蓝面当交互终端

类别：保留缺失/澄清。
证据：src/renderer.ts:425；src/renderer.ts:434；src/rendering/architecture-detail.ts:480。
旧profile：机柜前面/调度大屏/门牌mesh已有，但未见城市查询终端独立形体或world交互点绑定。
current：core-main这些蓝面仍存在，新profile仅table/usePoint；页面查询不等于世界终端。
建议：保缺失，证据写已有屏面可复用但查询终端主体/挂点未核；不要从颜色或UI系统推终端mesh完成。

### LR-17 · LIFE-169 / LIFE-173 · 展台已有、画框与作品介绍牌仍不能互相冒认

类别：部分现有/保留缺失。
证据：src/renderer.ts:438–439；src/renderer.ts:732–750；src/rendering/architecture-detail.ts:460–480；src/world.ts:541。
旧profile：博物馆/展览分支生成六组石台+墙/屋顶分层物；另有建筑门牌和楼层名称标签。
current：core-main博物馆/展览楼层仍用原分支，名称牌随楼层生成；没有画作画框或真实作品介绍内容。
建议：169分清画框缺失与展台可复用；可补一次已集成粗展台母版；173保待制并引用已有Canvas牌技术，门牌/楼层标签不等于展陈介绍。

### LR-18 · LIFE-134 / LIFE-135 / LIFE-160 / LIFE-161 / LIFE-162 / LIFE-163 · 主阁专用粗室内配置不应笼统说只有系统数据

类别：组合存在但质量/范围不足。
证据：src/renderer.ts:414–448；src/world.ts:330；src/world.ts:540–541；src/architecture-floor-plan.ts:217。
旧profile：原能源翼/数据设施/议会/市长/地下金库与档案已有程序粗配置。
current：current core-main保留地下两层架、数据层12柜、议事长台与席列、市长/决策层大桌/蓝屏/边座；能源层是通用调度屏桌。普通专用附属馆新profile没有继承这些专业配置。
建议：六行现有证据逐一写已有主阁粗组合，且新profile翼楼/正式功能绑定/精细美术待制。若状态表达资产有没有，可改集成粗模板；若表达目标成熟配置，可保缺失但不得声称完全无生产mesh。需统一全表状态口径，不把一张成熟缺失当整个老模板不存在。

### LR-19 · LIFE-016 / LIFE-021 / LIFE-081 / LIFE-112 / LIFE-151 · 通用工作桌与用途桌架之间缺复用边界

类别：母版/计数口径。
证据：src/architecture-floor-plan.ts:102–104；src/rendering/architecture-bodies.ts:99–101；src/renderer.ts:407–410。
旧profile：旧各用途楼near都有通用桌。
current：v4各非market usePoint可放table；初表032已经正确集成这一骨架。
建议：这五行若只是桌架换用途/尺寸，指向032并改尺寸用途派生或组合；若确需不同台面/抽屉/仪器结构，名称和接口明确新增结构，保待制但不可同一两腿桌当五独立模型。不能由现有桌推实验室/制造/警务完整设备已完成。

### LR-20 · LIFE-111 · 桌椅排布接口本身不是基础可视组件

类别：条目类型/模型计数。
证据：src/architecture-floor-plan.ts:187–188；src/architecture-floor-plan.ts:102–104。
旧profile：无具名教室桌椅布局母版；原near只通用桌架。
current：v4FloorPlan真实usePoints/fixture合同存在，无教室椅排布局。
建议：改组合模板或将接口并入128普通教室配置的依赖接口；若保行，明确程序布局规则，不计独立3D模型。桌/椅母版各只计一次。

### LR-21 · LIFE-156 · 床位加储物是空间组合，监所专有组件尚缺

类别：条目类型/母版复用。
证据：src/architecture-floor-plan.ts:106–109；src/rendering/architecture-bodies.ts:105–107。
旧profile：现有住宅床与通用柜不能证明监所存在。
current：v4home-bed仅home生成，无监所新布局/床位。
建议：改组合模板，依赖001/002床母版和储物母版；监所限制/安全锚/权限/功能合同待制，不把住宅床额外复制成独立监所床模型。

### LR-22 · LIFE-001 / LIFE-032 / LIFE-064 / LIFE-065 · 已有共享床桌柜台库存样本状态合理

类别：已核正确/少量证据补全。
证据：src/architecture-floor-plan.ts:94–109；src/rendering/architecture-bodies.ts:95–107；src/site-fixtures.ts:17–44；src/rendering/market-goods.ts:13–45。
旧profile：旧住宅床/桌，外柜台site-fixture，真库存样本池已接；静态货块不同于实际库存。
current：v4共享fixtures渲染并对应真实实体；goods池引用真实counter/营业/库存/驻留。
建议：保持四行集成状态且不称精细艺术通过。064证据最好追加architecture-bodies:102–104；065销量/真实食品类型不能从两色方块反推。

### LR-23 · LIFE-215 / LIFE-218 / LIFE-219 / LIFE-221 / LIFE-225 / LIFE-226 · PBR图包缺失与已有参数/程序纹理不是矛盾

类别：已核缺失口径合理。
证据：src/renderer.ts:148–162；src/renderer.ts:818–819；src/rendering/architecture-detail.ts:392–393；src/rendering/architecture-detail.ts:479–480。
旧profile：MeshStandard有roughness/metalness、程序木石微色纹和Canvas门牌；非外部PBR图包。
current：current亦共享这些参数，玻璃透明/发光已有，不代表完整室内玻璃/屏幕/PBR纹理集到达。
建议：保PBR图包待制；现有证据补已有程序/参数基础，勿把shader/Canvas门牌作为全部文化纸张作品图集。若需精确材料预算，跨域共享材质不重复图包。

## 源身份与边界

实际核读的七个源码中，LIFE原audit-summary只纳入五个，五项SHA均一致；原manifest没有src/renderer.ts和src/world.ts，不能称这两项不匹配。本报告补记这两源码的当前SHA与分支/主阁证据。JSON保有输入assets/evidence/build脚本及七源码SHA，可复核。未改root LIFE清单、共享src或ENV清单；只写本目录report.json/report.md。

共 23 组审查记录，涉及 45 个现有LIFE ID；盆栽/花槽遗漏用相关197/212说明，未伪造不存在的LIFE ID。

没有可证明的书册或罐/杯/壶具名几何，相关待制状态保留；不把货架未知小盒、柜中薄条、桌上扁块或长花槽推成具体器皿/书模型。
