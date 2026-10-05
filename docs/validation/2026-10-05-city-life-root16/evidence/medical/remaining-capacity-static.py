"""Read completed artifacts; no imports, construction or steps of Simulation."""
import pathlib, json, hashlib, math, datetime

b = pathlib.Path(__file__).resolve().parent
load = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
save = b / 'actual01/artifacts/complete-one-patient.after24.save.json'
full = load(save); s = full['state']; rt = full['runtime']
world = load(b/'inherited-originals/origins/world.json')
buildings = {x['id']: x for x in world['buildings']}
citizens = {x['id']: x for x in s['citizens']}
profiles = s['extension']['actorProfiles']; now = s['extension']['lastUpdate']; day = math.floor(now/1440)
order = next(x for x in s['culture']['orders'] if x['id'] == 'service-2')
clinic = buildings[order['siteId']]
nodes = {x['id']: x for x in world['nodes']}
adj = {id: [] for id in nodes}
for edge in world['edges']:
    if edge['mode'] == 'road':
        adj[edge['from']].append(edge['to']); adj[edge['to']].append(edge['from'])
components = {}; component_count = 0
for node in nodes:
    if node in components: continue
    todo = [node]; components[node] = component_count
    while todo:
        at = todo.pop()
        for other in adj[at]:
            if other not in components: components[other] = component_count; todo.append(other)
    component_count += 1
component = lambda building: components[building+'-door']
local = [x for x in s['citizens'] if component(x['homeId']) == component(clinic['id'])]

def assignment(actor_id, shift_day):
    return next((a for shift in rt['publicLabor']['shifts'] if shift['day'] == shift_day
                 for a in shift['assignments'] if a['citizenId'] == actor_id and a['workId'] == citizens[actor_id]['workId']), None)

def person(actor):
    p = profiles[actor['id']]
    return {'id':actor['id'], 'role':actor['role'], 'homeId':actor['homeId'], 'workId':actor['workId'],
        'homeRoadComponent':component(actor['homeId']), 'state':actor['state'], 'position':actor['position'],
        'destinationId':actor['destinationId'], 'activity':rt['activities'].get(actor['id']),
        'decisionAt':rt['decisionAt'].get(actor['id']), 'money':actor['money'], 'carryFood':actor.get('food',0),
        'alive':p['alive'], 'age':p['age'], 'health':p['health'], 'hunger':actor['needs']['hunger'], 'fatigue':actor['needs']['fatigue']}

def natural(actor):
    p = profiles[actor['id']]
    return p['alive'] and p['age'] >= 6 and p['health'] < 65 and actor['needs']['hunger'] >= 35 and actor['needs']['fatigue'] >= 25 and actor['id'] not in order['servedIds']

def patient_needs(actor):
    p = profiles[actor['id']]
    return p['alive'] and p['age'] >= 6 and p['health'] < 95 and actor['needs']['hunger'] >= 40 and actor['needs']['fatigue'] >= 35 and s['clinical']['nextVisitAt'].get(actor['id'],0) <= now and actor['id'] not in order['servedIds']

low = []
for actor in s['citizens']:
    if profiles[actor['id']]['health'] >= 65: continue
    row = person(actor); row.update({'naturalHealthOfferNeeds':natural(actor),'actualPatientNeedsAndCooldown':patient_needs(actor),
        'currentAtClinic':False,'actualFutureClinicArrival':'NOT_OBSERVED',
        'pendingNeeds': [] if patient_needs(actor) else ['actual finite food/meal required before h40 care gate']})
    # These three are at the school or an exterior road; no clinic assertion is inferred from graph membership.
    assert actor['destinationId'] == 'civic-0-school' and abs(actor['position']['x']-clinic['position']['x']) > clinic['width']/2+2
    low.append(row)
doctors = []
next_open = (day+1)*1440+8*60
for actor in s['citizens']:
    if actor['workId'] != clinic['id'] or actor['role'] not in ['医生','doctor']: continue
    row = person(actor); today = assignment(actor['id'],day); tomorrow = assignment(actor['id'],day+1)
    row.update({'currentDayAssignment':today,'currentDayRemainingMinutes':max(0,today['minutesCap']-today['workedMinutes']) if today else 0,
        'nextDayAssignment':tomorrow,'currentDoctorBodyNeeds': profiles[actor['id']]['alive'] and profiles[actor['id']]['age'] >= 18 and profiles[actor['id']]['health'] >= 45 and actor['needs']['hunger'] >= 40 and actor['needs']['fatigue'] >= 35,
        'currentWorkingAtClinic':False,'currentCanonicalWageFrame':'NOT_PRESENT_IN_NATIVE_SAVE; never inferred from cumulative pay',
        'nextOpenHungerWithoutNewMealProjection':max(0,actor['needs']['hunger']-(next_open-now)*.05),
        'projectionScope':'Pure no-new-meal constant-decay calculation, not simulated forecast; future meals, labor, decisions and station arrival unobserved'})
    assert actor['state'] != 'working'
    doctors.append(row)

