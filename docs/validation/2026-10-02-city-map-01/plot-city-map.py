from pathlib import Path
import os, json, hashlib, math, warnings
from datetime import datetime, timezone
root=Path('/tmp/yunshan-current-city-map-01')
os.environ['MPLCONFIGDIR']=str(root/'.mpl-cache')
import matplotlib
matplotlib.use('Agg')
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
from matplotlib.ft2font import FT2Font
from matplotlib.colors import LinearSegmentedColormap, Normalize
from matplotlib.collections import LineCollection
from matplotlib.patches import Rectangle, Circle
from matplotlib.backends.backend_pdf import PdfPages
from PIL import Image, ImageDraw
fontpath='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
font=FontProperties(fname=fontpath)
plt.rcParams.update({'font.family':font.get_name(),'font.size':10,'axes.unicode_minus':False,'pdf.fonttype':42,'pdf.compression':6})
world=json.loads((root/'world-native.json').read_text())
census=json.loads((root/'city-census.json').read_text())
buildings=json.loads((root/'building-footprints.json').read_text())
grid=json.loads((root/'terrain-grid.json').read_text())
H=np.fromfile(root/'terrain-height-f64.bin',dtype='<f8').reshape(grid['nz'],grid['nx'])
xs=np.linspace(grid['xMin'],grid['xMax'],grid['nx']);zs=np.linspace(grid['zMin'],grid['zMax'],grid['nz'])
labels={'home':'住宅','market':'市集商铺','bank':'银行','workshop':'工坊','farm':'农场','hall':'官署／议事','police':'警务','school':'学校','clinic':'医馆','station':'交通站点','dock':'码头','pavilion':'亭阁','airport':'机场','starport':'星港','core':'天枢主阁'}
colors={'home':'#367d77','market':'#d69a31','bank':'#ab679c','workshop':'#956941','farm':'#819c42','hall':'#7b5488','police':'#4965a4','school':'#559cad','clinic':'#d57677','station':'#53656d','dock':'#258ca5','pavilion':'#647d43','airport':'#5385bf','starport':'#7b70bd','core':'#a83750'}
heightColors=['#96bbbc','#64949c','#3d737f','#a87b47','#b75056','#823448']
def hcolor(h):
    return heightColors[0 if h<15 else 1 if h<30 else 2 if h<60 else 3 if h<100 else 4 if h<150 else 5]
terrainMap=LinearSegmentedColormap.from_list('yunshan-terrain',['#f4f3e4','#e1e7c8','#bdcfaf','#91b09c','#6f8d86','#b9c9c6'])
terrainNorm=Normalize(0,650)
modeStyles={'road':('#525d59',.45,'solid'),'bridge':('#324f60',.9,'solid'),'maglev':('#dc5f3b',1.65,'solid'),'lightRail':('#bf9543',1.4,'dashed'),'cable':('#8b559e',1.25,'dotted'),'lift':('#893f76',1.5,'solid'),'ferry':('#178cbb',1.8,'dashed'),'flight':('#59828b',.85,'dashdot')}
modeLabels={'road':'道路 671（含跑道）','bridge':'桥梁 4','maglev':'磁悬浮 4','lightRail':'轻轨 5','cable':'缆索 2','lift':'升降井 1','ferry':'渡船 2','flight':'飞行路线 2'}
allText=[]
def text(ax,x,y,s,**kwargs):
    allText.append(s);return ax.text(x,y,s,fontproperties=font,**kwargs)
def bodyRaster(bounds,res,by='height'):
    x0,x1,z0,z1=bounds;im=Image.new('RGBA',(res,res),(0,0,0,0));draw=ImageDraw.Draw(im)
    for b in buildings:
        if b['x']+b['width']<x0 or b['x']-b['width']>x1 or b['z']+b['depth']<z0 or b['z']-b['depth']>z1:continue
        color=hcolor(b['bodyHeight']) if by=='height' else colors[b['kind']]
        # Opaque same-height fills avoid stacked wall-band darkness. Courts are
        # separate and are never white-filled or convex-hull substituted.
        for poly in b['polygons']:
            xy=poly['coordinates'];area=abs(sum(xy[i][0]*xy[i+1][1]-xy[i+1][0]*xy[i][1] for i in range(len(xy)-1)))/2
            if area<=1e-8:continue
            points=[((x-x0)/(x1-x0)*(res-1),(z-z0)/(z1-z0)*(res-1)) for x,z in xy]
            draw.polygon(points,fill=color)
    return np.asarray(im)
