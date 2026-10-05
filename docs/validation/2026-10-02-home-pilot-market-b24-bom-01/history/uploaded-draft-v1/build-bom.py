import csv, json, hashlib
from pathlib import Path

ROOT=Path('/tmp/yunshan-home-pilot-bom-01')
j=json.loads((ROOT/'raw-counts.json').read_text())
S=j['summary']; near=j['nearParts']; detail=j['uniqueDetailParts']; rows=[]
columns=['资产ID','中文名称','类别','条目类型','用途关联系统','状态','现有证据','生产方式','依赖接口','基础母版ID','派生规则','验收要求']
extra=['原现实例数','计划实例数','实际尺寸或计划尺寸','现有挂点数','批准新模型挂点数','已有复用或新制','计数口径','证据零件ID']
common='模型仅视觉；m/+Yup/+Zout；90°正旋转；不得负scale镜像/非均匀拉伸；支撑、门洞、楼板、楼梯、功能点和资金仍由共享权威决定；本栋未做原生入住验收'
def add(id,name,category,current,planned,size,source,ids=(),mount=None,reuse=False,optional=False,system='住宅空间/生活',base=None,derive='按共享参数重新生成，不任意拉伸外部模型',dependency='FloorPlan/provider/actual geometry',acceptance=common,method=None,type='物理制作母版',count='实际CPU emitter描述；不是已合格外部模型'):
 status='已有粗程序集：复用并美术升级，未达视觉验收' if reuse else ('可选待制 NOT_READY' if optional else '新增计划：未制作/未放置/未验收')
 rows.append(dict(zip(columns,[id,name,category,type,system,status,source,method or ('高细程序体素+材质；保留共享实体/参数' if not optional else '可选程序/Tripo；未生成，未扣费'),dependency,base or id,derive,acceptance]))|dict(zip(extra,[current,planned,size,current if mount is None else mount,0,'复用粗程序集并升级' if reuse else '新制',count,list(ids)])))
def nr(predicate):return [x for x in near if predicate(x['part'])]
def dr(predicate):return [x for x in detail if predicate(x['part'])]
def ids(rs):return [r['id'] for r in rs]
def dimensions(rs):
 return sorted({tuple(round(p['part']['size'][a],8) for a in ['x','y','z']) for p in rs})
def actual(id,name,cat,rs,planned=None,mount=None,source='',optional=False):
 add(id,name,cat,len(rs),len(rs) if planned is None else planned,dimensions(rs),source or 'raw-counts.json：完整near/跨floor balanced detail去重',ids(rs),mount=mount,reuse=True,optional=optional)

