import csv, hashlib, json, math, pathlib, collections

root = pathlib.Path('/workspace/yunshan-work/ROOT14-default-food-route-audit-20261004-01')
read = lambda name: json.loads((root/name).read_bytes())
original = read('TERMINAL-ORIGINAL.save.json')
result = read('RESIDENTS-240.json')
world = read('WORLD-ORIGINAL.json')
audit = read('DAY-AUDIT-ORIGINAL.json')
rows = result['rows']; actor_map = {a['id']:a for a in original['state']['citizens']}
sites = {s['id']:s for s in world['buildings']}
dist = lambda a,b: math.sqrt(sum((a[k]-b[k])**2 for k in ['x','y','z']))
key = lambda a: tuple(a[k] for k in ['x','y','z'])
def q(n): return math.floor(n*5+.5)/5
def decode(a): return [original['routePool'][p] for p in a.get('route',[])]

# Exact source arithmetic for the original front entrance lintel, not a new
# imported geometry, route query or live collision test. The original TS query
# separately established actual full-reference body guard=false for 14 actors.
# Every affected site has rotation0, v4-program-bodies-02 and a centre entrance
# at the front spine's z=depth/2. The wall has thickness .4; its opening is
# q(min(2.8,q(floorHeight-.4))). XZ contact interval includes unchanged radius .35.
def lintel_witness(site, a, b):
    if site.get('rotation') != 0 or site.get('floorPlanProfile') != 'v4-program-bodies-02': return None
    door = site['door']; dy = max(a['y'],b['y'])-door['y']
    height = q(site['height']/site['floors']-.4); opening = q(min(2.8,height))
    if height<=opening or a['x']!=door['x'] or b['x']!=door['x']: return None
    dz = b['z']-a['z']
    if not dz:return None
    # 0.2-grid wall panels around the front edge, plus the real .35 disk.
    zc = site['position']['z']; front_local = q(site['depth']*.5)
    zlo = zc+q(front_local-.2)-.35; zhi = zc+q(front_local+.2)+.35
    ts = sorted([(zlo-a['z'])/dz,(zhi-a['z'])/dz]); lo=max(0,ts[0]);hi=min(1,ts[1])
    if lo>hi:return None
    interval_y = [a['y']+(b['y']-a['y'])*t-door['y'] for t in [lo,hi]]
    high_at_lintel=max(interval_y)+1.72
    whole_leg_high=dy+1.72
    # These mirror the original solid's global-height filter and its XZ test.
    original_lintel_height_filter = height>dy+.01 and opening<whole_leg_high
    half_spine=q(site['width']*.08)
    half_opening=q(min(2.4,(half_spine*2-.8)/2))
    local_box={'x0':-half_opening,'x1':half_opening,'z0':q(front_local-.2),'z1':q(front_local+.2),'bottom':opening,'top':height}
    world_box={'x0':site['position']['x']-half_opening,'x1':site['position']['x']+half_opening,
               'z0':zc+local_box['z0'],'z1':zc+local_box['z1'],'bottom':door['y']+opening,'top':door['y']+height}
    return {'siteId':site['id'],'siteKind':site['kind'],'source':'architecture-floor-plan.ts:174–178,267–277,432–446',
            'from':a,'to':b,'door':door,'unchangedBodyRadius':.35,'unchangedBodyHeight':1.72,
            'entranceWallThickness':.4,'lintelBottomAboveDoor':opening,'lintelTopAboveDoor':height,
            'originalGeneratedFloor':0,'originalFloorY':0,'sourceReconstructedLocalHeaderBox':local_box,
            'sourceReconstructedWorldHeaderBox':world_box,'headerBoxEvidence':'Derived exactly from original makeBody front spine/entrance and wallPanels source, original World dimensions/rotation0. This is source-reconstructed geometry, not an exported live Box dump.',
            'bodyXZLintelContactInterval':[lo,hi],'maxActualHeadAboveDoorWithinLintelXZContact':high_at_lintel,
            'bodyFootHeightAboveDoorDuringXZContact':interval_y,'minimumDoorHeadClearanceDuringXZContact':opening-high_at_lintel,
            'wholeLegMaxFootAboveDoor':dy,'sourceGuardWholeLegHeadAboveDoor':whole_leg_high,
            'sourceGuardLintelHeightFilter':original_lintel_height_filter,
            'interpolatedBodyActuallyHitsThisLintel':high_at_lintel>=opening,
            'classification':'SOURCE_ARITHMETIC_FALSE_POSITIVE_LINTEL' if original_lintel_height_filter and high_at_lintel<opening else 'NO_FALSE_POSITIVE_LINTEL_PROOF',
            'scope':'Original TS query proves only whole-reference guard false. This arithmetic isolates a sufficient entrance-header false positive for the same straight segment; it does not certify all other obstacles, an actual movement attempt, a new fix or purchase.'}