def basemap(ax,bounds,by='height',districts=True,detail=False):
    x0,x1,z0,z1=bounds
    ax.imshow(H,extent=(grid['xMin'],grid['xMax'],grid['zMax'],grid['zMin']),cmap=terrainMap,norm=terrainNorm,interpolation='bilinear',zorder=0)
    contour=ax.contour(xs,zs,H,levels=np.arange(0,651,50),colors='#566b61',alpha=.23,linewidths=.4,zorder=1)
    if not detail:ax.clabel(contour,levels=np.arange(100,601,100),inline=True,fontsize=6,fmt='%dm')
    ax.imshow(bodyRaster(bounds,3000 if not detail else 1800,by),extent=(x0,x1,z1,z0),interpolation='nearest',zorder=4)
    for mode in ['road','bridge','flight','maglev','lightRail','cable','ferry']:
        color,width,style=modeStyles[mode]
        paths=[[(p['x'],p['z']) for p in e['points']] for e in world['edges'] if e['mode']==mode]
        if paths:ax.add_collection(LineCollection(paths,colors=color,linewidths=width*(1.35 if detail else 1),linestyles=style,alpha=.78,zorder=5))
    river=world['river'];ax.plot([p['x'] for p in river],[p['z'] for p in river],color='#389dcc',linewidth=2.3,zorder=6)
    wf=world['waterfall'];ax.plot([wf['top']['x'],wf['bottom']['x']],[wf['top']['z'],wf['bottom']['z']],color='#056bba',linewidth=3.4,zorder=8)
    ax.scatter([wf['bottom']['x']],[wf['bottom']['z']],s=42,marker='o',facecolor='#a7dced',edgecolor='#0966a0',zorder=9)
    runway=census['runway']['points'];ax.plot([p['x'] for p in runway],[p['z'] for p in runway],color='#eaecea',linewidth=5.2,zorder=6)
    ax.plot([p['x'] for p in runway],[p['z'] for p in runway],color='#3c4a4a',linewidth=2.8,zorder=7)
    lift=[e for e in world['edges'] if e['mode']=='lift'][0]['points'][0];ax.scatter([lift['x']],[lift['z']],marker='D',s=25,color=modeStyles['lift'][0],edgecolor='white',linewidth=.4,zorder=9)
    stations=[n for n in world['nodes'] if n['station']]
    ax.scatter([n['position']['x'] for n in stations],[n['position']['z'] for n in stations],s=3 if not detail else 8,c='#344d59',edgecolors='white',linewidths=.2,zorder=8)
    if districts:
        for i,d in enumerate(world['districts'],1):
            ax.add_patch(Circle((d['center']['x'],d['center']['z']),d['radius'],fill=False,edgecolor='#4e6458',linewidth=.8,linestyle=(0,(4,5)),alpha=.6,zorder=3))
            text(ax,d['center']['x'],d['center']['z'],f"{i:02d} {d['name']}",fontsize=9.3,ha='center',va='center',color='#1b3030',bbox={'boxstyle':'round,pad=.25','fc':'#fbfcf8','ec':'#70847b','alpha':.91},zorder=12)
    ax.set_xlim(x0,x1);ax.set_ylim(z1,z0);ax.set_aspect('equal');ax.tick_params(labelsize=8,colors='#456057')
    ax.grid(alpha=.15,linewidth=.5,color='#607568');ax.set_xlabel('X / 米',fontproperties=font);ax.set_ylabel('Z / 米',fontproperties=font)
    for spine in ax.spines.values():spine.set_color('#92a399')
    return ax
def scale(ax,bounds,length=500):
    x0,x1,z0,z1=bounds;x=x0+(x1-x0)*.06;z=z1-(z1-z0)*.075
    ax.plot([x,x+length],[z,z],color='#213c3a',linewidth=3,zorder=15);ax.plot([x,x],[z-18,z+18],color='#213c3a',zorder=15);ax.plot([x+length,x+length],[z-18,z+18],color='#213c3a',zorder=15)
    text(ax,x+length/2,z-24,f'{length} m',ha='center',fontsize=10,color='#213c3a',bbox={'fc':'white','ec':'none','alpha':.8,'pad':1},zorder=15)
def direction(ax,bounds):
    x0,x1,z0,z1=bounds;x=x1-(x1-x0)*.05;z=z0+(z1-z0)*.12
    ax.annotate('',(x,z-140),(x,z+45),arrowprops={'arrowstyle':'-|>','color':'#213c3a','lw':1.8},zorder=15)
    text(ax,x-40,z+85,'−Z 上方\n非地理北',fontsize=8,ha='right',bbox={'fc':'white','ec':'none','alpha':.8,'pad':2},zorder=15)

