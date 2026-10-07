#!/usr/bin/env python3
"""Read detached original JSON only; no application imports, Sim or step calls."""
from pathlib import Path
import collections, gzip, hashlib, json, math, statistics

OUT = Path(__file__).parent
ROOT = Path('/tmp/ROOT24-economy-next-day-20261007-01')
WORLD = Path('/workspace/yunshan-work/ROOT23-ledger-scaling-20261007-01/native-plan/static-inputs/WORLD291.original.json')
OBS = ROOT / 'native04/TERMINAL-OBSERVATIONS.json'
SOURCES = {
    'originalMain3900': ROOT / 'native03/frames/0001-imported-main/whole-save.json.gz',
    'originalCompleteCheckpoint344_5276': ROOT / 'native03/frames/0346-ordinary-344/whole-save.json.gz',
    'native04ColdImported5276': ROOT / 'native04/frames/0001-imported-main/whole-save.json.gz',
    'terminal5340': ROOT / 'native04/frames/0017-ordinary-016/whole-save.json.gz',
}
def digest(raw): return hashlib.sha256(raw).hexdigest()
def load(path):
    encoded = path.read_bytes()
    raw = gzip.decompress(encoded) if path.suffix == '.gz' else encoded
    return json.loads(raw), {'path': str(path), 'encoding': 'gzip-utf8' if path.suffix == '.gz' else 'utf8-json',
        'encodedBytes': len(encoded), 'encodedSHA256': digest(encoded), 'decodedBytes': len(raw), 'decodedSHA256': digest(raw)}, raw
world, world_source, world_raw = load(WORLD)
assert digest(world_raw) == '2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512'
buildings = {site['id']: site for site in world['buildings']}
data, provenance, raw_saves = {}, {}, {}
for label, path in SOURCES.items():
    data[label], provenance[label], raw_saves[label] = load(path)
assert provenance['originalMain3900']['decodedSHA256'] == '4610ab1059b52cfd4bbfa17badf209a7a33ab986735d83b8a5da8c8a9e5ddf6a'
assert raw_saves['originalCompleteCheckpoint344_5276'] == raw_saves['native04ColdImported5276']
assert provenance['native04ColdImported5276']['decodedSHA256'] == 'f0ea97daef48d4e2357536a3d1ce4b9222dbcbaaa4d5205677bde9483c5a95b6'
assert provenance['terminal5340']['decodedSHA256'] == '6e4812acde393a9436dfe09f4b3994a3721ccaba6ddb972c9623a9e369d02d48'
obs, obs_source, _ = load(OBS)
def sum_values(values):
    # Match the production observation's ordered IEEE754 additions.
    total = 0
    for value in values: total += value
    return total
def distribution(values):
    values = sorted(values)
    def percentile(p):
        position = (len(values) - 1) * p
        lower = math.floor(position); upper = math.ceil(position)
        return values[lower] + (values[upper] - values[lower]) * (position - lower)
    return {'count': len(values), 'sum': sum_values(values), 'preciseSum': math.fsum(values), 'min': values[0],
        'p10': percentile(.1), 'median': statistics.median(values), 'p90': percentile(.9),
        'max': values[-1], 'mean': statistics.fmean(values)} if values else {'count': 0, 'sum': 0}
def food_access(s):
    food_sites = [shop for shop in s['shops'] if buildings[shop['buildingId']]['kind'] in ['market', 'farm', 'dock']]
    offers = [shop for shop in food_sites if shop['open'] and shop['inventory'] >= 1]
    alive = [c for c in s['citizens'] if s['extension']['actorProfiles'][c['id']].get('alive') is not False]
    hungry = [c for c in alive if c['needs']['hunger'] < 30 and c.get('food', 0) < 1]
    return {'aliveResidents': len(alive), 'nominalResidentMealsPerDay': len(alive) * .05 * 1440 / 52,
        'shopFoodUnits': sum_values(shop['inventory'] for shop in food_sites),
        'residentCarriedFoodUnits': sum_values(c.get('food', 0) for c in s['citizens']),
        'playerCarriedFoodUnits': s['player']['inventory'].get('food', 0),
        'bySiteKind': {kind: {'sites': len(sites := [shop for shop in s['shops'] if buildings[shop['buildingId']]['kind'] == kind]),
            'open': sum(shop['open'] for shop in sites), 'inventoryUnits': sum_values(shop['inventory'] for shop in sites),
            'employees': sum(shop['employees'] for shop in sites)} for kind in ['farm', 'dock', 'market', 'workshop']},
        'hungryWithoutCarriedFood': len(hungry),
        'hungryCanAffordAnyStockedOpenFoodOffer': sum(any(c['money'] >= shop['price'] for shop in offers) for c in hungry),
        'routeReachability': 'NOT_OBSERVED'}