private_sites = {x['buildingId'] for x in s['shops']}
public_wages_due = sum(x['amount'] for x in rt.get('wageArrears',[])+rt['wages'] if x['shopId'] is None)
public_wages_earned = sum(x['amount'] for x in rt.get('wageAccruals',[]) if x['shopId'] is None)
districts = {x['id']:x for x in s['districts']}
forecast = sum(32*(.7+districts[x['districtId']]['prosperity']/100) for x in s['citizens'] if x['workId'] not in private_sites and x['role'] != '学生' and profiles[x['id']]['age'] >= 18 and profiles[x['id']]['alive'])
reserved = sum(max(0,a['minutesCap']-a['workedMinutes'])*a['ratePerMinute'] for shift in rt['publicLabor']['shifts'] if shift['day'] >= day for a in shift['assignments'])
reserved += sum(max(0,c['assignment']['minutesCap']-c['assignment']['workedMinutes'])*c['assignment']['ratePerMinute'] for c in rt['publicLabor'].get('employment',{}).get('contracts',[]) if c['day'] >= day)
essential = (rt['operatingCost']+1440*(.9+s['policeBudget']*1.8))/4*rt.get('operationUnitPrice',4)
protected = max(forecast,reserved) if day < rt['publicLabor']['standingUntilDay'] else reserved
reserve = public_wages_due+public_wages_earned+protected+essential
authorized = sum(x['cap']-x['spent'] for x in rt['publicBudgets'] if x['closedAt'] is None)
budget = {'source':'Literal reproduction of source/src/simulation.ts publicBudgetSnapshot/reservedPublicShifts + public-employment.ts publicTransferReserved; zeroSim',
    'cash':s['treasury'],'publicWagesDue':public_wages_due,'publicWagesEarned':public_wages_earned,'forecastPayroll':forecast,'reservedPayroll':reserved,
    'essentialOperations':essential,'reserve':reserve,'authorizedRemaining':authorized,'available':max(0,s['treasury']-reserve-authorized),
    'currentOpenBudgets':[x for x in rt['publicBudgets'] if x['closedAt'] is None],
    'meaning':'Cash can back the pending 14+13 caps at this snapshot; money alone creates neither current paid council source nor finite materials.'}

suppliers = []
for shop in s['shops']:
    if buildings[shop['buildingId']]['kind'] != 'workshop': continue
    actor_id = shop['ownerId']; company = next((x for x in s['extension']['companies'] if x['buildingId']==shop['buildingId'] and 'shopBindingReleasedAt' not in x),None)
    shift = rt['privateLabor']['shifts'].get(shop['id']); debt = sum(x['amount'] for x in rt.get('wageArrears',[])+rt.get('wageAccruals',[])+rt['wages'] if x['shopId']==shop['id'])
    committed = sum((a['minutesCap']-a['workedMinutes'])*a['ratePerMinute'] for a in shift['assignments']) if shift and shift['day']==day else 0
    lifecycle = s.get('shopLifecycle',{}).get('titles',{}).get(shop['id']); assert lifecycle is None
    suppliers.append({'shop':shop,'actualOperatingFunds':company['capital'] if company else shop.get('cash',0),'fundSource':'company.capital' if company else 'shop.cash',
        'earnedPayrollDebt':debt,'currentDayCommittedPayroll':committed,'lifecycleProtectedFunds':0,
        'owner':person(citizens[actor_id]),'currentPlanDay':shift['day'] if shift else None,
        'remainingAssignments':[{'citizenId':a['citizenId'],'remaining':max(0,a['minutesCap']-a['workedMinutes']),'hunger':citizens[a['citizenId']]['needs']['hunger'],'fatigue':citizens[a['citizenId']]['needs']['fatigue'],'carryFood':citizens[a['citizenId']].get('food',0)} for a in shift['assignments']] if shift else [],
        'nextDayPlan':'ABSENT; original owner onsite cash-backed review needed', 'currentFiniteMaterialQuoteUnits':0,
        'earnedShopLaborBankMinutes':rt['shopLabor'].get(shop['id'],0),'districtEnergy':districts[shop['districtId']]['energy']})

councils = []
for term in s['civicStaffing']['terms']:
    if term['districtId']!=clinic['districtId'] or term['endedAt'] is not None or not term['startsAt']<=now<term['endsAt']:continue
    actor=citizens[term['actorId']]; row=person(actor); row.update({'term':term,'currentDayAssignment':assignment(actor['id'],day),
        'nextDayAssignment':assignment(actor['id'],day+1),'currentSignatureEligibility':False,'currentBlockers':['hunger<40','not working at hall','no current same-frame canonical paid source']})
    assert actor['needs']['hunger'] < 40 and actor['state'] != 'working'
    councils.append(row)

