import hashlib
import json
import pathlib
import re
import shutil
import datetime

temporary = pathlib.Path('/tmp/yunshan-home-four-module-fit-01')
workspace = pathlib.Path('/workspace/yunshan')
archive = workspace / 'docs/validation/2026-10-02-home-fallback-four-modules-01/geometry-audit'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
contract = json.loads((temporary / 'four-module-contract.json').read_text())
supplement = json.loads((temporary / 'geometry-audit-supplement.json').read_text())
source_start = {p: sha(workspace / p) for p in contract['sourceStart']}
assert source_start == contract['sourceStart'] == contract['sourceEnd'] == supplement['sourceEnd']
old_manifest = workspace / 'docs/validation/2026-10-02-upper-stair-support-01/cpu-contract/sha256-manifest.json'
old_sha = '9a7c77a99379cda416d2ae1c410e09836054ca30dbbcaf003a78f2d637446e9e'
assert sha(old_manifest) == old_sha
archive.mkdir(parents=True, exist_ok=True)
for p in temporary.iterdir():
    if p.is_file() and p.name != 'archive-geometry-audit.py':
        shutil.copyfile(p, archive / p.name)
shutil.copyfile(temporary / 'archive-geometry-audit.py', archive / 'archive-geometry-audit.py')
(archive / 'inputs').mkdir(exist_ok=True)
raw_path = pathlib.Path('/tmp/yunshan-home-pilot-bom-01/raw-counts.json')
assert sha(raw_path) == contract['rawBOMSHA256']
shutil.copyfile(raw_path, archive / 'inputs/raw-counts.json')
for relative in contract['sourceStart']:
    dest = archive / 'source-snapshot' / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(workspace / relative, dest)
    assert sha(dest) == contract['sourceStart'][relative]