# 22 building component masters. Geometry blocks and functional assemblies are
# deliberately different counts. This is a BOM, not a new asset runtime.
add('A01','地基台基/与地形接合体','基础',0,1,'计划：仅在真实占用轮廓下；当前地层石板底76.4/顶76.6，地形基高76','程序楼体分支没有独立台基mesh；ground near:0为0.2m石板',dependency='terrainHeight + getFloorPlanSlabRegions + 新可信可选几何版本',acceptance=common+'；不得填院落/楼梯洞或扩大整片台地；真实基座包络及地形净空待设计')
actual('A02','楼板/地层院落铺装板','结构',nr(lambda p:p['purpose']=='floor'),source='near:0及floor1/2楼板；37 slab-region输入合并后15实际板件；矩形数不是房间数')
actual('A03','承围墙/实体墙板','结构',nr(lambda p:p['purpose']=='wall'),mount=48,source='48 wall段→502 panels→483非玻璃墙渲染件；312墙面+171石裙墙；不含家具床垫')
add('A04','墙角收口/转角构件','结构细部',0,'逐共享boundary转角定量；本轮未布置','计划0.2m基准，薄饰面可更细','原墙有几何转角，但没有独立转角收口资产',dependency='boundaryLoops + wallPanels；不得扩大室内障碍')
add('A05','室内隔断板/隔断开口','结构',0,'待住宅分区方案；不把既有interior rect当房间','待共享plan批准','既有home interior是连通占用union；没有新增房间隔断实体',dependency='新可信FloorPlan版本、门/路径/权限共同更新',acceptance=common+'；不能只画隔断而不进碰撞/路线/指纹')
actual('A06','门套/门框构件','门窗',dr(lambda p:p['purpose']=='door'),mount=8,source='32细件来自最多8个被选ground门洞；全楼真实门洞15(外1/院14)；门洞是空，不是门扇')
add('A07','可开合门扇','门窗',0,1,'主入口门洞4.8×2.8；可拆成两正旋转叶片，尺寸待共享door设计','原程序分支只有门洞和装饰框，无门扇/开合状态',dependency='shared door state + provider collision + controller/path + save',acceptance=common+'；开/关叶片实体、动画、可达性与存档必须同一真实状态')
add('A08','门/柜五金把手与合页','门窗/家具',0,'主门+2储物柜；具体零件数待叶片方案','计划0.2m实体基准；视觉细节可更细','不存在独立五金实体',dependency='A07/shared door state；柜门派生同正旋转原则')
actual('A09','窗玻璃板','门窗',nr(lambda p:p['purpose']=='window'),planned=54,mount=54,source='54真实窗洞/54 glass descriptors，但floor1 panels[43]零厚x=5.6，near实际53；缺陷不可改旧指纹掩盖')
actual('A10','窗框/窗棂/窗楣饰带套件','门窗细部',dr(lambda p:p['purpose']=='window'),mount=42,source='42被装饰窗口×9件=378；全楼54窗；保窗框共面缺陷附录，未称视觉合格')
actual('A11','楼梯踏步板','楼梯',nr(lambda p:p['purpose']=='stairs' and round(p['size']['x'],5)==1.6 and round(p['size']['z'],5)==.4),planned=34,mount=34,source='floor0/1各17级，up8/return9；4跑，不是34跑；升0.2/行0.4、跑宽1.6')
actual('A12','楼梯换向/下连接平台','楼梯',nr(lambda p:p['purpose']=='stairs' and not(round(p['size']['x'],5)==1.6 and round(p['size']['z'],5)==.4)),mount=4,source='每层间lower-link1+half-turn1，共4；另3 baseLanding包含在楼板，不再追加38stairs计数')
add('A13','楼梯/洞口安全扶手栏杆','楼梯安全',0,'4跑双侧8段+洞口/平台连接待测量','计划高约1.0..1.2；实际净宽/洞口长度待共同描述','近楼体无楼梯栏杆组件',dependency='shared stair/landing holes + actual barrier descriptor',acceptance=common+'；不能只有可见栏杆但玩家可穿过；不得侵占0.35m身体路径')
actual('A14','坡屋面双坡壳','屋面',nr(lambda p:p['purpose']=='roof' and 'template' in p),planned=9,mount=9,source='9 actual shared gable regions；near:604..616内真实roof template，不用包围盒假屋面')
actual('A15','院廊平屋面','屋面',nr(lambda p:p['purpose']=='roof' and p['material']=='wood'),planned=3,mount=3,source='3 gallery-flat regions；不是3个房间/院落')
actual('A16','屋面量化补缝条','屋面',nr(lambda p:p['purpose']=='roof' and 'template' not in p and p['material']=='roof'),planned=1,mount=1,source='1 weather-strip共享roof region')
actual('A17','檐缘封板/檐口木条','屋面细部',dr(lambda p:p['purpose']=='tile' and p['color']=='#75563c'),planned=24,mount=24,source='原tile目的里的24 WOOD檐条；并非174全是瓦片；46真实roof edges只部分生成细节')
actual('A18','檐瓦小件','屋面细部',dr(lambda p:p['purpose']=='tile' and p['color']!='#75563c'),planned=150,mount=150,source='原tile目的内150瓦块；24檐条+150瓦块=174')
add('A19','屋脊封脊构件','屋面细部',0,'9条坡屋脊的封脊序列；独立块数待脊长定量','依9共享gable真实轴线/长度','坡屋顶已有几何脊线9，但没有独立封脊组件',dependency='RoofRegion.gableAxis/rect；不得跨院空洞复制')
add('A20','檐沟/雨落管','屋面/设施',0,'待9坡屋面/3廊屋面排水方案','待真实排水边缘/落点','当前无檐沟和落水管组件，也无本栋真实排水机制',dependency='shared roof edges + future utilities/drainage data')
actual('A21','檐下承托/斗拱视觉母版（可选）','传统细部',dr(lambda p:p['purpose']=='bracket'),planned='36原括架可升级；新mesh批准0',mount=36,source='36实际括架均0.4³；Tripo1.2×0.8×1及0.5缩放0.6×0.4×0.5均不fit原盒',optional=True)
rows[-1]['生产方式']='先精细程序可复用；可选Tripo新视觉母版，当前NOT_READY/0付费'
rows[-1]['验收要求']=common+'；真实三角/占用保护验收；不能将高度fit说成完整bbox fit，0已批准'
add('A22','门/窗楣浮雕条视觉母版（可选）','传统细部',0,'首批入口3段同向；其他候选56段未安排','母版1.6×0.4×0.2；首门4.8宽分3段，无拉伸','8现门头条位+42现窗楣条位；按实际宽度可推17门楣段+42窗楣段=59候选，不是已放置',mount=50,optional=True,dependency='actual opening/window descriptor + wall outward normal + protected door/point/stair triangle validation',acceptance=common+'；59仅安装排布候选；未知mesh所以批准0/ready0；不要覆盖门洞或将浮雕厚度写入旧phys')

