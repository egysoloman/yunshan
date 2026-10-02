from pathlib import Path
import argparse, base64, hashlib, html, io, json, shutil, time, zipfile
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader

BASE=Path(__file__).parent
CFG=json.loads((BASE/'delivery-config.json').read_text())
ROOT,SNAP,OUT=(Path(CFG[k]) for k in ['root','snapshot','output'])
PREFIX='yunshan-'+CFG['phase']+'-'
DISPLAY=CFG['displayName']
SCENES=['core-waterfall','market-street','residential-first-person','bridge-walk-center','bridge-structure','bridge-public-road']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
jsonread=lambda p:json.loads(p.read_text())

def local(path):
    p=Path(path)
    return p if p.is_absolute() else ROOT/p

def ready():
    gate=CFG['rootReview']
    assert gate['confirmed'] is True,'await actual results and root image/doc confirmation'
    for k in ['reviewedAt','rootMessage','visualStatus','visualSummary','ordinaryJourneySummary','memoUpdatedAt','matrixUpdatedAt']:
        assert gate.get(k),'missing root-reviewed '+k
    assert gate['visualStatus'] in ['FAIL','PASS','PARTIAL']
    m=jsonread(SNAP/'source-snapshot.json'); h=m['copiedHashes']
    assert CFG['expectedSourceCount'] and len(h)==CFG['expectedSourceCount']
    assert all(sha(SNAP/f)==v for f,v in h.items()),'immutable source mismatch'
    assert sha(SNAP/'dist'/CFG['buildEntry'].lstrip('/'))==CFG['buildSHA256']
    rs=jsonread(local(CFG['rulesStatus']))
    assert rs['rules']['exitCode']==0 and rs['rules']['tests']==rs['rules']['passed']
    assert CFG['expectedRuleCount'] and rs['rules']['tests']==CFG['expectedRuleCount']
    assert rs['rules']['failed']==rs['rules']['cancelled']==rs['rules']['skipped']==0
    assert rs['build']['exitCode']==0 and rs['build']['sha256']==CFG['buildSHA256']
    assert sha(local(CFG['rulesStatus']).parent/'full-rules.log')==CFG['rulesRawSHA256']==rs['rules']['fullLogSHA256']
    ui=jsonread(local(CFG['uiResults'])); um=jsonread(local(CFG['uiManifest']))
    assert ui['status']=='passed' and ui['errors']==[]
    assert CFG['expectedUICount'] and ui['checks']==CFG['expectedUICount']
    assert um['sourceFileCount']==CFG['expectedSourceCount'] and um['snapshotUnchanged'] and um['buildSHA256After']==CFG['buildSHA256']
    b=CFG['browser']; assert b['resultsPath'] and b['manifestPath'] and b['exitCode'] is not None,'browser still pending'
    br=jsonread(local(b['resultsPath'])); bm=jsonread(local(b['manifestPath']))
    assert br['buildEntry']==CFG['buildEntry'],'browser used another bundle'
    assert bm['completedAt'] and bm['exitCode']==b['exitCode'],'browser manifest not completed'
    assert bm['entry']==CFG['buildEntry'] and bm['entrySHA256Start']==bm['entrySHA256End']==CFG['buildSHA256']
    assert bm['fileCount']==CFG['expectedSourceCount'] and bm['allCopiedFilesUnchanged'] and bm['sourceHashesStart']==bm['sourceHashesEnd']==h
    assert sha(local(b['resultsPath']))==bm['resultSHA256'],'browser result byte mismatch'
    assert len(br['results'])==11 and br['errors']==[] and b['exitCode']==0,'canonical browser did not complete11 cleanly'
    macro=CFG['macro']; assert macro['manifestPath'] and macro['completedTechnicalViews'] is not None and macro['errors'] is not None,'macro still pending'
    mm=jsonread(local(macro['manifestPath'])); assert mm['completedAt'],'missing macro completed manifest'
    assert mm['entry']==CFG['buildEntry'] and mm['entrySHA256Start']==mm['entrySHA256End']==CFG['buildSHA256']
    assert mm['fileCount']==CFG['expectedSourceCount'] and mm['allCopiedFilesUnchanged'] and mm['sourceHashesStart']==mm['sourceHashesEnd']==h
    capture=jsonread(local(macro['captureResultsPath']))
    assert sha(local(macro['captureResultsPath']))==mm['resultSHA256']
    assert capture['buildEntry']==CFG['buildEntry'] and capture['buildHash']==CFG['buildSHA256']
    assert len(capture['captures'])==macro['completedTechnicalViews'] and capture['errors']==macro['errors']
    assert macro['completedTechnicalViews']==6 and macro['errors']==[] and mm['exitCode']==0
    provenance=jsonread(local(macro['documentProvenancePath']))
    assert provenance['workspace']==str(SNAP) and provenance['actualCwd']==str(SNAP)
    assert provenance['expectedEntry']==CFG['buildEntry'] and provenance['expectedSHA']==CFG['buildSHA256']
    assert provenance['sourceFiles']==CFG['expectedSourceCount'] and provenance['documents']
    for doc in provenance['documents']:
        loaded=doc['loadedAsset']; assert loaded['status']==200 and loaded['sha256']==CFG['buildSHA256'] and loaded['fromServiceWorker'] is False
    for key in SCENES:
        assert macro['pngPaths'].get(key),'missing actual PNG '+key
        assert local(macro['pngPaths'][key]).is_file()
        assert gate['sceneNotes'].get(key),'missing root-reviewed actual scene '+key
    ec=jsonread(local(CFG['economySummary'])); ea=jsonread(local(CFG['economyAnalysis']))
    assert ec['status']=='passed' and ec['sourceStable'] and ec['NPC']['alive']==616
    assert ec['coreSHA']==h['src/simulation.ts'],'economic core is a different implementation'
    assert ec['NPC']['cashRichStarving']==276 and ec['trend']['steadyStateEstablished'] is False
    refs=jsonread(local(CFG['referenceAccess']))['githubResolution']['files']
    assert len(refs)==5
    for row in refs:assert sha(ROOT/row['path'])==row['sha256']
    native=jsonread(local(CFG['nativeJourneyResults'])); nm=jsonread(local(CFG['nativeJourneyManifest']))
    assert native['status']=='paused-at-checkpoint' and native['errors']==[] and native['completedStage']=='home'
    assert native['buildEntry']==CFG['buildEntry'] and native['buildHash']==CFG['buildSHA256']
    assert nm['sourceHashesStart']==nm['sourceHashesEnd']==h and nm['entrySHA256Start']==nm['entrySHA256End']==CFG['buildSHA256']
    assert nm['exitCode']==0 and nm['resultSHA256']==sha(local(CFG['nativeJourneyResults']))
    assert sha(local(CFG['externalTestedHarness']))==sha(ROOT/'scripts/player-journey.mjs')==CFG['externalTestedHarnessSHA256']==native['harnessHash']
    delta=jsonread(local(CFG['postValidationDelta']))
    assert delta['allProductionSourcesAndTestsMatch05'] is True
    assert all(sha(ROOT/f)==v for f,v in h.items() if f.startswith(('src/','tests/')))
    changes={r['path']:r for r in delta['changes']}
    for f in [CFG['memo'],CFG['matrix'],'scripts/player-journey.mjs']:
        assert sha(ROOT/f)==changes[f]['afterSHA256'] and h[f]==changes[f]['frozenSHA256']
    return {'snapshot':m,'rules':rs,'ui':ui,'uiManifest':um,'browser':br,'browserManifest':bm,'macroManifest':mm,'economy':ec,'economyAnalysis':ea,'references':refs}