provenance = {
    'recordedAtUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'archiveScope': str(archive),
    'productionEdited': False,
    'sourceStart': source_start,
    'sourceEnd': {p: sha(workspace / p) for p in source_start},
    'sourceUnchanged': True,
    'inputs': [{'archivedPath': 'inputs/raw-counts.json', 'originalPath': str(raw_path), 'sha256': sha(raw_path), 'bytes': raw_path.stat().st_size}],
    'contracts': [{'path': name, 'sha256': sha(archive / name)} for name in ['four-module-contract.json', 'geometry-audit-supplement.json']],
    'runs': [
        {'script': 'derive-four-modules.mts', 'log': 'static-derivation-final.log', 'observedExitCode': 0, 'elapsedMillisecondsInRawRecord': contract['elapsedMilliseconds'], 'scope': 'Original short static provider/body/part queries; stdout preserved. Original PTY argv was not separately persisted; do not count as a full test suite.'},
        {'script': 'derive-supplement.mts', 'argv': ['node', '--import', '/workspace/yunshan/node_modules/tsx/dist/loader.mjs', '/tmp/yunshan-home-four-module-fit-01/derive-supplement.mts'], 'stdoutAndStderrRedirect': '/tmp/yunshan-home-four-module-fit-01/static-supplement.log', 'log': 'static-supplement.log', 'observedExitCode': 0, 'scope': 'Two actual stair route bounds + native door coplane intersections + reference SHA verification; no W/GPU.'}
    ],
    'preservedFirstFailures': [
        {'log': 'static-derivation-first-failure-signedzero.log', 'reason': 'Original JSON normal -0 canonicalized to0; strict object comparison rejected. Current source parts equal original JSON serialization.'},
        {'log': 'static-derivation-first-door-edge-rejection.log', 'reason': 'Full .35 disk at front slab edge17.2 has no interior slab support. Interior sample scope reduced to16.8 and exterior whole-body support is explicitly NOT_AUDITED.'},
        {'log': 'static-supplement-first-reference-path-failure.log', 'observedExitCode': 1, 'reason': 'ENOENT because nonexistent geometry-audit directory was used before resolving ../references. path.resolve corrected the read path.'}
    ],
    'plannedModuleFamilies': 4,
    'computedCandidates': 4,
    'approvedInstalls': 0,
    'qualifiedReturnedMeshes': 0,
    'counts': {'interiorDoorwayStaticSupportSamples': 144, 'bonsaiStaticDiskSamples': 72, 'bonsaiCompleteSegmentCollisionChecks': 4, 'stairRouteConservativeBounds': 2},
    'unrun': ['new GLB mesh/texture inspection', 'GPU/GL/rendered coplane visibility', 'normal W traversal', 'full npm tests', 'long simulation', 'paid API/generation', 'asset installation'],
    'doorScope': 'Primary requested sample is open frame only CANDIDATE_ONLY. Hypothetical leaves separately require shared authority and conflict with detail6/7; original contract overall status includes those leaves.',
    'knownUnfixedWindow': contract['separateWindowDefect'],
    'parentModelReport': 'Technical15-fragment split/reassemblyPASS; art modulesFAIL/0 qualified, per parent report only. Root/auditor have not received original GLB.',
    'replayEnvironment': {'threeVersion': '0.180.0', 'tsx': 'project installed loader', 'note': 'Original executed scripts retain original absolute paths. Exact BOM and source snapshots are included; a replay must map imports/input/output to those copies and provide matching dependencies. No archive replay was run.'},
    'oldUpperStairArchive': {'manifestPath': str(old_manifest), 'manifestSHA256': old_sha, 'unchangedBeforeArchive': True, 'unchangedAfterArchive': sha(old_manifest) == old_sha},
    'referenceOriginals': supplement['referenceStyleMapping']['references'],
    'forbiddenWrites': ['src', 'tests', 'other docs', 'original45 stair files', 'private/credential files', 'Library', 'Git remotes']
}
assert provenance['sourceStart'] == provenance['sourceEnd']
(archive / 'provenance.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2)+'\n')

# Scan only authorized artifact members. Never print matched text or read keys.
patterns = {
    'common_live_secret_prefix': re.compile(rb'(?:sk_live_|sk_test_|sk-proj-|sk-ant-|tripo_sk_)[A-Za-z0-9_-]{16,}'),
    'github_token': re.compile(rb'(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}'),
    'aws_access_id': re.compile(rb'AKIA[0-9A-Z]{16}'),
    'bearer_value': re.compile(rb'(?i)authorization\s*[:=]\s*[\"\x27]?bearer\s+[A-Za-z0-9._-]{16,}'),
    'private_key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'signed_download': re.compile(rb'(?i)(?:X-Amz-Signature|X-Goog-Signature|[?&]signature)=[A-Za-z0-9%]{16,}')
}
scan_members = sorted(p for p in archive.rglob('*') if p.is_file() and p.name not in ['secret-pattern-scan.json', 'sha256-manifest.json'])
hits = [{'relativePath': str(p.relative_to(archive)), 'pattern': name, 'count': len(list(regex.finditer(p.read_bytes())))} for p in scan_members for name, regex in patterns.items() if regex.search(p.read_bytes())]
assert not hits
scan = {'status': 'PASS_PATTERN_SCAN_NO_MATCHES', 'valueOutput': False, 'privateFilesRead': False, 'patternNames': list(patterns), 'artifactFilesScannedBeforeOwnReports': len(scan_members), 'finalMembersIncludingScanAndManifest': len(scan_members)+2, 'hits': hits, 'scope': 'Pattern scan of authorized archive only; not a proof that all possible secrets were detected. Scan/manifest also rechecked after final creation.'}
(archive / 'secret-pattern-scan.json').write_text(json.dumps(scan, ensure_ascii=False, indent=2)+'\n')
members = sorted(p for p in archive.rglob('*') if p.is_file() and p.name != 'sha256-manifest.json')
inventory = [{'path': str(p.relative_to(archive)), 'bytes': p.stat().st_size, 'sha256': sha(p)} for p in members]
manifest = {'algorithm': 'sha256', 'selfExcluded': 'sha256-manifest.json', 'selfHashLocation': 'archive receipt printed to caller; no self-referential hash', 'members': inventory, 'hashedMemberCount': len(inventory), 'hashedTotalBytes': sum(m['bytes'] for m in inventory)}
(archive / 'sha256-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
for row in inventory:
    p=archive / row['path']
    assert p.stat().st_size == row['bytes'] and sha(p) == row['sha256']
all_members=sorted(p for p in archive.rglob('*') if p.is_file())
assert len(all_members) == scan['finalMembersIncludingScanAndManifest']
assert not any(regex.search(p.read_bytes()) for p in all_members for regex in patterns.values())
assert sha(old_manifest) == old_sha
receipt={'status':'ARCHIVED_VERIFIED', 'path':str(archive), 'memberCount':len(all_members), 'totalBytes':sum(p.stat().st_size for p in all_members), 'manifestSHA256':sha(archive/'sha256-manifest.json'), 'contractSHA256':sha(archive/'four-module-contract.json'), 'supplementSHA256':sha(archive/'geometry-audit-supplement.json'), 'sourceUnchanged':True, 'old45StairManifestUnchanged':True, 'secretPatternHits':0, 'approvedInstalls':0, 'qualifiedReturnedMeshes':0}
(temporary / 'archive-receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(receipt, ensure_ascii=False, indent=2))