# 21 furniture/component masters, not 21 assembled furniture categories.
actual('F01','床架/床基','卧具',nr(lambda p:p['purpose']=='furniture' and p['material']=='wood' and p['color']=='#846346' and p['size']['y']>.5),planned=3,mount=3,source='3 home-bed fixture，每层1；旧木色实盒不是精美床架；2.4×1.2×0.6包络复用')
actual('F02','床垫','卧具',nr(lambda p:p['purpose']=='furniture' and p['material']=='wall'),planned=3,mount=3,source='3白色0.2m床垫层；床rest交互仍缺，不能把垫层当睡眠已验')
add('F03','枕头','卧具',0,3,'计划每床1；建议0.6×0.4×0.2','无枕头资产',dependency='bed fixture envelope + visual layering',method='高细程序软体体素+布料材质；可做轮廓/接缝，不默认Tripo')
add('F04','被褥/床罩','卧具/布料',0,3,'计划每床1；依2.4×1.2床包络','无被褥资产',dependency='bed fixture envelope；仅视觉不造睡眠进度',method='高细程序体素表面/布料贴图；精细边缘，非粗盒换色')
actual('F05','桌面板母版','桌具',nr(lambda p:p['purpose']=='furniture' and p['material']=='wood' and p['color']=='#846346' and p['size']['y']<.3),planned='现3桌面升级；办公/茶几/餐桌派生另见R03..05',mount=3,source='每层1桌面2.4×1.2×0.2；当前只有通用桌，没有办公桌专有语义')
actual('F06','桌架/侧支撑母版','桌具',nr(lambda p:p['purpose']=='furniture' and p['color']=='#69523f'),planned='现6侧件升级；2侧件组成1桌架',mount=6,source='3通用桌×2侧支撑=6件；不是6张桌，非独立desk-use')
add('F07','沙发框架','起居',0,1,'计划约2.4×1.0×0.6；位置/净空待共同方案','沙发未放置',dependency='new shared furniture fixture + room route',method='高细程序木构/底座/扶手，曲线或阶梯轮廓与材质，不默认外部整模')
add('F08','沙发软垫母版','起居/软体',0,4,'计划2座垫+2背垫；同一母版正旋转派生，实际尺寸待座架方案','软垫未制作；候选1个Tripo母版，多实例复用不重复收费',dependency='F07 + shared fixture/protected-route validation',method='优先高细程序软垫/接缝；若必要选Tripo1母版，未生成/未授权扣费',acceptance=common+'；母版整体不得任意非均匀拉伸；未知bbox/三角预算，当前ready0')
add('F09','餐椅/工作椅母版','座具',0,5,'计划餐椅4+工作椅1；约0.6×0.6×1.0','当前没有椅',dependency='shared chair fixture + seat/use/approach point',method='精细程序座面/靠背/腿/连接件，可派生风格；不是简单盒子合格')
add('F10','储物柜体母版','储物',0,2,'计划衣柜1/食品储物柜1；尺寸待合法room/layout','当前无柜体，无本栋独立储物库存接口',dependency='shared fixture + future household inventory; doorleaf A07/hardware A08',method='程序精细柜体/搁板/门边；形状按参数重建')
add('F11','厨房台面/柜基','厨房',0,1,'计划约2.4×0.6×0.8；尺寸和点位未批准','当前无厨房台面',dependency='shared fixture + cooking/inventory/utility hooks',method='程序精细台基/台面/边缘+材质')
add('F12','水槽/洗面盆母版','厨房/卫浴',0,2,'计划厨房1+卫生间1；不同参数派生同凹盆母版','无水槽/洗面盆，不把摆件当供水已通',dependency='F11/R08 + actual water/utility state + interaction',method='程序凹槽/圆角或体素阶梯内面+材质，不需默认Tripo')
add('F13','灶台/炉具','厨房',0,1,'计划约0.8×0.6×0.2；未放置','没有灶台mesh/本栋灶交互点',dependency='cooking stock/recipe cost + energy + shared worktop',method='程序炉圈/炉面/控制件，材质细化')
add('F14','水龙头母版','厨房/卫浴',0,2,'计划随厨房槽/洗面盆各1','当前无龙头',dependency='F12 + water state',method='精细程序管线/阀体+材质，可更细视觉分辨率但不改0.2物理')
add('F15','坐便器','卫浴',0,1,'计划约0.6×0.8×0.8，未放置','当前无坐便器/本栋卫生行为',dependency='shared fixture + actual bathroom/utility lifecycle',method='高细程序轮廓/凹面/盖，不默认粗Box或Tripo')
add('F16','淋浴底盘/排水盘','卫浴',0,1,'计划约1.2×1.2×0.2','当前无淋浴盘',dependency='shared support + drainage/water state + glass A09派生',method='程序带坡排水面；物理统一描述')
add('F17','淋浴管/花洒组件','卫浴',0,1,'计划约0.4×1.8×0.2；未放置','当前无花洒/真实洗浴时长',dependency='F16 + water/energy/needs state',method='程序精细管/喷头/挂座+材质')
add('F18','显示器机壳/支座','办公/信息',0,1,'计划约0.8×0.6×0.2，支座由桌面承托','当前无显示器',dependency='F05/R03 + actual info/research/energy UI state',method='精细程序边框、支座、背壳；无需默认Tripo')
add('F19','显示器显示面','办公/信息',0,1,'计划与F18屏框一致；显示实际数据，不固定虚假动画','当前无screen资产/本栋电脑操作',dependency='actual state-backed texture/DOM/canvas + energy',method='程序显示面/材质，文本和数据来自真实状态',acceptance=common+'；不能仅贴屏幕图就声称工作/学习已用电脑完成')
add('F20','室内灯具母版','照明',0,6,'计划顶灯3+床边灯3；参数派生，未放置','现仅外门灯笼；室内灯0',dependency='state.energy/daylight + shared mount/protected points',method='程序精细灯壳/支架/发光面+真实照明预算')
add('F21','窗帘/布帘母版','布料/私密',0,'首批4窗帘；全楼54窗是否覆盖待设计','按真实窗尺寸派生；正旋转，无非uniform外模拉伸','当前无窗帘',dependency='actual window cuts + no route obstruction',method='高细程序褶皱/体素边缘+布料材质')

