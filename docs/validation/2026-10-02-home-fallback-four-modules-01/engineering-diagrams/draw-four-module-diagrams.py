from pathlib import Path
import json,hashlib,math,os
os.environ.setdefault('MPLCONFIGDIR','/tmp/yunshan-module-diagram-cache')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import Rectangle,Circle

root=Path('/workspace/yunshan')
contract=Path('/tmp/yunshan-home-four-module-fit-01/four-module-contract.json')
raw=root/'docs/validation/2026-10-02-home-pilot-market-b24-bom-01/raw/raw-counts.json'
out=Path(__file__).parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
data=json.loads(contract.read_text());scene=json.loads(raw.read_text())
assert data['rawBOMSHA256']==sha(raw) and data['sharedBodyMatchesRawBOM'] and data['approvedInstalls']==0
assert data['sourceUnchanged'] and data['sourceStart']==data['sourceEnd']
for name,value in data['sourceStart'].items():assert sha(root/name)==value,name
assert len(data['modules'])==4
wall,window,door,bonsai=data['modules']
assert wall['providerDescriptorIds']==['floor:0:wall:1']
assert wall['meshDimensionsM']==[1.4,3,.4] and window['realOpening']['width']==1.6
font=Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
font_manager.fontManager.addfont(str(font))
plt.rcParams.update({'font.family':font_manager.FontProperties(fname=str(font)).get_name(),'font.size':10,'axes.unicode_minus':False,'svg.fonttype':'none'})
colors=['#a45936','#227b89','#60498c','#487d42']

def rect_xz(ax,r,**kw):
 ax.add_patch(Rectangle((r['x0'],r['z0']),r['x1']-r['x0'],r['z1']-r['z0'],**kw))
def box_xz(ax,b,**kw):
 rect_xz(ax,{'x0':b['min']['x'],'x1':b['max']['x'],'z0':b['min']['z'],'z1':b['max']['z']},**kw)
def dim(ax,a,b,label,offset=.25,vertical=False,color='#42524c'):
 if vertical:
  ax.annotate('',xy=(a[0]+offset,b[1]),xytext=(a[0]+offset,a[1]),arrowprops={'arrowstyle':'<->','color':color})
  ax.text(a[0]+offset+.08,(a[1]+b[1])/2,label,va='center',fontsize=10)
 else:
  ax.annotate('',xy=(b[0],a[1]+offset),xytext=(a[0],a[1]+offset),arrowprops={'arrowstyle':'<->','color':color})
  ax.text((a[0]+b[0])/2,a[1]+offset+.05,label,ha='center',va='bottom',fontsize=10)

plan=scene['body']['floorPlans'][0]
fig,ax=plt.subplots(figsize=(11.2,10.2))
for r in plan['interior']:rect_xz(ax,r,facecolor='#f0eee7',edgecolor='none')
for r in plan['courtyard']:rect_xz(ax,r,facecolor='#eaf1e9',edgecolor='none')
for r in plan['circulation']:rect_xz(ax,r,facecolor='#e6edea',edgecolor='none')
for s in scene['floorData'][0]['panels']:
 if s['kind']=='solid':rect_xz(ax,s['rect'],facecolor='#7f8881',edgecolor='none',alpha=.7)
for s in plan['stairTreads']:rect_xz(ax,s['rect'],facecolor='#c6cec7',edgecolor='#88948a',linewidth=.35)
for f in plan['fixtures']:
 rect_xz(ax,f['rect'],facecolor='#e4cda7',edgecolor='#ad9369',linewidth=.7)
 if f['kind']=='bed':ax.text((f['rect']['x0']+f['rect']['x1'])/2,-15.8,'现有粗床',fontsize=8,ha='center')
