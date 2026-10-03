import datetime, hashlib, json, pathlib, shutil

base = pathlib.Path('/tmp/yunshan-system-coherent-18')
shared = pathlib.Path('/workspace/yunshan')
candidate = pathlib.Path('/tmp/yunshan-education-course-revision04-17-01/frozen/source')
baseline = pathlib.Path('/tmp/yunshan-system-coherent-17/source')
manifest_path = candidate.parent / 'source-sha256.txt'
excluded = {'.gitattributes', '.gitignore', 'AGENTS.md', '开发备忘录.md', '提示词.md'}
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
expected_manifest = 'b8d5209b0629a0342aaf507b9ca008689557f3cb7570260e6fa769d0ce0be6f9'
assert sha(manifest_path) == expected_manifest
names = []
for line in manifest_path.read_text().splitlines():
    digest, name = line.split(None, 1)
    name = name.lstrip('*')
    assert not pathlib.PurePosixPath(name).is_absolute() and '..' not in pathlib.PurePosixPath(name).parts
    assert sha(candidate / name) == digest
    names.append(name)
assert len(names) == 125 and len(set(names)) == 125
changes = []
for name in names:
    if name in excluded:
        continue
    old, new, live = sha(baseline / name), sha(candidate / name), sha(shared / name)
    assert live == old, 'Preserve unexpected shared change: ' + name
    if old != new:
        changes.append({'path': name, 'baseline17SHA256': old, 'candidateSHA256': new})
assert len(changes) == 21
assert not (base / 'source').exists()
# Every mutation is guarded again immediately before its individual write.
for change in changes:
    target = shared / change['path']
    assert sha(target) == change['baseline17SHA256']
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes((candidate / change['path']).read_bytes())
    assert sha(target) == change['candidateSHA256']
source = base / 'source'
source.mkdir()
copied = {}
for name in names:
    target = source / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes((shared / name).read_bytes())
    target.chmod(0o444)
    copied[name] = sha(target)
    if name not in excluded:
        assert copied[name] == sha(candidate / name)
(source / 'node_modules').symlink_to(shared / 'node_modules', target_is_directory=True)
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
snapshot = {'createdAtUTC': now, 'sourceRoot': str(source), 'sourceShared': str(shared), 'copiedHashes': copied}
(base / 'source-snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
receipt = {'state': 'INTEGRATED_AND_FROZEN_NOT_BUILT', 'writtenAtUTC': now,
    'baselineRoot17': str(baseline), 'candidateRoot04': str(candidate), 'candidateManifestSHA256': expected_manifest,
    'sourceInputs': len(copied), 'sharedExecutableInputs': len(set(names) - excluded),
    'candidateExecutableExact': True, 'guardedChanges': changes,
    'preservedExcludedSharedFiles': sorted(excluded), 'noDirectoryOverwriteOrDependencyCopy': True,
    'scope': 'E1 attended courses, real escrow/procurement/refunds, actor capacity and import-only chronological guard. No energy candidate, M2 arrival-window fix, H2 pathology or dynamic-city completion.'}
(base / 'guarded-integration.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'state': receipt['state'], 'sourceInputs': len(copied), 'sharedExecutableInputs': receipt['sharedExecutableInputs'],
    'changedFiles': len(changes), 'snapshotSHA256': sha(base / 'source-snapshot.json')}, ensure_ascii=False))