# Four present decorative assemblies still need visual quality work.
actual('D01','入口灯笼组件','照明细部',dr(lambda p:p['purpose']=='lantern'),planned=4,mount=1,source='1套入口灯笼/4真实细件，其中1 luminous；不等于4盏灯')
actual('D02','住宅门牌框','标识',dr(lambda p:p['purpose']=='sign'),planned=5,mount=1,source='1门牌框/5真实细件；browser Canvas文字板由manager另建，本轮未跑本栋GL验证')
actual('D03','墙顶木构封边/横梁','墙面细部',dr(lambda p:p['purpose']=='frame'),planned=32,mount=32,source='32实际细框梁；是基于wall附饰，无新承载功能')
actual('D04','地层石裙饰条','墙面细部',dr(lambda p:p['purpose']=='masonry'),planned=19,mount=19,source='19附墙石饰；不是完整独立基础；不将装饰代替真实支撑')

assert len(rows)==47
physical=list(rows)
recipes=[
('R01','床装配','卧具',3,3,'F01/F02/F03/F04','已有床位3，视觉床架/床垫粗件；床专用rest未实现'),
('R02','通用桌装配','桌具',3,3,'F05/F06','现每层1通用桌，工作/service点在桌前，不在桌体内'),
('R03','办公桌装配/办公语义','办公',0,1,'F05/F06/F18/F19/F09','工作点/设备依赖未接合；不能把通用桌直接声称已办公'),
('R04','茶几装配','起居',0,1,'F05/F06','按参数生成较低桌，不拉伸外部模型'),
('R05','餐桌装配','饮食',0,1,'F05/F06/F09','餐桌1+椅4计划；真食品/到场行为待挂'),
('R06','沙发装配','起居',0,1,'F07/F08','新框架1+软垫4，坐姿/休息行为待接'),
('R07','衣柜/食品柜派生','储物',0,2,'F10/A07/A08','柜体2；家用物品/库存不可凭空生成'),
('R08','洗面台派生','卫浴',0,1,'F12/F14/F10','洗面盆是F12第二实例；不另计第三水槽'),
('R09','淋浴装配','卫浴',0,1,'F16/F17/A09','玻璃屏派生既有玻璃母版；新共享fixture与排水未接'),
('R10','顶灯/床边灯派生','照明',0,6,'F20','顶灯3/床边3计划；不算6外部母版'),
('R11','厨房台面/灶槽装配','厨房',0,1,'F11/F12/F13/F14/F10','厨房套件1计划；现有烹饪系统不等于本栋厨房已建')]
for id,name,cat,cur,plan,parents,note in recipes:
 add(id,name,cat,cur,plan,'见依赖母版与实际室内layout，未批准新布置',note,mount=cur,reuse=cur>0,base=parents,type='装配/派生配方',dependency='shared furniture/collision + actual household/cooking/work hooks',count='完整家具装配数量，不能与47物理母版/1297渲染子件直接相加')