edge_end_pairs = {}
for edge in world['edges']:
    if edge['mode'] not in ['road','bridge'] or len(edge['points'])<2:continue
    for node, pair in [(edge['from'],edge['points'][:2]),(edge['to'],edge['points'][-2:])]:
        if not node.endswith('-door') or node[:-5] not in sites:continue
        site=sites[node[:-5]]
        for a,b in [pair,pair[::-1]]:
            w=lintel_witness(site,a,b)
            if w and w['classification']=='SOURCE_ARITHMETIC_FALSE_POSITIVE_LINTEL':
                edge_end_pairs.setdefault((key(a),key(b)),[]).append({**w,'edgeId':edge['id']})

bad = []; exported=[]; future_rows=[]
for row in rows:
    actor=actor_map[row['id']]; route=decode(actor); index=actor.get('routeIndex',0)
    point=row['position'];remaining=0
    for nxt in route[index:]:remaining+=dist(point,nxt);point=nxt
    pending=[]
    for i in range(max(1,index),len(route)):
        for candidate in edge_end_pairs.get((key(route[i-1]),key(route[i])),[]):
            pending.append({'routeIndex':i,'siteId':candidate['siteId'],'edgeId':candidate['edgeId'],
                            'maxActualHeadAboveDoorWithinLintelXZContact':candidate['maxActualHeadAboveDoorWithinLintelXZContact'],
                            'sourceGuardWholeLegHeadAboveDoor':candidate['sourceGuardWholeLegHeadAboveDoor']})
    if row['state']=='physicalWaiting':
        witness_ids=[p['buildingId'] for p in row['currentLeg'].get('bodyWitnesses',[]) if p['blockingFloors']]
        actual=[]
        for sid in witness_ids:
            w=lintel_witness(sites[sid],row['position'],row['currentLeg']['to'])
            if w:actual.append(w)
        bad.append({'actorId':row['id'],'state':row['state'],'hunger':row['needs']['hunger'],'wallet':row['money'],
                    'destinationId':row['destinationId'],'routeIndex':index,'actualWholeReferenceGuardFalse':row['currentLeg']['referenceBodyGuardAllowsWholeSegment'] is False,
                    'actualRoadGuardTrue':row['currentLeg']['roadGuardAllowsWholeReferenceSegment'],'witnesses':actual})
    category='BODY_GUARD_WAITING' if row['state']=='physicalWaiting' else 'CURRENTLY_RIDING' if row['rider'] else 'CURRENTLY_MOVING_NO_NEXT_LEG_BLOCK_FOUND'
    projected_wait=row['needs']['hunger']/.05
    exported.append({'actorId':row['id'],'name':row['name'],'role':row['role'],'canonicalIdentity':row['canonicalIdentity'],'districtId':row['districtId'],
        'age':row['age'],'health':row['health'],'hunger':row['needs']['hunger'],'fatigue':row['needs']['fatigue'],'food':row['food'],'money':row['money'],
        'state':row['state'],'tier':row['tier'],'category':category,'currentActivity':row['currentActivity'],'currentDestinationId':row['destinationId'],
        'shopId':row['currentDestinationQuote']['shopId'],'shopOpen':row['currentDestinationQuote']['open'],'shopInventory':row['currentDestinationQuote']['inventory'],
        'shopRawQuote':row['currentDestinationQuote']['rawUnitPrice'],'routePoints':row['currentRoute']['points'],'routeIndex':index,
        'remainingReferenceWalkingMeters':remaining if not row['rider'] else '',
        'referenceWalkingMinutesAtOriginalSpeed':remaining/4.2 if not row['rider'] else '',
        'hungerMinutesUntilZeroAtOriginalDecay':projected_wait,'anchorCount':len(row['walkingAnchors']),
        'graphReachableEligibleOffers':row['graphReachableEligibleOfferCount'],'plannerGroundSaleEligibleOffers':row['plannerGroundSaleEligibleOfferCount'],
        'nativeGroundSaleEligibleOffers':row['materializableGroundSaleEligibleOfferCount'],'previousEatCommitment':row['previousEatCommitment'],
        'hypotheticalChoice':row['pureHypotheticalChoice']['destinationId'],'hypotheticalActivity':row['pureHypotheticalChoice']['activity'],
        'nextRoadGuardAllows':row['currentLeg'].get('roadGuardAllowsWholeReferenceSegment'),'nextBodyGuardAllows':row['currentLeg'].get('referenceBodyGuardAllowsWholeSegment'),
        'blockingBuildings':','.join(p['buildingId'] for p in row['currentLeg'].get('bodyWitnesses',[]) if p['blockingFloors']),
        'pendingSourceLintelFalsePositiveLegs':len(pending),'pendingSourceLintelSites':','.join(p['siteId'] for p in pending),
        'riderVehicleId':row['rider']['vehicleId'] if row['rider'] else '','riderStopNodeId':row['rider']['stopNodeId'] if row['rider'] else '',
        'homeId':row['homeId'],'workId':row['workId'],'workKind':row['workKind'],'workShopId':row['workShopId'],
        'workAllowance':row['workAllowance'],'actualAttendanceSinceSettlement':row['actualAttendanceSinceSettlement'],
        'unsettledWageClaimAmount':sum(c['amount'] for c in row['unsettledClaims']),'overdueWageArrearAmount':sum(c['amount'] for c in row['settlementArrears']),
        'arrivalObservedInThisAudit':False,'purchaseObservedInThisAudit':False})
    future_rows.append({'actorId':row['id'],'state':row['state'],'currentIndex':index,'pendingSourceArithmeticLintelFalsePositiveLegs':pending})