def snapshot(save):
    s, r = save['state'], save['runtime']; profiles = s['extension']['actorProfiles']
    citizens = s['citizens']; alive = [c for c in citizens if profiles[c['id']].get('alive') is not False]
    adults = [c for c in alive if c['role'] != '学生' and profiles[c['id']].get('age', 20) >= 18]
    districts = []
    for district in s['districts']:
        members = [c for c in adults if c['districtId'] == district['id']]
        districts.append({'id': district['id'], 'savedEmployment': district['employment'], 'observedAdultNonStudentResidents': len(members),
            'savedRateTimesEndpointAdultCount': district['employment'] * len(members), 'savedProsperity': district['prosperity']})
    companies = s['extension']['companies']
    bound = [company for company in companies if 'shopBindingReleasedAt' not in company]
    def funds(shop): return next((company['capital'] for company in bound if company['buildingId'] == shop['buildingId']), shop.get('cash', 0))
    private = r.get('privateLabor', {})
    shifts = [shift for shift in private.get('shifts', {}).values() if shift['day'] == s['day']]
    assignments = [a for shift in shifts for a in shift['assignments']]
    allowance = [a for a in assignments if a['minutesCap'] > a['workedMinutes']]
    return {'clock': s['day'] * 1440 + s['hour'] * 60, 'tick': s['tick'], 'day': s['day'], 'hour': s['hour'], 'speed': s['speed'],
        'residentCount': len(citizens), 'aliveResidentCount': len(alive), 'adultNonStudentCount': len(adults),
        'residentCash': {**distribution([c['money'] for c in citizens]), 'negativeCount': sum(c['money'] < 0 for c in citizens),
            'below1': sum(c['money'] < 1 for c in citizens), 'below20': sum(c['money'] < 20 for c in citizens),
            'below100': sum(c['money'] < 100 for c in citizens)},
        'hunger': {**distribution([c['needs']['hunger'] for c in alive]),
            'below20': sum(c['needs']['hunger'] < 20 for c in alive), 'below30': sum(c['needs']['hunger'] < 30 for c in alive),
            'below48': sum(c['needs']['hunger'] < 48 for c in alive), 'at0': sum(c['needs']['hunger'] == 0 for c in alive)},
        'employment': {'savedDistricts': districts,
            'savedDistrictEmploymentWeightedByEndpointAdultCount': sum_values(d['savedRateTimesEndpointAdultCount'] for d in districts) / len(adults) if adults else None,
            'shopEmployeesReported': sum(shop['employees'] for shop in s['shops']),
            'shopRosterMembersAdultNonStudent': sum(c['workId'] in {shop['buildingId'] for shop in s['shops']} for c in adults),
            'publicOrNonShopWorkIdsAdultNonStudent': sum(c['workId'] not in {shop['buildingId'] for shop in s['shops']} for c in adults),
            'workingStateResidents': sum(c['state'] == 'working' for c in alive), 'unemployedStateResidents': sum(c['state'] == 'unemployed' for c in alive),
            'offDutyStateResidents': sum(c['state'] == 'offDuty' for c in alive),
            'currentDayPrivateShiftCount': len(shifts), 'currentDayPrivateAssignmentCount': len(assignments),
            'currentDayPrivateAssignedCitizens': len({a['citizenId'] for a in assignments}),
            'currentDayPrivateAssignmentsWithRemainingAllowance': len(allowance),
            'currentDayPrivateAssignmentsWithWorkedMinutes': sum(a['workedMinutes'] > 0 for a in assignments),
            'currentDayPrivateAssignedMinutesCap': sum_values(a['minutesCap'] for a in assignments),
            'currentDayPrivateWorkedMinutes': sum_values(a['workedMinutes'] for a in assignments),
            'publicLaborSerialized': r.get('publicLabor') is not None,
            'roleCounts': dict(collections.Counter(c['role'] for c in citizens)),
            'stateCounts': dict(collections.Counter(c['state'] for c in citizens)),
            'scope': 'Saved district.employment values, recorded roster/shift capacities and endpoint states only. No reconstructed isEmployed or fresh Simulation; workId/role, employees, worked minutes and remaining allowance are distinct quantities. Missing publicLabor does not deny legacy public employment.'},
        'companyCapital': {**distribution([company['capital'] for company in companies]), 'zeroOrNegativeCount': sum(company['capital'] <= 0 for company in companies),
            'below6_666666666666667': sum(company['capital'] < 20 * 8 / 24 for company in companies),
            'companies': [{'id': c['id'], 'name': c['name'], 'ownerId': c['ownerId'], 'buildingId': c['buildingId'], 'capital': c['capital'],
                'inventory': c['inventory'], 'employees': c['employees'], 'shopBindingReleasedAt': c.get('shopBindingReleasedAt')} for c in companies]},
        'shopOperatingFunds': {**distribution([funds(shop) for shop in s['shops']]),
            'activeCompanyBoundShopCount': sum(any(c['buildingId'] == shop['buildingId'] for c in bound) for shop in s['shops']),
            'scope': 'Active company.capital replaces bound shop.cash, exactly per simulation.ts shopFunds; never add company capital to this shop-funds total.'},
        'foodAccess': food_access(s), 'treasury': s['treasury'], 'playerCash': s['player']['money'],
        'bankCash': s.get('banking', {}).get('cash'), 'loan': s.get('loan'), 'taxesHeldRuntime': r.get('taxes'),
        'scheduledNextCommerceAt': r['commerceAt'], 'scheduledNextFinanceAt': r['financeAt'], 'scheduledNextPayrollAt': r['payrollAt']}
