#!/usr/bin/env python3
"""Aggregate existing detached full-save and original bus records; no application imports."""
from pathlib import Path
import collections, gzip, hashlib, json, math, statistics

OUT=Path(__file__).parent
ROOT=Path('/tmp/ROOT24-economy-next-day-20261007-01')
WORLD=Path('/workspace/yunshan-work/ROOT23-ledger-scaling-20261007-01/native-plan/static-inputs/WORLD291.original.json')
def sha(raw):return hashlib.sha256(raw).hexdigest()
def read(path):
    encoded=path.read_bytes(); raw=gzip.decompress(encoded) if path.suffix=='.gz' else encoded
    return json.loads(raw), {'path':str(path),'encodedBytes':len(encoded),'encodedSHA256':sha(encoded),'decodedBytes':len(raw),'decodedSHA256':sha(raw)}
world,world_source=read(WORLD); sites={s['id']:s for s in world['buildings']}
initial,initial_source=read(ROOT/'native03/frames/0001-imported-main/whole-save.json.gz')
checkpoint,checkpoint_source=read(ROOT/'native04/frames/0001-imported-main/whole-save.json.gz')
final,final_source=read(ROOT/'native04/frames/0017-ordinary-016/whole-save.json.gz')
def dist(a,b):return math.sqrt(sum((a[k]-b[k])**2 for k in ['x','y','z']))
def descr(values):
    v=sorted(values)
    return {'count':len(v),'min':v[0],'median':statistics.median(v),'mean':statistics.fmean(v),'max':v[-1]} if v else {'count':0}
def counts(values):return dict(collections.Counter(str(v) if v is not None else 'null' for v in values))
def route_distance(save,c):
    point=c['position']; total=0; encoded=c.get('route',[]); pool=save['routePool']
    for index in encoded[c.get('routeIndex',0):]:
        next_point=pool[index];total+=dist(point,next_point);point=next_point
    return total