def image_records():
    paths=[('reference-'+str(i),ROOT/f'参考图/参考图{i}.png') for i in range(1,6)]
    paths.extend((k,local(CFG['macro']['pngPaths'][k])) for k in SCENES)
    ui_parent=local(CFG['uiResults']).parent
    paths.extend((n,ui_parent/(n+'.png')) for n in ['ui-clinical-purchase','ui-clinical-completed'])
    rows=[]
    for name,p in paths:
        with Image.open(p) as im:dim=im.size
        rows.append({'name':name,'sourcePath':str(p),'bytes':p.stat().st_size,'sha256':sha(p),'dimensions':dim,'edited':False})
    return rows

def report(data):
    imgs=image_records(); lookup={r['name']:Path(r['sourcePath']) for r in imgs}
    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
    W,H=landscape(A4); c=canvas.Canvas(str(OUT/(PREFIX+'review.pdf')),pagesize=(W,H),pageCompression=1)
    c.setTitle('云山巨城 / '+DISPLAY+' 原图与实际验收')
    ink=colors.HexColor('#263c35'); muted=colors.HexColor('#67746b')
    style=ParagraphStyle('body',fontName='STSong-Light',fontSize=10,leading=15,textColor=ink)
    small=ParagraphStyle('small',parent=style,fontSize=8.2,leading=11.5,textColor=muted)
    def text(s,x,top,width,sp=style):
        p=Paragraph(html.escape(s).replace('\n','<br/>'),sp);_,ht=p.wrap(width,H);p.drawOn(c,x,top-ht);return ht
    def header(n,title,sub):
        c.setFillColor(colors.HexColor('#f6f3e9'));c.rect(0,0,W,H,fill=1,stroke=0)
        c.setFillColor(ink);c.setFont('STSong-Light',19);c.drawString(30,H-43,title)
        text(sub,30,H-68,W-60,small)
        c.setStrokeColor(colors.HexColor('#cecdbc'));c.line(30,37,W-30,37)
        c.setFillColor(muted);c.setFont('STSong-Light',8)
        c.drawString(30,22,'原始PNG保持原字节；仅显示缩放，无重绘/裁切。各视点与场景测试范围独立。')
        c.drawRightString(W-30,22,DISPLAY+' / '+str(n)+' / 5')
    def pic(name,label,x,y,w,h):
        c.setFillColor(colors.HexColor('#e8e7dd'));c.rect(x,y,w,h,fill=1,stroke=0)
        c.drawImage(ImageReader(io.BytesIO(lookup[name].read_bytes())),x,y,width=w,height=h,preserveAspectRatio=True,anchor='c',mask='auto')
        text(label,x,y-7,w,small)
    gate=CFG['rootReview']; col=(W-74)/2; x2=44+col
    header(1,'云山巨城 / '+DISPLAY+' 阶段原件',str(CFG['expectedSourceCount'])+'冻结源 / strict与'+str(CFG['expectedRuleCount'])+'规则；参考视觉 '+gate['visualStatus']+'；完整目标未完成。')
    pic('reference-5','GitHub 原参考图5 / 6955d37',30,237,col,255)
    pic('core-waterfall',DISPLAY+' / 原始core-waterfall实拍',x2,237,col,255)
    text(gate['visualSummary'],30,181,W-60)
    text('原参考与本轮实际画面来自各自机位，排版对照不能冒称同镜头重拍。新PDF与旧coherent02原件分别封存。',30,126,W-60)
    text('实际冻结入口SHA256：'+CFG['buildSHA256'],30,78,W-60,small)
    c.showPage()
    header(2,'真实市集与住宅 / 原图对照','固定机位完整画幅；未知橙色物体不推定用途，柜台几何由独立实体回归核验。')
    for row,ref,key in [(296,'reference-1','market-street'),(80,'reference-2','residential-first-person')]:
        pic(ref,'GitHub 原始'+ref,30,row,col,180)
        pic(key,DISPLAY+' / '+key+' / '+gate['sceneNotes'][key],x2,row,col,180)
    c.showPage()
    header(3,'道路与桥 / 保留实际构图','真实新机位与技术结果分开；失败构图不会被另一机位替代。')
    for row,ref,key in [(296,'reference-3','bridge-walk-center'),(80,'reference-4','bridge-structure')]:
        pic(ref,'GitHub 原始'+ref,30,row,col,180)
        pic(key,DISPLAY+' / '+key+' / '+gate['sceneNotes'][key],x2,row,col,180)
    c.showPage()
    header(4,'公共路面与DOM诊疗 / 明确范围','上图是实际CityRenderer；下两图为本轮真实UI fixture，无CityRenderer/GL，受控现场与患者。')
    pic('bridge-public-road',DISPLAY+' / bridge-public-road / '+gate['sceneNotes']['bridge-public-road'],30,309,W-60,184)
    pic('ui-clinical-purchase','本轮UI原件 / 实际材料与托管凭证 / 控制场景',30,87,col,180)
    pic('ui-clinical-completed','本轮UI原件 / 实际20分钟诊疗与费用 / 无城市画面',x2,87,col,180)
    c.showPage()
    br=data['browser']; bpassed=len(br['results']); bstatus='PASS' if bpassed==11 and CFG['browser']['exitCode']==0 and br['errors']==[] else 'FAIL/PARTIAL'
    ec=data['economy']; macro=CFG['macro']; macrotext=str(macro['completedTechnicalViews'])+'/6'
    pool_remaining=sum(row['quantity'] for rows in data['economyAnalysis']['freightPools'].values() for row in rows)
    rows=[['证据','实际结果','范围与限制'],['同'+DISPLAY+'完整规则',str(CFG['expectedRuleCount'])+'/'+str(CFG['expectedRuleCount']),'exit0，0失败/取消/跳过；'+str(data['rules']['rules']['durationMs'])+'ms。'+str(CFG['expectedSourceCount'])+'源与strict产物哈希起止一致。'],['同'+DISPLAY+'原生DOM UI',str(CFG['expectedUICount'])+'/'+str(CFG['expectedUICount']),'disable-gpu、真实World/Simulation/Controller，隔离View；无CityRenderer，不是正常玩家旅行或画面验收。'],['同'+DISPLAY+'实际浏览器',str(bpassed)+'/11 '+bstatus,'实际exit'+str(CFG['browser']['exitCode'])+'，errors='+str(br['errors'])+'；受控现场/身份 fixture，经真实上下车、飞行与原60秒返航断言；不冒称自然取得身份。'],['六固定机位','技术'+macrotext,'1440×900 / PR1 / FOV48 / 正午诊断机位；实际'+CFG['buildEntry']+'产物，根参考视觉 '+gate['visualStatus']+'。技术检查不等于美术质量。'],['空货车修复14日','616存活','276有钱居民仍饥饿、公库11198.7887；食品日产196.08 vs需852.92，区货池余额'+format(pool_remaining,'.2f')+'。无人照料玩家亡故，仍非稳态，新30/60未运行。'],['普通旅程','仅实际进度',gate['ordinaryJourneySummary']],['未完成目标','继续推进','完整提示词、参考视觉、财政/配送稳态、Mac实机、纯统计区/模拟流式仍有缺项；学校当前付款即成长，真实课程分钟仍待实施；/tmp原型不算生产。']]
    header(5,'实际验证范围与继续工作','旧02通过/失败与本轮证据分列；未完成的旅程/视觉/稳态不改写为通过。')
    ts=ParagraphStyle('table',parent=style,fontSize=9.1,leading=12.2)
    table=Table([[Paragraph(html.escape(v),ts) for v in row] for row in rows],colWidths=[139,90,W-60-229])
    table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#dfe6da')),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-1),.4,colors.HexColor('#d0d1c4'))]))
    _,ht=table.wrap(W-60,H);table.drawOn(c,30,H-104-ht)
    text('新源码ZIP完整保'+str(CFG['expectedSourceCount'])+'冻结原文件与dist；最新备忘录/矩阵原字节另附，旧snapshot文档保原出处。Library仅按实际单批返回记录送达结果。',30,H-125-ht,W-60,small)
    c.showPage();c.save()
    gallery=''.join('<figure><img src="data:image/png;base64,'+base64.b64encode(Path(r['sourcePath']).read_bytes()).decode()+'"><figcaption>'+html.escape(r['name'])+' / SHA256 '+r['sha256']+'</figcaption></figure>' for r in imgs)
    status={'rules':str(CFG['expectedRuleCount'])+'/'+str(CFG['expectedRuleCount']),'ui':str(CFG['expectedUICount'])+'/'+str(CFG['expectedUICount'])+' DOM only','browserChecks':bpassed,'browserStatus':bstatus,'macroTechnicalViews':macro['completedTechnicalViews'],'rootVisual':gate['visualStatus'],'remaining':gate['ordinaryJourneySummary'],'economicSteadyState':False}
    body='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>云山 '+DISPLAY+' 原图审查</title><style>body{background:#f6f3e9;color:#263c35;font:16px/1.7 system-ui;margin:32px}img{width:100%;height:auto}figure{margin:0}figcaption{font-size:12px;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style><h1>云山 '+DISPLAY+' 原件</h1><p>'+html.escape(gate['visualSummary'])+'</p><pre>'+html.escape(json.dumps(status,ensure_ascii=False,indent=2))+'</pre><p>13张原PNG只显示缩放；5参考、6本轮CityRenderer图、2本轮DOM诊疗图分别标明来源。原图和新memo/矩阵保持原字节；MAC/模拟流式/完整目标未完成。旧02与04历史原件与失败保留。</p><div class="grid">'+gallery+'</div>'
    (OUT/(PREFIX+'review.html')).write_text(body)
    (OUT/'image-source-manifest.json').write_text(json.dumps({'images':imgs,'originalPNGBytesUnchanged':True},ensure_ascii=False,indent=2)+'\n')
    assert all(sha(Path(r['sourcePath']))==r['sha256'] for r in imgs)