snapshots = {label: snapshot(save) for label, save in data.items()}
final_state = data['terminal5340']['state']
assert obs['natural']['at'] == snapshots['terminal5340']['clock'] == 5340
assert obs['natural']['extensionAt'] == final_state['extension']['lastUpdate']
assert all(obs['foodAccess'][k] == snapshots['terminal5340']['foodAccess'][k] for k in snapshots['terminal5340']['foodAccess'])
final_obs_citizens = {c['id']: c for c in obs['natural']['citizens']}
for c in final_state['citizens']:
    o = final_obs_citizens[c['id']]
    assert all(o[k] == c[k] for k in ['money','needs','workId','homeId','role','state','destinationId','position'])
    assert o['food'] == c.get('food', 0)
final_obs_shops = {shop['id']: shop for shop in obs['natural']['shops']}
for shop in final_state['shops']:
    o = final_obs_shops[shop['id']]
    assert all(o[k] == shop[k] for k in shop)
    assert o['buildingKind'] == buildings[shop['buildingId']]['kind']
assert sum_values(shop['funds'] for shop in obs['natural']['shops']) == snapshots['terminal5340']['shopOperatingFunds']['preciseSum'] or abs(sum_values(shop['funds'] for shop in obs['natural']['shops']) - snapshots['terminal5340']['shopOperatingFunds']['preciseSum']) < 1e-8
def compare(a, b):
    sa, sb = snapshots[a], snapshots[b]
    ca = {c['id']: c for c in data[a]['state']['citizens']}; cb = {c['id']: c for c in data[b]['state']['citizens']}
    common = sorted(set(ca) & set(cb))
    company_a = {c['id']: c for c in data[a]['state']['extension']['companies']}; company_b = {c['id']: c for c in data[b]['state']['extension']['companies']}
    return {'from': a, 'to': b, 'clockMinutes': sb['clock']-sa['clock'], 'tickDelta': sb['tick']-sa['tick'],
        'residentCashDelta': sb['residentCash']['preciseSum']-sa['residentCash']['preciseSum'],
        'residentCashIncreased': sum(cb[i]['money']>ca[i]['money'] for i in common), 'residentCashDecreased': sum(cb[i]['money']<ca[i]['money'] for i in common),
        'residentCashUnchanged': sum(cb[i]['money']==ca[i]['money'] for i in common),
        'hungerMeanDelta': sb['hunger']['mean']-sa['hunger']['mean'], 'hungerBelow30Delta': sb['hunger']['below30']-sa['hunger']['below30'],
        'carriedFoodUnitsDelta': sb['foodAccess']['residentCarriedFoodUnits']-sa['foodAccess']['residentCarriedFoodUnits'],
        'shopFoodUnitsDelta': sb['foodAccess']['shopFoodUnits']-sa['foodAccess']['shopFoodUnits'],
        'shopWorkshopMaterialInventoryDelta': sb['foodAccess']['bySiteKind']['workshop']['inventoryUnits']-sa['foodAccess']['bySiteKind']['workshop']['inventoryUnits'],
        'shopEmployeesReportedDelta': sb['employment']['shopEmployeesReported']-sa['employment']['shopEmployeesReported'],
        'savedWeightedDistrictEmploymentDelta': sb['employment']['savedDistrictEmploymentWeightedByEndpointAdultCount']-sa['employment']['savedDistrictEmploymentWeightedByEndpointAdultCount'],
        'workIdChangedResidents': [i for i in common if cb[i]['workId']!=ca[i]['workId']], 'roleChangedResidents': [i for i in common if cb[i]['role']!=ca[i]['role']],
        'companyCapitalDelta': sb['companyCapital']['preciseSum']-sa['companyCapital']['preciseSum'],
        'addedCompanies': sorted(set(company_b)-set(company_a)), 'removedCompanies': sorted(set(company_a)-set(company_b)),
        'companyCapitalChanges': [{'id': i,'capitalBefore': company_a[i]['capital'] if i in company_a else None,
            'capitalAfter': company_b[i]['capital'] if i in company_b else None,
            'deltaCommonCompany': company_b[i]['capital']-company_a[i]['capital'] if i in company_a and i in company_b else None} for i in sorted(set(company_a)|set(company_b))],
        'shopOperatingFundsDelta': sb['shopOperatingFunds']['preciseSum']-sa['shopOperatingFunds']['preciseSum'],
        'treasuryDelta': sb['treasury']-sa['treasury'], 'playerCashDelta': sb['playerCash']-sa['playerCash'],
        'scope': 'Endpoint difference only; does not attribute cash to wages alone, prove complete resource flow, income distribution sustainability, legal food routes or 14-day steady state.'}