materials=[('M01','木材/漆木','已有MeshStandard+木纹程序shader，非已交付PBR贴图包'),('M02','石材/灰缝','已有stone材质程序细节，待精细化'),('M03','墙面/抹灰','已有wall材质程序细节，待精细化'),('M04','屋瓦/陶瓷','已有roof材质程序细节，卫浴陶瓷待派生'),('M05','玻璃/金属','已有glass/metalness基础设置，精细金属/PBR待整理'),('M06','布料/软垫','无真实布料PBR包；床被/沙发/帘共用待制作')]
for id,name,note in materials:
 add(id,name,'材质',0,1,'新外部母版原2K包保original；runtime优化单独验收，本轮未做1K转换',note,mount=0,type='材质包/派生规则',dependency='owned texture registry + physical material props + runtime budget',method='程序与PBR整理；同件≤2材质；不把贴图包数量当模型收费N',acceptance='保存original2K；真实shader/近景光照/重复纹理预算待验；目前无模型材质READY')
add('G01','三层住宅工作/服务点','生活语义',6,6,j['usePoints'],'3空间点各有work/service2 alias；不是6件家具',mount=3,reuse=True,type='权威功能点/接口',dependency='Simulation.isAtBuildingFunctionPoint + getBuildingUsePoints + canAccessFloor + actual route',method='复用现共享功能点，不新增三维模型',count='6逻辑alias/3空间位置，不是6个床睡眠点',acceptance='当前点位：(-398.8,76.6/80/83.4,307.2)；service在桌前，bedrest未实现/未验收')
add('G02','床/座/电脑的真实使用语义','生活语义',0,'依3床/1沙发/1办公桌的实际行为设计','新purpose/状态尚未声明；新位置未生成','当前rest检查租住home+service+20min cooldown；本栋bed目标没有command',mount=0,type='新增游戏接口/待实现',dependency='new trusted usepoint/interaction schema + actual time/need/energy state + save',method='实现真实交互；不得仅物件标签/纹理动画冒充',acceptance='真到场/权限/费用/时长/离场暂停/保存续演；不得以本轮CPU/BOM当功能验收')
add('G03','厨房储物/卫浴/能源供水接口','生活语义',0,'厨房/卫浴方案确定后','尚未生成新家具使用点','原有household/cooking/inventory不证明本栋灶/水槽/厕淋浴可用',mount=0,type='新增游戏接口/待实现',dependency='shared fixtures + actual inventory/cooking/utility/need/timing',method='真实库存与消耗，不创建食物/收益/水电魔法状态',acceptance='实物/资金守恒；权限与可达；新旧存档隔离；本轮未实施')