for name,data in [('DOOR-LINTEL-WITNESSES.json',bad),('PENDING-LINTEL-SEGMENTS.json',future_rows)]:
    (root/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
with (root/'RESIDENTS-240.csv').open('w',newline='') as stream:
    writer=csv.DictWriter(stream,fieldnames=list(exported[0]));writer.writeheader();writer.writerows(exported)
all_offers=[]
for row in rows:
    for offer in row['offers']:all_offers.append({'actorId':row['id'],**offer})
with (root/'OFFERS-ALL.csv').open('w',newline='') as stream:
    writer=csv.DictWriter(stream,fieldnames=list(all_offers[0]));writer.writeheader();writer.writerows(all_offers)
last=audit['snapshots'][-1];s=original['state'];r=original['runtime']
classes=collections.Counter(row['category'] for row in exported)
nonriding=[row for row in exported if not row['riderVehicleId']]
moving=[row for row in nonriding if row['state']=='moving']
financial={'actualAuditWages':last['wages'],'actualWageArrears':last['wageArrears'],'actualPublicBudget':last['publicBudget'],
    'privateUnsettledClaims':sum(c['amount'] for c in r['wageAccruals'] if c['shopId'] is not None),
    'publicUnsettledClaims':sum(c['amount'] for c in r['wageAccruals'] if c['shopId'] is None),
    'hungryOverduePrivateWageArrears':sum(c['amount'] for row in rows for c in row['settlementArrears'] if c['shopId'] is not None),
    'hungryUnsettledPrivateClaims':sum(c['amount'] for row in rows for c in row['unsettledClaims'] if c['shopId'] is not None),
    'minHungryWallet':min(row['money'] for row in rows),'maxFoodRawQuote':max(shop['price'] for shop in s['shops'] if sites[shop['buildingId']]['kind'] in ['market','farm','dock']),
    'foodStock':last['food'],'rawAuditFoodCommodityFlow':last['commodityObservations']['flows']['food'],
    'sourceScope':'Actual preserved terminal wages/claims and day observer only. EarnedNotDue is not overdue arrears; public payments debit treasury, private payments debit employer cash/capital. No counterfactual wage/state change or historical exact per-person cash attribution reconstructed.'}
(root/'FINANCIAL-AND-SUPPLY-FACTS.json').write_text(json.dumps(financial,ensure_ascii=False,indent=2)+'\n')
summary={'categories':dict(classes),'zeroHunger':sum(row['hunger']==0 for row in exported),'movingZeroHunger':sum(row['hunger']==0 for row in moving),
    'waitingLintelFalsePositiveWitnesses':sum(w['classification']=='SOURCE_ARITHMETIC_FALSE_POSITIVE_LINTEL' for row in bad for w in row['witnesses']),
    'waitingActors':len(bad),'waitingSites':sorted({w['siteId'] for row in bad for w in row['witnesses']}),
    'futurePendingLintelActors':sum(bool(row['pendingSourceArithmeticLintelFalsePositiveLegs']) for row in future_rows),
    'futurePendingLintelActorsByCurrentState':dict(collections.Counter(row['state'] for row in future_rows if row['pendingSourceArithmeticLintelFalsePositiveLegs'])),
    'allAffordableOfferPairs':len(all_offers),'changedHypotheticalChoice':sum(row['hypotheticalChoice']!=row['currentDestinationId'] for row in exported),
    'movingReferenceRemainingMinMeters':min(row['remainingReferenceWalkingMeters'] for row in moving),
    'movingReferenceRemainingMaxMeters':max(row['remainingReferenceWalkingMeters'] for row in moving),
    'movingReferenceETAAboveHungerZeroMinutes':sum(row['referenceWalkingMinutesAtOriginalSpeed']>row['hungerMinutesUntilZeroAtOriginalDecay'] for row in moving),
    'scope':'CSV/JSON arithmetic over original parsed artifacts plus successful pure-query outputs; no TS execution, factory, Simulation, ticks, test, GPU or business edit.'}
(root/'POSTPROCESS-SUMMARY.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False));print(json.dumps({'arrears':financial['actualWageArrears'],'minHungryWallet':financial['minHungryWallet'],'maxFoodRawQuote':financial['maxFoodRawQuote']}))
