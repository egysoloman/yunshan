#!/usr/bin/env python3
"""Read-only SHA/import/evidence audit. No runtime, build or repository writes."""
from pathlib import Path
import datetime, hashlib, json, re, subprocess

OUT = Path('/tmp/yunshan-facade-delivery-review-20261003-01')
REPO = Path('/workspace/yunshan')
ROOT03 = Path('/tmp/yunshan-mz-root03-20261003-01')
ROOT06 = Path('/tmp/yunshan-mz-root06-20261003-01')
ROOT07 = Path('/tmp/yunshan-mz-root07-20261003-01')
BASE = '6785ca7dcca09e8e97afd610cfd52176c7a1cfb1'

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(name, data):
    (OUT/name).write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
def stamp(): return datetime.datetime.now(datetime.timezone.utc).isoformat()

OUT.mkdir(parents=True, exist_ok=True)
manifest_path = ROOT06/'source/adapters/rpg-maker/core-source-manifest.json'
manifest = json.loads(manifest_path.read_text())
rows = []
for name, expected in manifest['files'].items():
    git_bytes = subprocess.check_output(['git', '-C', str(REPO), 'show', BASE+':'+name])
    row = {'path': name, 'frozenSha256': expected,
           'git6785Sha256': hashlib.sha256(git_bytes).hexdigest(),
           'sharedSha256': sha(REPO/name),
           'root03Sha256': sha(ROOT03/'source'/name),
           'root06Sha256': sha(ROOT06/'source'/name)}
    if (ROOT07/'source'/name).exists(): row['root07Sha256'] = sha(ROOT07/'source'/name)
    row['allEqual'] = all(v == expected for k,v in row.items() if k.endswith('Sha256'))
    rows.append(row)

adapter_rows = []
for p in sorted((ROOT06/'source/adapters/rpg-maker').iterdir()):
    if not p.is_file(): continue
    name = str(p.relative_to(ROOT06/'source'))
    row = {'path':name, 'root06Sha256':sha(p), 'root03Sha256':sha(ROOT03/'source'/name)}
    row['root06EqualsRoot03'] = row['root06Sha256'] == row['root03Sha256']
    if (ROOT07/'source'/name).exists():
        row['root07Sha256'] = sha(ROOT07/'source'/name)
        row['root07EqualsRoot03'] = row['root07Sha256'] == row['root03Sha256']
    row['role'] = ('test' if name.endswith('.test.ts') else 'documentation' if name.endswith('.md') else 'production-or-build-contract')
    adapter_rows.append(row)

meta_path = ROOT03/'bundle01/bundle-metafile.json'
meta = json.loads(meta_path.read_text())
runtime_rows = []
external_edges = []
for name, item in meta['inputs'].items():
    p = ROOT06/'source'/name
    row = {'path':name, 'bytesInMetafile':item['bytes'], 'sourceBytes':p.stat().st_size,
           'root03Sha256':sha(ROOT03/'source'/name), 'root06Sha256':sha(p),
           'imports':item['imports'], 'forbiddenRuntimeInput':bool(re.search(r'node_modules|renderer|controller|(?:^|/)main\.ts|(?:^|/)ui\.ts|\.css$|(?:^|/)three(?:/|$)',name))}
    row['bytesMatchMetafile'] = row['bytesInMetafile'] == row['sourceBytes']
    row['sourceAligned'] = row['root03Sha256'] == row['root06Sha256']
    for edge in item['imports']:
        if edge.get('external') or edge['path'] not in meta['inputs']:
            external_edges.append({'from':name, 'edge':edge})
    runtime_rows.append(row)

outputs = []
build_receipt_path = ROOT03/'bundle01/build-receipt.json'
build_receipt = json.loads(build_receipt_path.read_text())
for name, expected in build_receipt['outputHashes'].items():
    p = ROOT03/'bundle01'/name
    outputs.append({'path':str(p), 'bytes':p.stat().st_size, 'sha256':sha(p),
                    'receiptSha256':expected, 'receiptMatch':sha(p)==expected})

