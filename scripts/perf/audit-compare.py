"""Side-by-side day-N summary of economy audit artifacts.
   python3 scripts/perf/audit-compare.py A.json B.json ..."""
import json, sys
def summary(path):
    d = json.load(open(path)); s = d['snapshots'][-1]; w = s['wages']; f = s['food']; n = s['npc']
    hungry = sum(1 for _ in []) if False else None
    return {
        'status': d.get('auditStatus'), 'day': s['day'], 'alive': n['alive'], 'poor': n['poor'],
        'meanHunger': round(n['livingMeanHunger'], 1), 'storedFood': n['storedFood'], 'shopFood': round(f['shopFoodUnits']),
        'farmInv': round(f['bySiteKind']['farm']['inventoryUnits']), 'marketInv': round(f['bySiteKind']['market']['inventoryUnits']),
        'taxRate': s['policy']['taxRate'], 'treasury': round(s['treasury']), 'gdp': round(s['gdp']), 'sales': round(w['sales']), 'saleCount': w['saleCount'],
        'payrollPublic': round(w['payrollPublicPaid']), 'payrollPrivate': round(w['payrollPrivate']), 'production': round(w['production']),
        'privateWorkedMin': round(s['privateLabor']['statistics']['workedMinutes']), 'reconciliation': d.get('reconciliationResidual'), 'conservation': d.get('moneyConservationResidual'),
    }
rows = [(p.split('/')[-1], summary(p)) for p in sys.argv[1:]]
keys = list(rows[0][1].keys())
print('metric'.ljust(18) + ''.join(name[:28].rjust(30) for name, _ in rows))
for k in keys: print(k.ljust(18) + ''.join(str(r[k]).rjust(30) for _, r in rows))