result = {'status': 'READ_ONLY_ENDPOINT_STATISTICS_FROM_ORIGINALS', 'simulationConstructions': 0, 'ordinarySteps': 0,
    'worldSource': world_source, 'terminalObservationSource': obs_source, 'saveSources': provenance,
    'sourceReadbackChecks': {'original344AndNative04ColdImportedEntireDecodedSaveByteExact': True,
        'terminalFoodAccessMatchesOriginalObservationEveryRecomputedFieldExact': True,
        'terminal616CitizenMoneyNeedsWorkRoleFoodPositionMatchesFullSave': True,
        'terminal210ShopSavedFieldsAndOriginalWorldKindMatchFullSave': True},
    'interpretation': {'timeline': 'Original full save at3900/tick1710 to5340/tick2070: canonical360 windows from344+16, two cold segments,361 physical calls with345 replay. Suffix alone5276 to5340:16 new ordinary windows/64 game minutes.',
        'hungerDirection': 'Saved needs.hunger is fullness: larger values mean less hungry; thresholds below20/30/48 are explicitly observational categories.',
        'cash': 'Resident wallets exclude player, treasury, company/shop operating funds, bank and tax custody. Cash increases/decreases are measured endpoint deltas, not proof of injections or their absence.',
        'employment': 'District rates are original saved commerce output, not new exact endpoint isEmployed evaluations. Capacity/role/assigned shift/working state/earned minutes are not interchangeable.',
        'food': obs['foodAccess']['inventoryScope'], 'foodAffordability': 'Any stocked open food offer with price <=wallet; distance, permissions, routes and arrival NOT_OBSERVED.',
        'companyCapital': 'Capital is an operating account; company/shop inventory are separate fields. Company capitalization cannot be added to bound shop funds as additional cash.',
        'limits': 'No native calls/imports, game code execution, new tests, performance measurements, money/food correction, long-term sustainability or all-domain pass claim.'},
    'snapshots': snapshots,
    'comparisons': {'wholeCanonicalDay': compare('originalMain3900','terminal5340'), 'newColdSuffixOnly': compare('native04ColdImported5276','terminal5340')},
    'originalTerminalSuffixObservation': {'foodAccess': obs['foodAccess'], 'totals': obs['totals'], 'maximumResidual': obs['maximumResidual'],
        'publicBudget': obs['natural']['publicBudget'], 'steadyStateClaimed': obs['steadyStateClaimed'],
        'literalJobs76Claimed': obs['literalJobs76Claimed'], 'initialFarm120IsUniversalHiringBan': obs['initialFarm120IsUniversalHiringBan']}}
target = OUT / 'NATIVE04-ENDPOINT-STATISTICS.json'
target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
summary = {'path':str(target),'bytes':target.stat().st_size,'sha256':digest(target.read_bytes()),
    'endpoints':{label:{'clock':s['clock'],'cashTotal':s['residentCash']['preciseSum'],'cashBelow20':s['residentCash']['below20'],
        'hungerMean':s['hunger']['mean'],'hungerBelow30':s['hunger']['below30'],'companyCapital':s['companyCapital']['preciseSum'],
        'savedWeightedEmployment':s['employment']['savedDistrictEmploymentWeightedByEndpointAdultCount'],'shopEmployees':s['employment']['shopEmployeesReported'],
        'foodInShops':s['foodAccess']['shopFoodUnits'],'carriedFood':s['foodAccess']['residentCarriedFoodUnits']} for label,s in snapshots.items()},
    'comparison':result['comparisons']['wholeCanonicalDay']}
print(json.dumps(summary,ensure_ascii=False,indent=2))