point=plan['usePoint'];ax.add_patch(Circle((point['x'],point['z']),2,fill=False,edgecolor='#b19d66',linestyle='--',linewidth=1));ax.text(point['x']+2.3,point['z'],'真实服务点\n2m范围',fontsize=8,color='#8d7740')
hole=scene['body']['floorPlans'][1]['stairHole'];rect_xz(ax,hole,facecolor='none',edgecolor='#b66363',hatch='///',linewidth=.8);ax.text(hole['x1']+.4,hole['z0'],'一层楼梯孔投影\n保持原权威',fontsize=8,color='#a04f4f')
for b in wall['occupiedSolids']:box_xz(ax,b,facecolor=colors[0],edgecolor='white',linewidth=1)
for m in [window,door,bonsai]:
 p=m['localMount'];a=m['assetBounds'];X=m['buildingLocalBasis']['X'];Z=m['buildingLocalBasis']['Z']
 corners=[(p['x']+x*X['x']+z*Z['x'],p['z']+x*X['z']+z*Z['z']) for x in [a['min']['x'],a['max']['x']] for z in [a['min']['z'],a['max']['z']]]
 ax.add_patch(Rectangle((min(c[0] for c in corners),min(c[1] for c in corners)),max(c[0] for c in corners)-min(c[0] for c in corners),max(c[1] for c in corners)-min(c[1] for c in corners),facecolor=colors[data['modules'].index(m)],edgecolor='white',linewidth=1,alpha=.8))
 if m is bonsai:
  # Square candidate envelope and .35m body exclusion are proposals, not new collision geometry.
  ax.add_patch(Rectangle((p['x']-.75,p['z']-.75),1.5,1.5,facecolor='none',edgecolor=colors[3],linestyle=':'))
labels=[('墙：1.4m × 2\nwall1/near28+29',wall['candidateMounts'][0]['localMount'],(4,-19)),('窗：2 × 2.2 × .4\n净洞1.6 × 1.4',window['localMount'],(-20,20)),('开放门框：5.6 × 3.2 × .4\n净孔4.8 × 2.8',door['localMount'],(5,20)),('盆景提案：.8 × 1.3 × .8\n完整底盘静态支持',bonsai['localMount'],(14,7))]
for i,(label,p,t) in enumerate(labels):ax.annotate(label,xy=(p['x'],p['z']),xytext=t,ha='left',va='center',fontsize=9,color=colors[i],arrowprops={'arrowstyle':'->','color':colors[i]})
ax.plot([0],[0],'+',color='#222',markersize=10);ax.text(.6,.4,'建筑局部原点\n世界(-390.8,76.6,316.2)',fontsize=8)
ax.set(xlim=(-24,25),ylim=(-22,23),xlabel='建筑局部 X / m',ylabel='建筑局部 Z / m',title='market-b24 真实底层平面 · 四类规范候选位置')
ax.set_aspect('equal');ax.grid(alpha=.12)
fig.text(.5,.025,'仅静态规范/支撑与净空计算；新增安装0、模型验收0、此图没有运行W或WebGL。上层孔只投影提示。',ha='center',fontsize=9,color='#8f514e')
fig.tight_layout(rect=(0,.055,1,1))
for ext in ['png','svg']:fig.savefig(out/f'actual-ground-plan-four-candidates.{ext}',dpi=180)
plt.close(fig)