def snapshot(save):
    s,r=save['state'],save['runtime']; companies=s['extension']['companies']; shops={shop['buildingId']:shop for shop in s['shops']}
    food=[shop for shop in s['shops'] if sites[shop['buildingId']]['kind'] in ['farm','dock','market']]
    available=[shop for shop in food if shop['open'] and shop['inventory']>=1]
    cohort=[c for c in s['citizens'] if s['extension']['actorProfiles'][c['id']].get('alive') is not False and c['needs']['hunger']<30]
    rows=[]
    for c in cohort:
        profile=s['extension']['actorProfiles'][c['id']]; target=sites.get(c['destinationId']); shop=shops.get(c['destinationId'])
        company=next((co for co in companies if co['buildingId']==c['destinationId'] and 'shopBindingReleasedAt' not in co),None)
        offers=[shop for shop in available if c['money']>=shop['price']]
        nearest=min(offers,key=lambda offer:dist(c['position'],sites[offer['buildingId']]['door'])) if offers else None
        owner=(company or shop or {}).get('ownerId'); owner_actor=next((p for p in s['citizens'] if p['id']==owner),None)
        row={'id':c['id'],'name':c['name'],'role':c['role'],'workId':c['workId'],'workKind':sites[c['workId']]['kind'],
            'homeId':c['homeId'],'homeDistrict':c['districtId'],'state':c['state'],'activity':r['activities'].get(c['id']),
            'money':c['money'],'food':c.get('food',0),'needs':c['needs'],'position':c['position'],'tier':c['tier'],
            'age':profile['age'],'health':profile['health'],'destinationId':c['destinationId'],'destinationKind':target['kind'] if target else None,
            'destinationDoor':target['door'] if target else None,'straight3DMetresToDestinationDoor':dist(c['position'],target['door']) if target else None,
            'routeIndex':c['routeIndex'],'routePointCount':len(c['route']),'remainingSavedRoutePolylineMetres':route_distance(save,c),
            'pendingPeopleMinutes':r.get('peopleElapsed',{}).get(c['id'],0),'decisionAt':r['decisionAt'].get(c['id']),
            'rider':r['riders'].get(c['id']),'dispatch':r['dispatches'].get(c['id']),
            'destinationShop':{'id':shop['id'],'kind':target['kind'],'open':shop['open'],'inventory':shop['inventory'],'price':shop['price'],
                'canAffordListedPrice':c['money']>=shop['price'],'ownerId':owner,'ownerPresentInSavedCitizens':owner_actor is not None,
                'ownerRole':owner_actor['role'] if owner_actor else None,'operatingFunds':company['capital'] if company else shop.get('cash',0),
                'companyId':company['id'] if company else None,'employees':shop['employees'],'profit':shop['profit']} if shop else None,
            'affordableStockedOpenFoodOfferCount':len(offers),
            'nearestAffordableFoodByStraight3D':{'shopId':nearest['id'],'buildingId':nearest['buildingId'],'kind':sites[nearest['buildingId']]['kind'],
                'straight3DMetres':dist(c['position'],sites[nearest['buildingId']]['door']),'door':sites[nearest['buildingId']]['door'],
                'price':nearest['price'],'inventory':nearest['inventory'],'open':nearest['open'],
                'isDeclaredDestination':nearest['buildingId']==c['destinationId']} if nearest else None}
        rows.append(row)
    targets=[row['destinationShop'] for row in rows if row['destinationShop']]
    nearest_distances=[row['nearestAffordableFoodByStraight3D']['straight3DMetres'] for row in rows if row['nearestAffordableFoodByStraight3D']]
    return {'clock':s['day']*1440+s['hour']*60,'tick':s['tick'],'count':len(rows),'ids':[row['id'] for row in rows],
        'roles':counts(row['role'] for row in rows),'workKinds':counts(row['workKind'] for row in rows),'states':counts(row['state'] for row in rows),
        'activities':counts(row['activity'] for row in rows),'tiers':counts(row['tier'] for row in rows),'homeDistricts':counts(row['homeDistrict'] for row in rows),
        'destinationKinds':counts(row['destinationKind'] for row in rows),'money':descr([row['money'] for row in rows]),
        'hunger':descr([row['needs']['hunger'] for row in rows]),'hungerExactly0':sum(row['needs']['hunger']==0 for row in rows),
        'foodCarry':counts(row['food'] for row in rows),'riders':sum(row['rider'] is not None for row in rows),'dispatches':sum(row['dispatch'] is not None for row in rows),
        'remainingSavedRoutePolylineMetres':descr([row['remainingSavedRoutePolylineMetres'] for row in rows]),
        'destinationDoorStraightMetres':descr([row['straight3DMetresToDestinationDoor'] for row in rows if row['straight3DMetresToDestinationDoor'] is not None]),
        'nearestAffordableFoodStraightMetres':descr(nearest_distances),'nearestAffordableFoodWithin100mStraight':sum(v<=100 for v in nearest_distances),
        'nearestAffordableFoodWithin300mStraight':sum(v<=300 for v in nearest_distances),
        'nearestAffordableFoodDifferentFromCurrentDestination':sum(not row['nearestAffordableFoodByStraight3D']['isDeclaredDestination'] for row in rows if row['nearestAffordableFoodByStraight3D']),
        'savedTargets':{'shopTargets':len(targets),'openTargets':sum(target['open'] for target in targets),'stockedTargets':sum(target['inventory']>=1 for target in targets),
            'affordableTargets':sum(target['canAffordListedPrice'] for target in targets),'inventory':descr([target['inventory'] for target in targets]),
            'price':descr([target['price'] for target in targets]),'funds':descr([target['operatingFunds'] for target in targets]),
            'ownerRoles':counts(target['ownerRole'] for target in targets),'uniqueTargetShops':len({target['id'] for target in targets})},
        'rows':rows}
snapshots={label:snapshot(save) for label,save in [('initial3900',initial),('checkpoint5276',checkpoint),('terminal5340',final)]}
ids_initial=set(snapshots['initial3900']['ids']);ids_final=set(snapshots['terminal5340']['ids']);ids_checkpoint=set(snapshots['checkpoint5276']['ids'])
sources=[];all_meals=[];all_customers=[];all_cohort_events=[]
for frame in sorted((ROOT/'native04/frames').glob('*-ordinary-*')):
    p=frame/'all-bus.json.gz';bus,source=read(p);sources.append(source)
    for record in bus['events']:
        event=record['event']; selected={k:record[k] for k in ['sequence','phase','tick','clock','extensionClock']}
        selected['event']=event
        if event['type'] in ['sale','stored-meal']:all_meals.append(selected)
        if event['type']=='customer' and event.get('citizenId') in ids_final:all_customers.append(selected)
        if event.get('citizenId') in ids_final and event['type'] in ['sale','stored-meal','customer','transit-fare','commute']:all_cohort_events.append(selected)
