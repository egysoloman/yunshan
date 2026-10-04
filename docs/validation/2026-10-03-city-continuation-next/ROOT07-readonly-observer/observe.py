"""Read one existing ROOT07 audit; never start a Simulation or edit its inputs."""
from pathlib import Path
import datetime, hashlib, json, time, sys

AUDIT_ROOT = Path('/workspace/yunshan-work/ROOT07-city-continuation-20261004-01')
SOURCE = AUDIT_ROOT / 'source'
RUN = AUDIT_ROOT / 'economy14d01'
OUT = Path('/workspace/yunshan-work/root07-economy-readonly-observer-20261004-01')
ARTIFACT = SOURCE / 'artifacts/root07-economy-14d.json'
SAVE = SOURCE / 'artifacts/root07-economy-14d-final.save.json'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def stamp(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def write(name, obj):
    target=OUT/name; temporary=OUT/(name+'.partial')
    temporary.write_text(json.dumps(obj, ensure_ascii=False, indent=2)+'\n'); temporary.replace(target)
def rows():
    text=(RUN/'raw.log').read_text(errors='replace'); parsed=[]
    for line in text.splitlines():
        try:
            x=json.loads(line)
            if isinstance(x,dict): parsed.append(x)
        except json.JSONDecodeError: pass
    return text,parsed
FIRST=json.loads((RUN/'inputs-before.json').read_text())
SOURCE_START={n:sha(SOURCE/n) for n in FIRST}
assert SOURCE_START==FIRST, 'ROOT07 inputs changed before this observer attached'
write('binding.json', {'attachedAt':stamp(),'runtimeScope':'Read-only Python polling of one existing audit; no Simulation, command, step or source edit.', 'auditRoot':str(AUDIT_ROOT),'rootOwnedProcess':json.loads((RUN/'owned-process.json').read_text()), 'inputCount':len(FIRST),'rootFirstInputSHA256':sha(RUN/'inputs-before.json'),'verifiedAttachedInputs':SOURCE_START,'observerScriptSHA256':sha(Path(__file__))})


def terminal(audit):
    payload=json.loads(SAVE.read_text()); s=payload['state']; r=payload['runtime']; e=s['extension']; companies=e['companies']
    active={c['buildingId'] for c in companies if c.get('shopBindingReleasedAt') is None}
    total=lambda seq,key:sum(x.get(key,0) for x in seq)
    lifecycle=s.get('shopLifecycle') or {}; titles=lifecycle.get('titles',{})
    component={
        'treasury':s['treasury'],'queuedTaxes':r['taxes'],'playerWallet':s['player']['money'],
        'residentWallets':total(s['citizens'],'money'),
        'noncorporateOrReturnedShopCash':sum(x.get('cash',0) for x in s['shops'] if x['buildingId'] not in active),
        'allCompanyCapitalIncludingDetached':total(companies,'capital'),'organizationsFunds':total(e['organizations'],'funds'),
        'bankCash':(s.get('banking') or {}).get('cash',0),'legacyInvestmentCash':(s.get('banking') or {}).get('legacyInvestmentCash',0),
        'playerLaborEscrow':((s.get('playerLabor') or {}).get('job') or {}).get('escrow',0),
        'roadworksEscrow':total((s.get('roadworks') or {}).get('jobs',[]),'escrow'),
        'educationEscrow':((s.get('education') or {}).get('course') or {}).get('escrow',0),
        'familyEducationActiveEscrow':total((s.get('familyEducation') or {}).get('active',[]),'escrow'),
        'powerEscrow':total((s.get('power') or {}).get('repairs',[]),'escrow'),
        'clinicalEscrow':total((s.get('clinical') or {}).get('orders',[]),'escrow'),
        'hygieneEscrow':total((s.get('hygiene') or {}).get('jobs',[]),'escrow'),
        'shopLeaseDepositEscrow':total(lifecycle.get('leases',[]),'depositEscrow'),
        'currentLessorCashEscrow':sum((t.get('corporation') or {}).get('ownerCashEscrow',0) for t in titles.values()),
        'familyPregnancyEscrow':total((s.get('family') or {}).get('pregnancies',[]),'escrow'),
        'familyCommonCash':total((s.get('family') or {}).get('households',[]),'balance'),
    }
    day=int(e['lastUpdate']//1440)
    shops=[]
    for shop in s['shops']:
        corporate=next((c for c in companies if c['buildingId']==shop['buildingId'] and c.get('shopBindingReleasedAt') is None),None)
        debt=sum(x['amount'] for key in ('wages','wageArrears','wageAccruals') for x in r.get(key,[]) if x.get('shopId')==shop['id'])
        shift=(r.get('privateLabor') or {}).get('shifts',{}).get(shop['id'],{})
        committed=sum((x['minutesCap']-x['workedMinutes'])*x['ratePerMinute'] for x in shift.get('assignments',[])) if shift.get('day')==day else 0
        leases=[x for x in lifecycle.get('leases',[]) if x['shopId']==shop['id']]
        rentReserve=sum(x['arrears']+(x['rent'] if x['state']!='ended' and x['nextDueAt']<x['endsAt'] else 0)+(max(0,x['advanceInitial']-x['advanceRefunded']) if x['state']=='ended' else 0) for x in leases)
        funds=corporate['capital'] if corporate else shop.get('cash',0)
        shops.append({'id':shop['id'],'buildingId':shop['buildingId'],'ownerId':shop.get('ownerId'),'actualEmployerId':corporate['ownerId'] if corporate else shop.get('ownerId'),'activeCompanyId':corporate['id'] if corporate else None,'inventory':shop['inventory'],'employees':shop['employees'],'open':shop['open'],'price':shop['price'],'funds':funds,'earnedWageClaims':debt,'signedCurrentRemainingWages':committed,'rentAndAdvanceReserve':rentReserve,'protectedFunds':debt+committed+rentReserve,'unreservedFunds':funds-debt-committed-rentReserve})
    jobs=[]
    for j in (s.get('roadworks') or {}).get('jobs',[]):
        crew=j.get('replacement')
        jobs.append({'id':j['id'],'payerId':j['payerId'],'status':j['status'],'workedMinutes':j['workedMinutes'],'funded':j['funded'],'purchasePaid':j['purchasePaid'],'paidGross':j['paidGross'],'refunded':j['refunded'],'escrow':j['escrow'],'fundingIdentityResidual':j['funded']-j['purchasePaid']-j['paidGross']-j['refunded']-j['escrow'],'replacementVersion':crew.get('version') if crew else None,'crewContractCount':len(crew.get('contracts',[])) if crew else 0,'activeActorId':crew.get('activeActorId') if crew else j['workerId'],'materialPickups':len(crew.get('pickups',[])) if crew else 0})
    familyCourses=(s.get('familyEducation') or {}).get('active',[])+[c for p in (s.get('familyEducation') or {}).get('pages',[]) for c in p]
    latest=audit['snapshots'][-1]
    report={'observedAt':stamp(),'status':'TERMINAL','auditStatus':audit['auditStatus'],'overallStatus':audit['status'],'originalFailure':audit.get('failure'),'rootReceipt':json.loads((RUN/'receipt.json').read_text()),'rootRawSHA256':sha(RUN/'raw.log'),'artifactSHA256':sha(ARTIFACT),'finalSaveSHA256':sha(SAVE),'finalSaveBytes':SAVE.stat().st_size,'ticks':audit['ticks'],'elapsedGameMinutes':audit['elapsedGameMinutes'],'sourceHashMatchesEnd':audit['sourceHash']==audit['endSourceHash'],'latest':latest,'deaths':audit['deaths'],'auditCashResidual':audit['moneyConservationResidual'],'treasuryReconciliationResidual':audit['reconciliationResidual'],'cashComponents':component,'independentPhysicalCash':sum(component.values()),'independentMinusAuditedCash':sum(component.values())-audit['finalMoneySupply'],'physicalSupplyChange':sum(component.values())-audit['initialMoneySupply'],'shops':shops,'detachedCompanies':[c for c in companies if c.get('shopBindingReleasedAt') is not None],'marketRights':lifecycle,'familyEducationFundingIdentityResiduals':[{'id':c['id'],'payerId':c['payerId'],'status':c['status'],'residual':c['funded']-c['purchasePaid']-c['serviceFees']-c['refunded']-c['escrow']} for c in familyCourses],'roadworksFundingAndCrew':jobs,'saveValidation':audit['saveValidation'],'limitations':['No new Simulation or trusted world generation was run. Financial decomposition reads the actual terminal save.','Audit deaths.foodDistance includes industrial shops because the original observer does not filter commodity; do not interpret it as actual edible-food route distance.','Progress lines expose tick/alive/treasury. Detailed wallets, budgets, contracts and food exist only in daily samples/full terminal snapshots.','Aggregate company and employee counts include retained histories/rosters; no assertion of steady state or actual staffed coverage follows.']}
    write('terminal-report.json',report)
    write('observed-inputs-end.json',{n:sha(SOURCE/n) for n in FIRST})
    assert json.loads((OUT/'observed-inputs-end.json').read_text())==FIRST,'ROOT07 frozen inputs changed'
    return report

seen=set();deadline=time.monotonic()+7000
while True:
    text,data=rows(); new=[]
    for row in data:
        if 'tick' not in row: continue
        key=(row.get('kind','daily-sample'),row['tick'])
        if key not in seen:
            seen.add(key);new.append(row)
            with (OUT/'observations.jsonl').open('a') as f:f.write(json.dumps({'observedAt':stamp(),'rawRecord':row},ensure_ascii=False)+'\n')
    progress=[x for x in data if x.get('kind')=='progress'];samples=[x for x in data if 'npc' in x]
    status={'observedAt':stamp(),'status':'RUNNING','receiptPresent':(RUN/'receipt.json').exists(),'artifactPresent':ARTIFACT.exists(),'latestProgress':progress[-1] if progress else None,'latestDailySample':samples[-1] if samples else None,'rawPrefixBytes':len(text.encode()),'rawPrefixSHA256':hashlib.sha256(text.encode()).hexdigest(),'auditOwnedProcess':json.loads((RUN/'owned-process.json').read_text())}
    write('status.json',status)
    if new: print(json.dumps({'status':'RUNNING','latest':new[-1]},ensure_ascii=False),flush=True)
    if (RUN/'receipt.json').exists():
        if ARTIFACT.exists() and SAVE.exists():
            result=terminal(json.loads(ARTIFACT.read_text()));print(json.dumps({'status':'TERMINAL','auditStatus':result['auditStatus'],'overallStatus':result['overallStatus'],'ticks':result['ticks'],'cashResidual':result['auditCashResidual'],'independentCashResidual':result['independentMinusAuditedCash'],'deaths':len(result['deaths']),'report':str(OUT/'terminal-report.json')}),flush=True)
        else:
            write('terminal-report.json',{'status':'TERMINATED_WITHOUT_ARTIFACT','observedAt':stamp(),'rootReceipt':json.loads((RUN/'receipt.json').read_text()),'latestProgress':status['latestProgress'],'rootRawSHA256':sha(RUN/'raw.log'),'artifactPresent':ARTIFACT.exists(),'savePresent':SAVE.exists()})
        break
    if time.monotonic()>deadline:
        write('observer-ended.json',{'status':'OBSERVER_DEADLINE','observedAt':stamp(),'auditRemains':status});break
    time.sleep(20)