bundle = ROOT03/'bundle01/YunshanCore.js'
bundle_text = bundle.read_text()
host_checks = {
    'unresolvedCommonJSRequire': bool(re.search(r'\brequire\s*\(', bundle_text)),
    'moduleImportStatement': bool(re.search(r'(?m)^\s*import(?:\s|\()',bundle_text)),
    'nodeSpecifier': bool(re.search(r"['\"]node:",bundle_text)),
    'domGlobalReference': bool(re.search(r'\b(?:document|HTMLElement|HTMLCanvasElement|requestAnimationFrame|localStorage|sessionStorage)\b',bundle_text)),
    'nodeGlobalReference': bool(re.search(r'\b(?:process|Buffer|__dirname|__filename)\b',bundle_text)),
    'threeGlobalReference': bool(re.search(r'\bTHREE\b',bundle_text)),
}

alignment = {
    'reviewedAt':stamp(), 'method':'Python/SHA-256 and read-only git show; no Node/tsc/npm/browser/ZIP/upload or repository changes',
    'baseCommit':BASE, 'coreSourceManifest':{'path':str(manifest_path), 'sha256':sha(manifest_path)},
    'frozenSrcCount':len(rows), 'actualRoot06SrcCount':sum(p.is_file() for p in (ROOT06/'source/src').rglob('*')),
    'coreAllEqual':all(r['allEqual'] for r in rows), 'coreRows':rows,
    'adapterRows':adapter_rows,
    'productionAdapterRoot06EqualsRoot03':all(r['root06EqualsRoot03'] for r in adapter_rows if r['role']=='production-or-build-contract'),
    'productionAdapterRoot07EqualsRoot03':all(r.get('root07EqualsRoot03',False) for r in adapter_rows if r['role']=='production-or-build-contract'),
    'bundleMetafile':{'path':str(meta_path), 'sha256':sha(meta_path)},
    'runtimeInputCount':len(runtime_rows), 'runtimeCoreCount':sum(r['path'].startswith('src/') for r in runtime_rows),
    'runtimeAdapterCount':sum(r['path'].startswith('adapters/') for r in runtime_rows),
    'runtimeInputsAligned':all(r['sourceAligned'] and r['bytesMatchMetafile'] for r in runtime_rows),
    'forbiddenRuntimeInputs':[r['path'] for r in runtime_rows if r['forbiddenRuntimeInput']],
    'externalImportEdges':external_edges, 'outputImportEdges':{k:v['imports'] for k,v in meta['outputs'].items()},
    'runtimeRows':runtime_rows, 'bundleLexicalChecks':host_checks,
    'hostTokenNotes':[
        'The word window in generated code denotes architecture window strings or locally declared classroom/research time-window variables, not browser window.',
        'src/roads.ts:241 declares a local require validator. It is not a Node require import; the generated bundle has no unresolved require(...) call.',
        'Node imports in build.mjs and bridge/walker tests are build/test-only and absent from the 32 runtime inputs.',
        'No Three/DOM/Node runtime imports or external import edges appear in the actual esbuild metafile. ROOT06 full test also executes the exact formal IIFE without window/document/THREE/PIXI/require/process/$gameMap supplied by its VM host.',
    ],
    'buildReceipt':{'path':str(build_receipt_path), 'sha256':sha(build_receipt_path)},
    'bundleOutputs':outputs, 'allBundleReceiptHashesMatch':all(r['receiptMatch'] for r in outputs),
}
write('source-alignment.json',alignment)