fig,axs=plt.subplots(2,2,figsize=(14,10));axs=list(axs.flat)
for i,(m,ax) in enumerate(zip(data['modules'],axs)):
 a=m['assetBounds'];width=m['meshDimensionsM'][0];height=m['meshDimensionsM'][1]
 ax.add_patch(Rectangle((a['min']['x'],0),width,height,fill=False,edgecolor=colors[i],linewidth=1.4,linestyle='--'))
 if i==0:
  ax.add_patch(Rectangle((-.7,0),1.4,.8,facecolor='#b8b9b1',edgecolor='#717d76'))
  ax.add_patch(Rectangle((-.7,.8),1.4,2.2,facecolor='#e5dfd1',edgecolor='#717d76'))
  ax.text(0,1.5,'实心墙段\n2件同母版\n端面相接不叠面',ha='center',fontsize=10)
 elif i==1:
  # Actual old nine pieces projected to the asset front coordinates; not an approved new mesh.
  opening=m['realOpening']['assetLocalBounds'];ax.add_patch(Rectangle((opening['min']['x'],opening['min']['y']),1.6,1.4,facecolor='#d7eaeb',edgecolor='#32818b'))
  for f in m['oldFineParts']:
   b=f['bounds'];x=b['x'][0]-m['localMount']['x'];y=b['y'][0]-m['localMount']['y']
   ax.add_patch(Rectangle((x,y),b['x'][1]-b['x'][0],b['y'][1]-b['y'][0],facecolor='#b9ac8a',edgecolor='#97866b',linewidth=.5,alpha=.9))
  ax.text(0,1.1,'净洞1.6 × 1.4\n窗台高.8（建筑）',ha='center',fontsize=9,color='#225a65')
  ax.text(-1.15,-.42,'8邻墙共面2.16m²；玻璃/格栅.8m²，先原子裁剪替换。',fontsize=9,color='#a04f4f')
 elif i==2:
  ax.add_patch(Rectangle((-2.8,0),.4,2.8,facecolor='#bcbfb6',edgecolor=colors[i]))
  ax.add_patch(Rectangle((2.4,0),.4,2.8,facecolor='#bcbfb6',edgecolor=colors[i]))
  ax.add_patch(Rectangle((-2.8,2.8),5.6,.4,facecolor='#bcbfb6',edgecolor=colors[i]))
  ax.text(0,1.2,'保持4.8 × 2.8净孔\n无升高门槛\n当前仅开放框',ha='center',fontsize=10)
  ax.text(-2.8,-.5,'实体形状是包络示意；双门扇待真实开合/碰撞/保存权威。',fontsize=9,color='#a04f4f')
 else:
  ax.add_patch(Rectangle((-.4,0),.8,.4,facecolor='#b3b8a6',edgecolor=colors[i]));ax.add_patch(Rectangle((-.4,.3),.8,1,fill=False,edgecolor=colors[i],linestyle=':'))
  ax.plot([0,0],[.3,1.3],color=colors[i],linewidth=3)
  ax.text(.90,1.08,'树根socket y=.30\n冠提案.8 × 1 × .8\n盆器高.4 / 整组1.3',fontsize=9)
  ax.text(-.7,-.45,'支撑与72身体/头部静态查询通过，真实模型/摆放仍未验证。',fontsize=9,color='#a04f4f')
 ax.plot([0],[0],'+',color='#b54c43',markersize=9)
 dim(ax,(a['min']['x'],height),(a['max']['x'],height),f'{width:g}m',offset=.27)
 dim(ax,(a['max']['x'],0),(a['max']['x'],height),f'{height:g}m',offset=.28,vertical=True)
 ax.set(xlim=(a['min']['x']-max(.7,width*.15),a['max']['x']+max(1.4,width*.18)+(0.5 if i==3 else 0)),ylim=(-.75,height+.8),xlabel='资产局部 +X / m',ylabel='+Y / m')
 ax.set_aspect('equal');ax.grid(alpha=.12);ax.set_title(f'{m["moduleId"]}\n底部原点 +Y向上/+Z向外，厚度{m["meshDimensionsM"][2]:g}m',fontsize=11)
fig.suptitle('四类精确尺寸接口 · 包络/旧件示意，未安装的新资产不由此验收',fontsize=15)
fig.text(.5,.015,'结构量化.2m；外模不得负scale或非均匀拉伸。窗口沿原真洞，不把落地窗参考改成新通路。',ha='center',fontsize=10)
fig.tight_layout(rect=(0,.04,1,.95))
for ext in ['png','svg']:fig.savefig(out/f'four-module-metric-interfaces.{ext}',dpi=180)
plt.close(fig)
files=[p for p in sorted(out.iterdir()) if p.is_file() and p.name!='diagram-provenance.json']
manifest={'scope':'Engineering plot of actual shared floor and proposed precise module envelopes; no edited reference image, imported model or art acceptance','contract':str(contract),'contractSHA256':sha(contract),'rawBOMSHA256':sha(raw),'providerSHA256':data['sourceStart']['src/architecture-floor-plan.ts'],'newInstallations':0,'newModelAcceptance':0,'outputs':[{'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in files]}
(out/'diagram-provenance.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(manifest,ensure_ascii=False))