def packages(data):
    h=data['snapshot']['copiedHashes']; source_rows={}; evidence_rows={}; ref_rows={}
    def put(z,p,arc,rows):
        b=p.read_bytes();z.writestr(arc,b);rows[arc]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
    with zipfile.ZipFile(OUT/(PREFIX+'source.zip'),'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for f in sorted(h):put(z,SNAP/f,'app/'+f,source_rows)
        for p in sorted((SNAP/'dist').rglob('*')):
            if p.is_file():put(z,p,'app/'+p.relative_to(SNAP).as_posix(),source_rows)
        put(z,SNAP/'source-snapshot.json','snapshot/source-snapshot.json',source_rows)
        put(z,local(CFG['externalTestedHarness']),'external-tested-harness/player-journey-r9-r10.mjs',source_rows)
        put(z,local(CFG['postValidationDelta']),'external-tested-harness/post-validation-delta.json',source_rows)
        z.writestr('README.txt','Complete frozen '+DISPLAY+' 89 original files + dist; original frozen memo/matrix and9945 journey script are preserved. External3c8 journey harness actually tested in r9/r10 is separate under external-tested-harness, outside the89/rules390 scope. Latest root memo/matrix are separate current originals. Actual rules and DOM checks are independent from controlled native-boarding browser fixtures and six diagnostic screenshots. No node_modules/profile/.git/credential or unintegrated production prototype. Complete game/visual/Mac/streaming/steady-state target remains incomplete.\n')
        z.writestr('file-sha256.json',json.dumps(source_rows,ensure_ascii=False,indent=2)+'\n')
    selected=set()
    for d in CFG['evidenceDirectories']:
        path=local(d);assert path.is_dir(),str(path);selected.update(p for p in path.rglob('*') if p.is_file())
    for d in [local(CFG['browser']['resultsPath']).parent,local(CFG['macro']['manifestPath']).parent]:
        selected.update(p for p in d.rglob('*') if p.is_file())
    selected.update(local(f) for f in CFG['evidenceFiles'])
    selected.add(local(CFG['referenceAccess']))
    archive_links=[{'repoPath':f,'bytes':local(f).stat().st_size,'sha256':sha(local(f)),'embedded':False,'scope':'Historical CPU-only prototype, not production/GL; original is retained in repository at this exact path.'} for f in CFG['historicalArchiveLinks']]
    selected={p for p in selected if not any(x in p.parts for x in CFG['excludeComponents']) and p not in {local(f) for f in CFG['historicalArchiveLinks']}}
    with zipfile.ZipFile(OUT/(PREFIX+'evidence.zip'),'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for p in sorted(selected):put(z,p,'evidence/'+p.relative_to(ROOT).as_posix() if p.is_relative_to(ROOT) else 'external/'+p.parent.name+'/'+p.name,evidence_rows)
        z.writestr('README.txt','New '+DISPLAY+' actual rules/UI/browser/six raw captures plus root review, actual fourteen-day production empty-freight audit, shared-counter/path regression failures and archived incomplete ordinary journey. Evidence scopes independent; no open profiles/live artifacts/prototypes. Old coherent02 original package and zero-ID upload failure remain untouched.\n')
        z.writestr('linked-historical-prototype-archives.json',json.dumps(archive_links,ensure_ascii=False,indent=2)+'\n')
        z.writestr('file-sha256.json',json.dumps(evidence_rows,ensure_ascii=False,indent=2)+'\n')
    with zipfile.ZipFile(OUT/'yunshan-original-references.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for row in data['references']:put(z,ROOT/row['path'],row['path'],ref_rows)
        z.writestr('provenance.json',json.dumps({'source':'User GitHub originals6955d37; same rawPNG bytes','files':ref_rows},ensure_ascii=False,indent=2)+'\n')
    docs={}
    for key,label in [('memo','memo.md'),('matrix','requirements.md')]:
        p=ROOT/CFG[key];t=OUT/(PREFIX+label);shutil.copyfile(p,t);docs[label]={'sourcePath':str(p),'bytes':t.stat().st_size,'sha256':sha(t),'rootConfirmedUpdateAt':CFG['rootReview'][key+'UpdatedAt'],'copiedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    assert all(sha(SNAP/f)==v for f,v in h.items())
    manifest={'phase':CFG['phase'],'snapshot':str(SNAP),'sourceCount':CFG['expectedSourceCount'],'sourceHashes':h,'sourceUnchanged':True,'buildEntry':CFG['buildEntry'],'buildSHA256':CFG['buildSHA256'],'sourceZIPMembers':source_rows,'evidenceZIPMembers':evidence_rows,'referenceZIPMembers':ref_rows,'linkedHistoricalPrototypeArchives':archive_links,'externalTestedHarness':{'source':CFG['externalTestedHarness'],'sha256':CFG['externalTestedHarnessSHA256'],'tested':'r9/r10','insideFrozen89':False,'frozenOriginalPreserved':h['scripts/player-journey.mjs']},'latestRootDocs':docs,'rootReview':CFG['rootReview'],'scope':{'rules':data['rules']['rules'],'ui':{'checks':CFG['expectedUICount'],'cityRenderer':False,'gpuDisabled':True},'browser':{'checks':len(data['browser']['results']),'errors':data['browser']['errors'],'exitCode':CFG['browser']['exitCode'],'controlledLocationAndIdentityFixtures':True},'macro':{'actualScenes':6,'technical':CFG['macro']['completedTechnicalViews'],'visual':CFG['rootReview']['visualStatus']},'economy14d':data['economy'],'finalDistrictFreightPoolQuantity':sum(row['quantity'] for rows in data['economyAnalysis']['freightPools'].values() for row in rows),'fullGoalCompleted':False,'macHardwareVerified':False,'statisticsSimulationStreamingComplete':False,'profilesIncluded':False,'prototypesIncluded':False},'files':[],'libraryStatus':'not-attempted'}
    names=[PREFIX+'review.pdf',PREFIX+'review.html',PREFIX+'source.zip',PREFIX+'evidence.zip',PREFIX+'memo.md',PREFIX+'requirements.md','yunshan-original-references.zip']
    for n in names:
        p=OUT/n;manifest['files'].append({'localPath':str(p),'fileName':n,'bytes':p.stat().st_size,'sha256':sha(p),'libraryArtifactType':'report' if n.endswith(('.pdf','.html')) else 'other'})
    (OUT/'deliverable-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    (OUT/'SHA256SUMS').write_text(''.join(r['sha256']+'  '+r['fileName']+'\n' for r in manifest['files']))
    return manifest

def validate_zip(manifest):
    for name,key in [(PREFIX+'source.zip','sourceZIPMembers'),(PREFIX+'evidence.zip','evidenceZIPMembers'),('yunshan-original-references.zip','referenceZIPMembers')]:
        with zipfile.ZipFile(OUT/name) as z:
            assert z.testzip() is None
            for n,row in manifest[key].items():
                b=z.read(n);assert len(b)==row['bytes'] and hashlib.sha256(b).hexdigest()==row['sha256'],n

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['check','generate']);a=p.parse_args()
    if a.mode=='check':
        try:ready()
        except AssertionError as e:print('NOT_READY: '+str(e));raise SystemExit(2)
        print('READY: actual result/doc/image gates satisfied')
    else:
        data=ready();OUT.mkdir(parents=True,exist_ok=False)
        report(data);m=packages(data);validate_zip(m)
        print(json.dumps({'status':'generated-local-only','files':m['files'],'actualImages':13,'pagesRequested':5,'uploadAttempted':False},ensure_ascii=False))