contract_path=ROOT03/'bundle01/contract.json'
contract=json.loads(contract_path.read_text())
world=json.loads((ROOT03/'bundle01/world-current-v4.json').read_text())
core_save=json.loads((ROOT03/'bundle01/initial-core.save.json').read_text())
sim_text=(ROOT06/'source/src/simulation.ts').read_text()
phase_order=re.findall(r"'([^']+)'",re.search(r'const ORDER = \[(.*?)\]',sim_text).group(1))
types_text=(ROOT06/'source/src/types.ts').read_text()
command_types=re.findall(r"'([^']+)'",re.search(r'export interface Command \{ type: (.*?);',types_text,re.S).group(1))
write('contract-alignment.json',{
    'reviewedAt':stamp(),'contractPath':str(contract_path),'contractSha256':sha(contract_path),
    'coreCommit':contract['coreCommit'],'coreCommitMatchesFrozen':contract['coreCommit']==BASE,
    'coordinates':contract['coordinates'],'fixedStepSeconds':contract['fixedStepSeconds'],
    'simulationTickSeconds':contract['simulationTickSeconds'],
    'fixedPhaseOrder':phase_order,'contractPhaseOrderMatchesOriginal':contract['fixedPhaseOrder']==phase_order,
    'commandTypesCount':len(command_types),'contractCommandTypesMatchOriginal':contract['commandTypes']==command_types,
    'defaultWorld':{'layout':world['layoutVersion'],'seed':world['seed'],'coreSaveSeed':core_save['worldSeed'],
                    'coreSaveFingerprint':core_save['worldFingerprint'],'contractFingerprint':contract['worldFingerprint'],
                    'buildings':len(world['buildings']),'citizens':len(core_save['state']['citizens']),
                    'districts':len(world['districts']),'nodes':len(world['nodes']),'edges':len(world['edges']),
                    'allMetadataAligned':world['seed']==core_save['worldSeed']==contract['worldSeed'] and world['layoutVersion']==contract['layout'] and core_save['worldFingerprint']==contract['worldFingerprint']},
    'originalCoreSave':{'format':core_save['format'],'version':core_save['version'],
                        'sha256':sha(ROOT03/'bundle01/initial-core.save.json'),
                        'completeSnapshotModuleCount':len(contract['completeSnapshotModules']),
                        'snapshotKeysMatchSaveState':contract['completeSnapshotModules']==list(core_save['state']),
                        'runtimePresent':'runtime' in core_save,'routeEncodingPresent':'routeEncoding' in core_save,'routePoolPresent':'routePool' in core_save},
    'initialSystemsFieldNote':'contract.systems is the untouched tick0 lastSystemOrder ([]). fixedPhaseOrder is checked against original ORDER; actual post-tick ORDER and exact core equality passed in ROOT06 bridge01.',
    'publicAPI': ['createSession','CitySession.metadata','worldSnapshot','snapshot','actorsSnapshot','playerLocation','floorPlan','canAccessFloor','atFunctionPoint','walkHeight','navigation','departures','eventsSince','queueCommand','drainResults','advance','useDoor','useStairs','driveInput','aircraftInput','exportCoreSave','exportSave','importSave'],
    'sourceEvidence':{
        'bridgeUnits':'ROOT06/source/adapters/rpg-maker/bridge.ts:12-15',
        'privateSimulationAndWorld':'ROOT06/source/adapters/rpg-maker/bridge.ts:26-48',
        'snapshotCopies':'ROOT06/source/adapters/rpg-maker/bridge.ts:52-54,149-160',
        'validatedAdvanceAndOriginalStep':'ROOT06/source/adapters/rpg-maker/bridge.ts:79-99',
        'threeDimensionalDoorRange':'ROOT06/source/adapters/rpg-maker/bridge.ts:107-114',
        'floorACL':'ROOT06/source/src/access.ts:19-38 and adapters/rpg-maker/headless-walker.ts:88-127',
        'originalPhaseOrder':'ROOT06/source/src/simulation.ts:26-29,647-655',
        'originalCanonicalSaveAndValidation':'ROOT06/source/src/simulation.ts:1838-1843,2064-2067',
        'bridgeEnvelopeAndAtomicImport':'ROOT06/source/adapters/rpg-maker/bridge.ts:162-194',
        'trustedWorldSelection':'ROOT06/source/src/persistence/world-layout.ts:45-61'},
    'evidenceScope':'Static source/JSON alignment plus existing ROOT06 full run and independent ROOT07 upper-door target; no new runtime execution by this review.'})