phase_path=ROOT/'native04/frames/0017-ordinary-016/stable-phase-custody.json.gz';phases,phase_source=read(phase_path)
shopping_ids={row['id'] for row in snapshots['terminal5340']['rows'] if row['state']=='shopping'}
phase_examples=[]
for phase in phases['phases']:
    selected={'phase':phase['phase'],'tick':phase['tick'],'clock':phase['clock'],'completeOriginalPhaseReturned':phase['completeOriginalPhaseReturned']}
    for side in ['before','after']:
        observation=phase.get(side)
        selected[side]=None if observation is None else {'at':observation.get('at'),
            'shoppingLowHungryCitizens':[c for c in observation.get('citizens',[]) if c['id'] in shopping_ids],
            'targetShops':[shop for shop in observation.get('shops',[]) if shop['buildingId'] in {row['destinationId'] for row in snapshots['terminal5340']['rows'] if row['id'] in shopping_ids}]}
    phase_examples.append(selected)
result={'status':'READ_ONLY_ORIGINAL_HUNGER_COHORT_DIAGNOSIS','simulationConstructions':0,'ordinarySteps':0,
    'sources':{'world':world_source,'initialFullSave':initial_source,'checkpointFullSave':checkpoint_source,'terminalFullSave':final_source,
        'suffix16EntireBusOriginals':sources,'terminal10StablePhases':phase_source},
    'mealRoutePolicy':{'initialEnvelope':initial.get('mealRoutePolicyId'),'initialRuntime':initial['runtime'].get('mealRoutePolicyId'),
        'terminalEnvelope':final.get('mealRoutePolicyId'),'terminalRuntime':final['runtime'].get('mealRoutePolicyId')},
    'comparison':{'initialLow14StillLowAtTerminal':sorted(ids_initial&ids_final),'initialLow14RecoveredAtTerminal':sorted(ids_initial-ids_final),
        'newLowAtTerminal':sorted(ids_final-ids_initial),'checkpointLow134StillLowAtTerminal':len(ids_checkpoint&ids_final),
        'checkpointLow134RecoveredAtTerminal':len(ids_checkpoint-ids_final),'newLowAfterCheckpoint':len(ids_final-ids_checkpoint)},
    'snapshots':snapshots,
    'suffixEvents':{'mealEventCountAllResidents':len(all_meals),'eventCountsAllResidents':counts(row['event']['type'] for row in all_meals),
        'terminal115LowCohortMealEvents':[row for row in all_meals if row['event'].get('citizenId') in ids_final],
        'terminal115LowCohortCustomerEvents':all_customers,'terminal115LowCohortMealTransitCommuteEvents':all_cohort_events},
    'terminalShoppingLow2TenPhaseExamples':phase_examples,
    'interpretation':{'hungerDirection':'Higher saved needs.hunger means fuller; low category <30, not a clinical diagnosis.',
        'routeDistance':'Remaining original decoded routePool polyline length at endpoint; no rerouting, network shortest-path, floor permission or future movement success inferred.',
        'nearestShop':'Original straight 3D distance to existing stocked open affordable food shop door; not a legal route, service point arrival, or production chooser travel cost.',
        'ownerFunds':'Actual saved company.capital replaces bound shop.cash; open/inventory/price/owner/employees are fields, not replayed operational predicates.',
        'causeBoundary':'Observed tasks/positions and original meal events establish current travel/arrival evidence. Code guards describe required conditions but unobserved function-point/route/quote decisions remain unproven.',
        'employment':'Role/workId/target owner are observed identities only; no isEmployed reconstruction or claim every role is currently paid/employed.'}}
path=OUT/'LOW-HUNGER-115-ORIGINAL-ANALYSIS.json';path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
summary={k:v for k,v in result['snapshots']['terminal5340'].items() if k not in ['rows','ids']}
print(json.dumps({'path':str(path),'bytes':path.stat().st_size,'sha256':sha(path.read_bytes()),'comparison':{k:v for k,v in result['comparison'].items() if isinstance(v,int) or k.startswith('initialLow')},'terminal':summary,'suffix':{k:v for k,v in result['suffixEvents'].items() if k not in ['terminal115LowCohortCustomerEvents','terminal115LowCohortMealTransitCommuteEvents']}},ensure_ascii=False,indent=2))