held=order['receivedUnits']-order['consumedUnits']; missing=order['targetUnits']-order['receivedUnits']
result={'status':'READ_ONLY_REMAINING_FIVE_NOT_SERVED','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'simulationConstructionCount':0,'simulationStepCount':0,'input':{'savePath':str(save),'saveSHA256':sha(save),'worldPath':str(b/'inherited-originals/origins/world.json'),'worldSHA256':sha(b/'inherited-originals/origins/world.json'),'clock':now,'dayIndex':day,'hour':s['hour'],'tick':s['tick']},
    'worldScope':{'kind':'original customized civic world inherited byteexact from ROOT15','originalPath':'/workspace/yunshan-work/ROOT15-public-health-player-20261004-01/origins/world.json','buildings':len(world['buildings']),'nodes':len(world['nodes']),'edges':len(world['edges']),'npcCount':len(s['citizens']),'roadComponents':component_count,'clinicComponent':component(clinic['id']),'localHomeComponentNpcCount':len(local)},
    'healthOrder':{'id':order['id'],'state':order['state'],'targetUnits':order['targetUnits'],'servedIds':order['servedIds'],'notServedCapacity':order['targetUnits']-len(order['servedIds']),'requiredMinutes':order['requiredMinutes'],'spent':order['spent'],'received':order['receivedUnits'],'consumed':order['consumedUnits'],'held':held,'missingForAllFive':missing,'currentlyWholeAdditionalPatientsMaterialAllows':math.floor(held+1e-7)},
    'gates':{'naturalOffer':'chooseFacility health<65, alive age>=6; hunger>=35/fatigue>=25, unserved active service, finite walkingTree; score competes with work, education, food, rest. Passing is only an offer, not actual choice/arrival.',
        'actualPatient':'readersAt alive age>=6, real public supported/use point and no current civic reservation, hunger>=40/fatigue>=35, health<95/cooldown, not concurrent doctor. Actual doctor/patient same supported public service point plus current funded clinical minutes.',
        'serviceTime':'[08:00,17:00); terminal18:40 is closed; actual future patient+doctor overlapping20minutes required.',
        'V2Approval':'two active local council terms, actual same hall supported work point, hunger>=40/fatigue>=35/adult/alive/health>=45 and positive same-frame canonical core wage windows; current money or yesterday paid source is insufficient.'},
    'patientCounts':{'globalHealthBelow65':len(low),'localHealthBelow65':sum(x['homeRoadComponent']==component(clinic['id']) for x in low),'localNaturalOfferNeedsEligible':sum(natural(x) for x in local),'localBelow65ActualNeedsEligible':sum(patient_needs(x) and profiles[x['id']]['health']<65 for x in local),'localBelow95ActualNeedsEligibleBeforePresenceAndStaffExclusion':sum(patient_needs(x) for x in local),'localNeeds35Fatigue25':sum(x['needs']['hunger']>=35 and x['needs']['fatigue']>=25 for x in local)},
    'allHealthBelow65Npc':low,'doctors':doctors,'nextClinicOpenClock':next_open,'publicBudgetSnapshot':budget,'currentLocalCouncil':councils,
    'pendingSupplementalRequests':[x for x in s['culture']['supplementalBudgets']['requests'] if x['approvedAt'] is None and x['closedAt'] is None],
    'finiteMaterialSuppliers':suppliers,'localFoodShops':[x for x in s['shops'] if component(x['buildingId'])==component(clinic['id']) and buildings[x['buildingId']]['kind']!='workshop'],
    'currentLocalNpcCarryFood':sum(x.get('food',0) for x in local),'currentLocalNpcCarryFoodHolders':[{'id':x['id'],'food':x.get('food',0),'hunger':x['needs']['hunger']} for x in local if x.get('food',0)>0],
    'currentPlayerCarryFood':s['player']['inventory'].get('food',0),
    'educationCompetingOriginalOrder':{k:next(x for x in s['culture']['orders'] if x['id']=='service-3').get(k) for k in ['id','state','targetUnits','servedIds','serviceMinutes','staffIds','requiredMinutes','receivedUnits']},
    'hygieneOutstanding':s['hygiene']['publicDemands'],'nextActualMissingEvidence':['True finite food and lawful contact/eat for doctors, two local council members and workshop/farm owner; original13gift intervention does not certify tomorrow supply.','Actual current-day onsite private payroll approval and finite material production; workshopstock0 and local food .293 units are presently insufficient.','True current same-frame paid V2 council approval cap14, then at least1.578135204313753 additional finite materials without changing originalcap40/target6.','Actual eligible NPC future decision, legal route and clinic service station arrival; only citizen0 passes both low-health/needs today, not five observed patients.','Nextday actual funded doctor arrival and patient overlap20min each; signed future480 alone is not attendance or food.','Outstanding contaminated batch requires separate actual20cash/one whole cleaning material/10doctor minutes to sanitize; no completed sanitation here.'],
    'conclusion':'One player closed. Do not claim zero local low-health eligible candidates: citizen0 exists. Do not claim five patients or six fulfilled. No future Simulation, patient fabrication, source patch, fixture edit, additional budget or resources performed.'}
assert len(low)==3 and result['patientCounts']['localBelow65ActualNeedsEligible']==1
(b/'REMAINING-CAPACITY-STATIC.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':result['status'],'patientCounts':result['patientCounts'],'budgetAvailable':budget['available'],'held':held,'missing':missing,'localCarry':result['currentLocalNpcCarryFood'],'doctors':[{'id':x['id'],'h':x['hunger'],'dayRemaining':x['currentDayRemainingMinutes']} for x in doctors]},ensure_ascii=False))