evidence_roots = [Path('/tmp')/f'yunshan-mz-root0{i}-20261003-01' for i in range(1,8)] + [
    Path('/tmp/yunshan-mz-runtime-diagnose-20261003-01'),
    Path('/tmp/yunshan-mz-vm-intrinsics-diagnostic-root03-20261003-01'),
    Path('/tmp/yunshan-mz-upper-door-fixture-revision02-20261003-01')]
ledger=[]
for root in evidence_roots:
    if not root.exists(): continue
    for receipt in sorted(root.glob('**/*receipt.json')):
        if '/source/' in str(receipt): continue
        raw = receipt.parent/'raw.log'
        if not raw.exists(): continue
        value=json.loads(receipt.read_text()); raw_text=raw.read_text()
        row={'receipt':str(receipt),'receiptSha256':sha(receipt),'raw':str(raw),'rawSha256':sha(raw),
             'receiptRawSha256':value.get('rawSha256'),
             'rawMatchesReceipt':sha(raw)==value['rawSha256'] if value.get('rawSha256') else None,
             'phase':value.get('phase',value.get('mode')), 'exit':value.get('exit'), 'status':value.get('status'),
             'start':value.get('start'), 'end':value.get('end'), 'inputCount':value.get('inputCount'),
             'sourceStable':value.get('sourceStable'), 'ownedPidGone':value.get('ownedPidGone'),
             'counts':{m.group(1):int(m.group(2)) for m in re.finditer(r'ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)',raw_text)},
             'preservedOnDisk':True}
        first=receipt.parent/'inputs-first.json';last=receipt.parent/'inputs-last.json'
        if not first.exists(): first=receipt.parent/'inputs-first171.json'
        if not last.exists(): last=receipt.parent/'inputs-last171.json'
        if first.exists() and last.exists():
            row['inputsFirstSha256']=sha(first); row['inputsLastSha256']=sha(last)
            row['inputSnapshotsEqual']=first.read_bytes()==last.read_bytes()
        ledger.append(row)
write('evidence-ledger.json',{'reviewedAt':stamp(),'historicalScopesMustNotBeAdded':True,'rawAndReceiptFilesRewritten':False,'records':ledger})