bounds=(-2300,2300,-2300,2300)
fig=plt.figure(figsize=(22,15),facecolor='#f6f8f2')
ax=fig.add_axes([.045,.14,.62,.775]);basemap(ax,bounds);scale(ax,bounds);direction(ax,bounds)
main=next(b for b in world['buildings'] if b['id']=='core-main')
ax.scatter([main['position']['x']],[main['position']['z']],marker='*',s=100,color='#b33652',edgecolors='white',zorder=13)
text(ax,main['position']['x']+80,main['position']['z']-170,'天枢阁 234m / 30层\n政府／能源主阁，非商业CBD',fontsize=9,ha='left',color='#622a36',bbox={'fc':'#fff8f6','ec':'#a26a77','alpha':.95,'boxstyle':'round,pad=.3'},zorder=14)
text(ax,155,145,'瀑布落差153m',fontsize=8,color='#145780',bbox={'fc':'#f8fcff','ec':'none','alpha':.88,'pad':2},zorder=14)
text(ax,1190,1580,'跑道 960m · Y=14.6m',fontsize=8,color='#344f54',ha='center',bbox={'fc':'white','ec':'none','alpha':.85,'pad':2},zorder=14)
fig.text(.045,.962,'云山巨城｜当前城市设计图',fontproperties=font,fontsize=24,color='#1b3534',weight='bold')
fig.text(.045,.936,'原生 current-v4 · seed 20261001 · 612栋 / 11功能区 / 674节点 / 691交通边 · 只读静态World，未推进模拟',fontproperties=font,fontsize=11.5,color='#47645c')

