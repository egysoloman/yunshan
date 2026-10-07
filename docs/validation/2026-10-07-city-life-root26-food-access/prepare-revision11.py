from pathlib import Path
from datetime import datetime, timezone
import csv, hashlib, io, json, re

work = Path('/workspace/yunshan-work/ROOT26-food-access-20261007-01')
drafts = work / 'report-draft'
old = drafts / 'revision-10-narrow03-pre-egress'
out = Path(__file__).resolve().parent
originals = Path('/tmp/ROOT26-food-access-20261007-01/compare-originals01')
repo = Path('/workspace/yunshan')
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
load = lambda p: json.loads(p.read_text())
record = lambda p: {'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)}
prior_hashes = {str(p):sha(p) for p in drafts.rglob('*') if p.is_file() and out not in p.parents}
source_before = {p:sha(repo/p) for p in load(work/'build01-gate/inputs-before.json')}
assert source_before == load(work/'build01-gate/inputs-before.json')
memo_before = record(repo/'开发备忘录.md')
assert sha(originals/'comparison.json') == 'd9b5ac74167d56516f99303dd70cf68a775c50b7fd60d91d60b74e1d731dacd8'
comparison, proofs, provenance = [load(originals/n) for n in ['comparison.json','sale-phase-proofs.json','provenance.json']]
assert len(comparison['comparisons']) == 5
assert len(provenance['originalFiles']) == 951 and provenance['allOriginalEncodedSHAStable']
assert provenance['productImports'] == provenance['simulations'] == provenance['steps'] == 0
assert comparison['salePhaseProofCounts'] == {'total':172,'matched':172,'missing':0,'mismatch':0}
assert len(proofs)==172 and all(x['status']=='CAPTURED_PHASE_MATCH' for x in proofs)
narrow = next(x for x in comparison['runs'] if x['root'].endswith('/patched03'))
sales = narrow['actual279Sales']
assert [(x['eventClock'],x['event']['quantity'],x['event']['amount']) for x in sales] == [(5432,2,35.93322820152043),(5544,1,18.127046066437075)]
phase_proofs = [x for x in proofs if x['root'].endswith('/patched03') and x['id']=='citizen-279']
assert [(x['clock'],x['amount']) for x in phase_proofs] == [(5432,35.93322820152043),(5544,18.127046066437075)]
for s,p in zip(sales,phase_proofs):
    assert p['receipts']==[s] and p['walletResidual']==p['foodResidual']==p['hungerResidual']==0
    assert p['custodyRawSHA256']==s['sourceCustodySHA256']

def write(name,text):
    p=out/name;assert not p.exists(), 'Preserve any existing original: '+str(p)
    p.write_text(text,encoding='utf-8')

def save(name,obj): write(name,json.dumps(obj,ensure_ascii=False,indent=2)+'\n')

report=(old/'ROOT26-供粮访问阶段报告-DRAFT.md').read_text()
bad_report='279于5432真实west-b41售qty1/cost17.966614100760214，旧5480尚无sale；'
good_report='279在narrow03于5432真实west-b41售qty2/cost35.93322820152043，5544再售qty1/cost18.127046066437075；旧5480尚无sale。两次原commerce阶段聚合钱包/food/hunger残差均为0，真实BUS序号456/3430及custody SHA均分别绑定；'
assert report.count(bad_report)==1
report=report.replace(bad_report,good_report)
report=report.replace('（revision10 私稿）','（revision11 更正私稿）')
report=report.replace('异常有限数拒绝','非有限或无效算术拒绝')
report=report.replace('[保原宽稿](../revision-09-broad-rejected-narrow-pending/ROOT26-供粮访问阶段报告-DRAFT.md)','[保原宽证据](ROOT26-ACTUAL-EVIDENCE-SUMMARY.json)')
report=report.replace('(MATRIX-38-ROOT26-DRAFT.csv)','(REQUIREMENTS-38.csv)')
intro='本revision11更正文稿串源错误：revision10全部原件保留，不再作为最新交付稿。279窄方案两次成交改按[实际同钟原件比较](comparison.json)与[原阶段证明](sale-phase-proofs.json)记录；951原件的5个同clock比较、172/172阶段匹配，皆为纯I/O审原件，未新增Sim/import/step。这些是原阶段聚合前后身体/钱包/food证明，不虚构每单独立body capture。\n\n'
first_break=report.index('\n\n')+2
report=report[:first_break]+intro+report[first_break:]
write('REPORT.md',report)

memo=(old/'MEMO-APPEND-ROOT26-DRAFT.md').read_text()
bad_memo='2795432真实saleqty1/cost17.966614100760214，旧5480未售。'
good_memo='279在narrow03的5432真实saleqty2/cost35.93322820152043，5544真实saleqty1/cost18.127046066437075，旧5480未售；原commerce阶段聚合wallet/food/hunger残差各0。'
assert memo.count(bad_memo)==1
memo=memo.replace(bad_memo,good_memo)
memo=memo.replace('新私稿revision-10-narrow03-pre-egress（目录保原命名，文件真实明确最终source421）','最新私稿revision-11-corrected-narrow-sale-final；revision10全原件保留，其narrow279成交串用broad数量金额的文稿错误由实际comparison SHA d9b5ac74167d56516f99303dd70cf68a775c50b7fd60d91d60b74e1d731dacd8校正（不是源码或run修改）。计划同目录canonical REPORT.md/REQUIREMENTS-38.csv')
write('MEMO-APPEND-ROOT26-DRAFT.md',memo)

rows=list(csv.reader((old/'MATRIX-38-ROOT26-DRAFT.csv').open(encoding='utf-8-sig')))
baseline=repo/'docs/validation/2026-10-07-city-life-root24-25/REQUIREMENTS-38.csv'
base=list(csv.reader(baseline.open(encoding='utf-8-sig')))
assert len(rows)==len(base)==39 and rows[0][:47]==base[0] and [r[:47] for r in rows[1:]]==base[1:]
bad_matrix='279新5432真实saleqty1/cost17.966614100760214，旧5480无sale。'
good_matrix='279 narrow03的5432真实saleqty2/cost35.93322820152043，5544再saleqty1/cost18.127046066437075；原commerce阶段聚合钱包/food/hunger残差均0，旧5480无sale。'
changed=[]
for r in rows[1:]:
    for i in range(47,52):
        if bad_matrix in r[i]:
            before=r[i];r[i]=r[i].replace(bad_matrix,good_matrix)
            changed.append({'id':r[0],'columnIndex0':i,'column':rows[0][i],'before':before,'after':r[i]})
        assert '17.966614100760214' not in r[i], 'Broad value leaked to narrow new cell'
assert len(changed)==8 and {x['id'] for x in changed}=={'SYS-01','MAP-02','SHOP-01','FOOD-01','TRA-01','LIFE-01','PER-01','SAVE-01'}
assert rows[0][:47]==base[0] and [r[:47] for r in rows[1:]]==base[1:] and all(r[50].startswith('PARTIAL') for r in rows[1:])
def csv_text(data):
    s=io.StringIO(newline='');csv.writer(s,lineterminator='\n').writerows(data);return '\ufeff'+s.getvalue()
write('REQUIREMENTS-38.csv',csv_text(rows))
write('MATRIX-ROOT26-APPEND-ONLY.csv',csv_text([[rows[0][0]]+rows[0][47:]]+[[r[0]]+r[47:] for r in rows[1:]]))
for name in ['SOURCE-LINEAGE-ORIGINAL261-READONLY.json','PATCHED03-READONLY-CONTROL-SUMMARY.json','FINAL421-CLOSED-GATES-READONLY.json','MATRIX-PRESERVATION-ROOT26.json']:
    write(name,(old/name).read_text())
summary=load(old/'ROOT26-ACTUAL-EVIDENCE-SUMMARY.json')
summary['documentRevision11Correction']={'scope':'Text-only correction of narrow279; no source/runtime/result changes. Original broad values remain under rejectedBroadOriginalEvidence only.','actualNarrow03Sales':sales,'actualNarrow03CommercePhaseProofs':phase_proofs,'comparisonSHA256':sha(originals/'comparison.json'),'salePhaseProofsSHA256':sha(originals/'sale-phase-proofs.json'),'comparisonOriginalFiles':951,'sameClockComparisons':5,'matchedPhaseProofs':172,'noSingleEventBodyCaptureClaim':True}
save('ROOT26-ACTUAL-EVIDENCE-SUMMARY.json',summary)
for name in ['comparison.json','sale-phase-proofs.json','provenance.json']:write(name,(originals/name).read_text())

for filename in ['REPORT.md','MEMO-APPEND-ROOT26-DRAFT.md']:
    text=(out/filename).read_text()
    assert '35.93322820152043' in text and '18.127046066437075' in text
    assert '17.966614100760214' not in text
    assert 'qty1/cost35.93322820152043' not in text and 'qty2/cost18.127046066437075' not in text
links=re.findall(r'\]\(([^)]+)\)',report)
assert all((out/link).is_file() for link in links), 'Every report relative link must resolve in canonical delivery directory'
assert 'REQUIREMENTS-38.csv' in links and not any('revision-' in x or x.startswith('../') for x in links)
assert sha(repo/'开发备忘录.md')==memo_before['sha256']
assert {p:sha(repo/p) for p in source_before}==source_before
assert all(sha(Path(p))==h for p,h in prior_hashes.items())
receipt={'status':'CORRECTED_PRIVATE_REVISION11_STOPWRITE','at':datetime.now(timezone.utc).isoformat(),'reason':'Revision10 narrow279 description used broad5432 sale quantity/amount. Correct actual narrow03 quantities and prices; no simulation/source/result mutation.',
 'preservedRevision10OriginalFiles':{str(p):sha(p) for p in old.iterdir() if p.is_file()},'allPriorDraftFilesBeforeAfterExact':True,'allPriorDraftHashes':prior_hashes,
 'inputs':{n:record(originals/n) for n in ['comparison.json','sale-phase-proofs.json','provenance.json']},
 'actualNarrow03Sales':sales,'actualNarrow03PhaseProofs':phase_proofs,'phaseScope':'172 matched commerce phase aggregates, not invented individual per-event body captures; 0 missing/mismatch.',
 'comparisonOriginalFileCount':951,'sameClockComparisons':5,'changedPrimaryReportOccurrences':1,'changedMemoOccurrences':1,'changedMatrixNewCells':changed,
 'matrix':{'oldBaseline':record(baseline),'old47HeadersExact':True,'old1786CellsExact':True,'old38IDOrderExact':True,'rows':38,'columns':52,'all38PARTIAL':True,'newFiveColumnsAllScanned':True},
 'canonicalReportName':'REPORT.md','canonicalMatrixName':'REQUIREMENTS-38.csv','reportRelativeLinks':links,'allReportLinksResolveInSameDeliveryDirectory':True,
 'memoSharedBeforeAfterExact':memo_before,'sourceSelected421BeforeAfterExact':True,'sourceGraphSHA256':source_before,
 'SimImportsStepTestsBuildBrowserGPUSharedWrites':0,'LibraryPackPushClaimed':False,'furtherWrites':'STOPWRITE after final manifest/receipt creation.'}
save('CORRECTION-RECEIPT.json',receipt)
save('DELIVERY-SHA256.json',{'status':'PRIVATE_CORRECTED_REVISION11_STOPWRITE_NO_PACK_LIBRARY_PUSH_CLAIM','at':datetime.now(timezone.utc).isoformat(),'files':{p.name:record(p) for p in sorted(out.iterdir()) if p.is_file() and p.name!='DELIVERY-SHA256.json'},'old47Headers1786CellsExact':True,'all38PARTIAL':True,'sharedWrites':0,'runtimeCalls':0})
print(json.dumps({'status':'STOPWRITE','output':str(out),'reportSHA256':sha(out/'REPORT.md'),'memoSHA256':sha(out/'MEMO-APPEND-ROOT26-DRAFT.md'),'matrixSHA256':sha(out/'REQUIREMENTS-38.csv'),'correctionReceiptSHA256':sha(out/'CORRECTION-RECEIPT.json'),'deliveryManifestSHA256':sha(out/'DELIVERY-SHA256.json'),'correctedMatrixCells':8,'actualNarrowSales':[(x['eventClock'],x['event']['quantity'],x['event']['amount']) for x in sales],'allPriorFilesExact':True,'old1786CellsExact':True,'runtimeCalls':0},ensure_ascii=False))