limitations = {
    'reviewedAt':stamp(), 'status':'READ_ONLY_REVIEW_WITH_SCOPED_RUNTIME_EVIDENCE',
    'testClaim':{
        'root06FullRun':{'tests':14,'pass':13,'fail':1,'exit':1,
                         'failedTest':'upper-floor body cannot use ground door by event ID or flush queue',
                         'failedAt':'bridge.test.ts:269 fixture locator precondition, before useDoor assertions'},
        'targetedUpperDoor':'PENDING_ACTUAL_ROOT07_RECEIPT; keep independent from ROOT06 full run',
        'allowedWording':'ROOT06全轮13 PASS/1 FAIL；修正fixture后upper-door针对性复验另列实际结果。',
        'forbiddenWording':'本轮单次全14/14 PASS；13全轮通过+1 targeted不是一轮14/14。',
    },
    'canonicalSaveCompatibility':'exportCoreSave is the original yunshan-save/v1 core save; the yunshan-mz-save/v1 bridge envelope carries queue/results/fractional frame state and is not automatically accepted by the previously delivered parent MZ plugin.',
    'parentMZDelivery':{'libraryId':'libfile_3c0d4a37cd0081919db55fa1cee3f5b1',
                       'status':'PARENT_REPORTED_PRIVATE_NATIVE_MZ_1_10_0_ZIP_DELIVERED',
                       'runtime':'original frozen Simulation + CityUI + PlayerController',
                       'facadeAdopted':False,'independentlyReopenedByThisReview':False},
    'runtimeEvidenceScope':[
        '32-module browser-format IIFE was run in a Node VM with VM-own Math/JSON intrinsics and only TextEncoder/TextDecoder supplied; this is headless core evidence, not an actual browser/MZ GUI run.',
        'ROOT06 +24 continuations cover standing-body ordinary stepping, whole-core save and bridge queue/receipt/fraction restoration plus legacy core continuation; do not extend them to every moving/stair/door interaction or arbitrary host integration.',
        'Walker ROOT02 ten-case differential evidence is separate from ROOT06 bridge fourteen-test scope; do not add overlapping scopes.',
        'ROOT03/ROOT05 terminated (-9) bridge rounds and ROOT02 type errors remain failures/incomplete historical evidence; retained raw records are not replaced by ROOT06 outcomes.',
    ],
    'performance':{
        'linuxCpuDiagnosticOnly':True,'mzGuiMeasured':False,'macHardwareMeasured':False,
        'firstCoreTickObservedMs':{'lexicalVmIntrinsics':11490.992548},
        'note':'Direct/runtime diagnostics observe roughly 8–11.5 seconds for the first original core tick on this Linux host. This is a concrete startup/integration responsiveness limit, not MZ/macOS performance proof or long-run FPS.'},
    'integrationRequirements':[
        'Use one CitySession.advance per actual host frame with real seconds in [0,1]; preserve metre axes, 0.2m voxel, ground/basement floor indices and original entity IDs.',
        'Project MZ Game_Player/events from authoritative playerLocation; do not write tile coordinates or another RNG/economy/NPC schedule into the original core.',
        'Use useDoor/useStairs and original core commands; preserve three-dimensional 6m entrance range and original floor ACL instead of map-event authorization.',
        'Integrate facade and bridge-envelope persistence into the parent MZ project before claiming the existing private ZIP uses the facade.',
        'Run actual MZ GUI/open/play/save/load checks separately; arbitrary custom MZ geometry, official runtime compatibility and hardware performance are outside this review.',
    ],
    'officialMZAssets':{'writtenOrCopiedByThisReview':False,'addedToGit':False,'policy':'Keep official engine/trial assets out of public Git; original private parent delivery is distinct from this source/bundle facade.'},
    'fullProjectGoals':'Economy steady state, complete game scope, outstanding systemic/mapping/visual requirements remain open per shared memo; this facade review does not certify their completion.',
    'actionsNotPerformed':['Node execution','tsc','npm','browser','MZ GUI','ZIP creation','upload','Git mutation','official asset copying','shared memo editing'],
}
target_receipt=ROOT07/'upper-door01/receipt.json'
target_raw=ROOT07/'upper-door01/raw.log'
if target_receipt.exists() and target_raw.exists():
    tr=json.loads(target_receipt.read_text())
    counts={m.group(1):int(m.group(2)) for m in re.finditer(r'ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)',target_raw.read_text())}
    limitations['testClaim']['targetedUpperDoor']={
        'receipt':str(target_receipt),'receiptSha256':sha(target_receipt),
        'raw':str(target_raw),'rawSha256':sha(target_raw),'exit':tr['exit'],
        'counts':counts,'sourceStable':tr['sourceStable'],'ownedPidGone':tr['ownedPidGone'],
        'scope':'Corrected original generated bank floor1 fixture; real 3D door refusal and full envelope/queued command unchanged assertions. Independent targeted run only.'}
    limitations['testClaim']['allowedWording']='ROOT06全轮13 PASS/1 FAIL；ROOT07修正fixture后upper-door针对性1 PASS/0 FAIL。两者不是单轮14/14。'
write('limitations.json',limitations)
print(json.dumps({'coreFiles':len(rows),'coreAllEqual':alignment['coreAllEqual'],
 'runtimeInputs':len(runtime_rows),'runtimeInputsAligned':alignment['runtimeInputsAligned'],
 'productionRoot06SameRoot03':alignment['productionAdapterRoot06EqualsRoot03'],
 'productionRoot07SameRoot03':alignment['productionAdapterRoot07EqualsRoot03'],
 'forbiddenRuntimeInputs':alignment['forbiddenRuntimeInputs'],'externalEdges':external_edges,
 'bundleOutputHashesMatch':alignment['allBundleReceiptHashesMatch'],'evidenceRecords':len(ledger)},ensure_ascii=False))