side=fig.add_axes([.70,.735,.275,.18]);side.axis('off')
text(side,0,1.05,'设计实数：商业高层尚缺',fontsize=16,color='#243d3b',weight='bold')
text(side,0,.77,'市集109 + 银行32 = 141栋商业用途\n最高商业：66m / 15层\n商业高层 0 · 商业摩天楼 0',fontsize=13.2,color='#71424b',linespacing=1.7)
text(side,0,.32,'本图审阅阈值：商业=market/bank\n高层≥80m或≥20层；摩天楼≥150m\n不把山地海拔或政府主阁计为商业塔。',fontsize=9,color='#49615b',linespacing=1.6)
for i,(color,label) in enumerate(zip(heightColors,['<15m','15–30m','30–60m','60–100m','100–150m','≥150m'])):
    x=(i%3)*.33;y=.05-(i//3)*.16
    side.add_patch(Rectangle((x,y),.055,.07,facecolor=color,transform=side.transAxes,clip_on=False))
    text(side,x+.07,y+.01,label,fontsize=8.5,transform=side.transAxes)
text(side,0,-.38,'建筑填色=主体 height 字段（不含地形海拔）',fontsize=9,color='#3f5d55',transform=side.transAxes)

purpose=fig.add_axes([.714,.354,.247,.325]);basemap(purpose,bounds,by='kind',districts=False)
purpose.set_xticks([-2000,0,2000]);purpose.set_yticks([-2000,0,2000]);purpose.tick_params(labelsize=6);purpose.set_xlabel('');purpose.set_ylabel('')
text(purpose,.02,1.035,'用途分布｜真实首层平面投影',fontsize=12,transform=purpose.transAxes,color='#294642')
purposeLegend=fig.add_axes([.70,.17,.275,.15]);purposeLegend.axis('off')
for i,kind in enumerate(labels):
    col=i//8;row=i%8;x=col*.51;y=.95-row*.12
    purposeLegend.add_patch(Rectangle((x,y-.015),.03,.055,facecolor=colors[kind],transform=purposeLegend.transAxes))
    text(purposeLegend,x+.045,y,f'{labels[kind]} {census["kinds"][kind]}',fontsize=9,transform=purposeLegend.transAxes,va='center')

legend=fig.add_axes([.048,.047,.62,.04]);legend.axis('off')
for i,mode in enumerate(modeStyles):
    x=(i%4)*.245;y=.95-(i//4)*.68;color,width,style=modeStyles[mode]
    legend.plot([x,x+.045],[y,y],color=color,linewidth=width+1,linestyle=style,transform=legend.transAxes)
    text(legend,x+.055,y,modeLabels[mode],fontsize=8.5,va='center',transform=legend.transAxes)
cbax=fig.add_axes([.074,.105,.38,.011]);sm=plt.cm.ScalarMappable(norm=terrainNorm,cmap=terrainMap);fig.colorbar(sm,cax=cbax,orientation='horizontal',ticks=[0,100,200,300,400,500,600])
cbax.tick_params(labelsize=7)
fig.text(.074,.091,'地表 Y（m）｜terrainHeight 50m格网采样 / 50m等高距；包含道路台地、地质切沟及地下凹陷',fontproperties=font,fontsize=8.1,color='#4c685d')
fig.text(.70,.11,'虚线圆=功能区设计半径，非行政边界\n坐标为本地X/Z米，不是经纬度或地理北\n房间／廊／墙为首层投影，开放院落留底图\n交通线宽是图符，不代表实体道路宽度。',fontproperties=font,fontsize=9,color='#476159',linespacing=1.5)
fig.text(.045,.018,'来源：coherent08冻结102输入；World指纹80cd31e2。未构造NPC/经营状态；地图不证明路径、建筑通行、航班或经济验收。',fontproperties=font,fontsize=9,color='#4e675e')

# Validate the actual character set before producing user-facing files.
chars=set(''.join(allText)+''.join(labels.values())+'云山巨城当前城市设计图原生功能区交通边只读静态主体地形格网采样等高距地下凹陷用途分布来源冻结输入世界指纹未经纬度地理北')
cmap=FT2Font(fontpath).get_charmap();missing=sorted(c for c in chars if ord(c)>32 and ord(c) not in cmap)
assert not missing,missing
started=datetime.now(timezone.utc).isoformat()
with warnings.catch_warnings(record=True) as captured:
    warnings.simplefilter('always')
    fig.savefig(root/'city-map-preview.png',dpi=140,facecolor=fig.get_facecolor())
    fig.savefig(root/'云山巨城-当前城市设计图.png',dpi=260,facecolor=fig.get_facecolor())
    with PdfPages(root/'云山巨城-当前城市设计图.pdf') as pdf:
        pdf.savefig(fig,dpi=260,facecolor=fig.get_facecolor())
        details=plt.figure(figsize=(22,13),facecolor='#f6f8f2')
        details.text(.05,.952,'当前街区与主阁｜局部真实平面',fontproperties=font,fontsize=23,color='#213d39')
        areas=[(-920,210,-70,940),(-150,950,-800,250)]
        names=['千灯市集：76栋（商铺／住宅／银行），商业街群而非摩天CBD','瀑云天枢：42栋，主阁234m/30层及瀑布153m落差']
        for i,(area,name) in enumerate(zip(areas,names)):
            a=details.add_axes([.055+i*.48,.16,.425,.73]);basemap(a,area,by='kind',districts=False,detail=True);scale(a,area,200)
            text(a,.015,1.025,name,fontsize=11.5,transform=a.transAxes,color='#284a43')
            visible=[b for b in world['buildings'] if area[0]<b['position']['x']<area[1] and area[2]<b['position']['z']<area[3]]
            a.scatter([b['door']['x'] for b in visible],[b['door']['z'] for b in visible],marker='o',s=8,facecolor='white',edgecolor='#24493e',linewidth=.55,zorder=13)
        details.text(.055,.08,'白圈=原生门口坐标；仅表示平面位置，不声称可走路线已验。底图仍为50m实际地表采样，不能读取20cm踏步或门孔精度。',fontproperties=font,fontsize=11,color='#49645a')
        details.text(.055,.046,'实体细件多层墙band投影使用同色不透明绘制，避免叠色制造假高度；开放院落不白填，保留底图。屋顶／上层扩展不包含在本首层平面。',fontproperties=font,fontsize=10,color='#49645a')
        details.savefig(root/'云山巨城-市集与主阁局部.png',dpi=240,facecolor=details.get_facecolor());pdf.savefig(details,dpi=240,facecolor=details.get_facecolor());plt.close(details)
    glyphWarnings=[str(w.message) for w in captured if 'Glyph' in str(w.message)]
    assert not glyphWarnings,glyphWarnings
    (root/'plot-warnings.json').write_text(json.dumps([str(w.message) for w in captured],ensure_ascii=False,indent=2)+'\n')
plt.close(fig)
manifest={'status':'PLOT_FILES_CREATED','startedAt':started,'endedAt':datetime.now(timezone.utc).isoformat(),'fontPath':fontpath,'fontSHA256':hashlib.sha256(Path(fontpath).read_bytes()).hexdigest(),'fontGlyphsChecked':len(chars),'missingGlyphs':missing,'glyphWarnings':glyphWarnings,'terrainStepM':50,'terrainSamples':grid['samples'],'polygonsAreGroundFloorDescriptorProjection':True,'npcSimulationConstructed':False,'GPU':False,'buildingCount':612,'commercialHighriseCount':0,'commercialSkyscraperCount':0,'nonzeroNativeRotationCount':sum(abs(b['rotationRad'])>1e-12 for b in buildings),'actualBodyHeightNotAltitude':True}
(root/'plot-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
for name in ['city-map-preview.png','云山巨城-当前城市设计图.png','云山巨城-当前城市设计图.pdf','云山巨城-市集与主阁局部.png']:
    p=root/name;print(json.dumps({'path':str(p),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()},ensure_ascii=False))