header=columns+extra
with (ROOT/'bom-full.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,header);w.writeheader()
 for row in rows:w.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in row.items()})
for filename,subset in [('component-masters.csv',physical),('assemblies.csv',rows[47:58]),('materials-and-semantics.csv',rows[58:])]:
 with (ROOT/filename).open('w',newline='') as f:
  w=csv.DictWriter(f,header);w.writeheader()
  for row in subset:w.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in row.items()})

models={'actualReadyNewMeshes':0,'generatedCalls':0,'generationCreditsSpent':0,'quotes':{'source':'Parent actual Mac read-only Tripo H3.1 ordinary2K PBR/relight-off/1200tri preset:45 credits/component; no-texture30; GLB extra unknown. This task did not verify price or call Tripo.','creditsPerModelSamePreset':45,'exportExtraCredits':'UNKNOWN'},'candidates':[{'assetId':'F08','priority':'住屋复杂软垫，可优先程序','newMasterCount':1,'plannedInstances':4,'ready':False},{'assetId':'A21','priority':'可选装饰','newMasterCount':1,'existingAnchors':36,'fullSizeFitsExistingAnchorBox':0,'halfScaleFitsExistingAnchorBox':0,'approvedMounts':0,'ready':False},{'assetId':'A22','priority':'可选装饰','newMasterCount':1,'firstPilotPlanInstances':3,'existingSourceAnchors':50,'maxTilingCandidates':59,'approvedMounts':0,'ready':False}], 'scenarioGenerationCredits':{'N0_all_program':0,'N1_optional_sofa_cushion':45,'N3_with_two_decorations':135},'scope':'N is the number of actual newly generated independent masters selected later; repeated instances are not charged as new models. Export unknown. No requested generation was performed.'}
data={'status':'BOM_PLANNING_AND_REAL_CPU_COUNTS_ONLY','pilot':j['building'],'summary':{'physicalMasterKinds':47,'corePhysicalKinds':45,'optionalDecorativeKinds':2,'existingCoarseKindsToReuseAndUpgrade':21,'newPhysicalKinds':26,'assemblyRecipeKinds':11,'materialPackages':6,'lifeInterfaceEntries':3,'fullTableEntries':len(rows),'currentNearParts':617,'currentDetailAcrossViewsUnique':680,'externalModelAssetsReady':0},'columnContract':header,'rows':rows,'tripo':models,'rawCountFile':'raw-counts.json','evidenceLimitations':j['residenceEvidence']['limitations'],'mountLimitations':['36 brackets are .4 cubes. Half-scale dougong exceeds width/depth, so no fit approval.','Lintel59 is a source-based optional tiling count (17 door+42 window), not approved meshes. First proposed entry only3.','No new furniture plan point is emitted/validated; new planned counts must not be reported as currently placed.'],'sourceUnchanged':j['provenance']['sourceHashesUnchanged'],'collectorKnownCorrection':'First standalone collector omitted required floor arg for getBuildingUsePoints and returned0; preserved first-attempt files. Corrected collector calls all3 floors and now returns6 aliases/3 positions; production unaffected.'}
(ROOT/'bom.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'summary':data['summary'],'csvColumns':len(header),'sourceUnchanged':data['sourceUnchanged']},ensure_ascii=False,indent=2))
