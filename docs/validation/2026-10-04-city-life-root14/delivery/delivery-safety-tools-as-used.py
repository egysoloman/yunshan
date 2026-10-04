#!/usr/bin/env python3
"""Read a parent-authorized frozen evidence cut; never run project code.

Only this delivery directory is written. Original files are read using stable
regular-file identities, checked before/after, and never normalized or edited.
"""
import datetime
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile
import tarfile

BASE = Path('/workspace/yunshan-work')
OUT = Path(__file__).resolve().parent
PART_BYTES = 64 * 1024 * 1024
GROUPS = (
    'ROOT13-budget-authority-20261004-01',
    'ROOT13-food-supply-20261004-01',
    'ROOT13-shop-repeat-20261004-01',
    'ROOT13-ruleset-core-20261004-01',
    'ROOT13-natural-civic-staffing-20261004-01',
    'ROOT13-interior-light-20261004-01',
    'ROOT13-interior-gpu-capture-20261004-01',
    'ROOT13-road-owner-match-20261004-01',
    'ROOT13-scene-ray-owner-20261004-01',
    'ROOT13-street-authority-v7-20261004-01',
    'ROOT13-integration-review-20261004-01',
    'ROOT14-civic-history-design-20261004-01',
    'ROOT13-civic-feedback-ui-20261004-01',
)
PATTERNS = (
    ('tripo-secret-shape', re.compile(rb'tsk_[A-Za-z0-9_-]{20,}')),
    ('github-personal-token-shape', re.compile(rb'github_pat_[A-Za-z0-9_]{20,}')),
    ('github-classic-token-shape', re.compile(rb'gh[pousr]_[A-Za-z0-9]{20,}')),
    ('aws-access-key-shape', re.compile(rb'(?:AKIA|ASIA)[0-9A-Z]{16}')),
    ('openai-secret-shape', re.compile(rb'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}')),
    ('bearer-literal-shape', re.compile(rb'(?i)\bBearer[ \t]+[A-Za-z0-9._~+/-]{24,}')),
    ('private-key-block', re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----')),
    ('credential-json-literal', re.compile(rb'(?i)["\'](?:access_token|refresh_token|client_secret|api_key)["\']\s*:\s*["\'][A-Za-z0-9._~+/-]{24,}["\']')),
    ('signed-or-tokenized-url', re.compile(rb'(?i)https?://[^\s<>"\'`]{1,8192}[?&](?:X-Amz-Signature|X-Amz-Credential|X-Goog-Signature|X-Goog-Credential|access_token|refresh_token|token|sig|signature)=[A-Za-z0-9%._~+/-]{12,}')),
)


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def write_json(name, value):
    with (OUT / name).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def safe_name(name):
    require(isinstance(name, str) and name and '\\' not in name and '\x00' not in name,
            'Unsafe relative member name')
    p = PurePosixPath(name)
    require(not p.is_absolute() and all(x not in ('', '.', '..') for x in name.split('/')),
            'Unsafe relative member name')


def identity(path):
    s = path.stat(follow_symlinks=False)
    require(stat.S_ISREG(s.st_mode), 'Expected regular file: ' + path.name)
    return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns


def record(path):
    before = identity(path)
    h = hashlib.sha256()
    count = 0
    with path.open('rb') as stream:
        while block := stream.read(1024 * 1024):
            h.update(block)
            count += len(block)
    require(before == identity(path) and count == before[2], 'File changed while reading: ' + path.name)
    return {'bytes': count, 'sha256': h.hexdigest()}


def inventory():
    files, exclusions, groups = {}, [], []
    for group in GROUPS:
        directory = BASE / group
        require(directory.is_dir() and not directory.is_symlink(), 'Missing regular frozen group: ' + group)
        c = 0
        for root, dirs, names in os.walk(directory, followlinks=False):
            dirs.sort()
            names.sort()
            root = Path(root)
            for name in list(dirs):
                path = root / name
                rel = path.relative_to(BASE).as_posix()
                if name in ('node_modules', '.git') or name.lower().startswith('private') or path.is_symlink():
                    dirs.remove(name)
                    exclusions.append({'path': rel, 'kind': 'directory-or-link', 'reason':
                                       'dependency, git, private namespace, or symlink; never followed'})
            for name in names:
                path = root / name
                rel = path.relative_to(BASE).as_posix()
                safe_name(rel)
                if name in ('node_modules', '.git') or name.lower().startswith('private') or path.is_symlink():
                    exclusions.append({'path': rel, 'kind': 'file-or-link', 'reason':
                                       'dependency, git, private namespace, or symlink; never followed'})
                    continue
                require(stat.S_ISREG(path.lstat().st_mode), 'Unexpected non-regular entry: ' + rel)
                require(rel not in files, 'Duplicate member: ' + rel)
                files[rel] = path
                c += 1
        closed = directory / 'CLOSED.json'
        groups.append({'name': group, 'regularFileCount': c,
                       'freezeAuthority': 'producer CLOSED.json' if closed.is_file() else
                           'parent explicitly authorized final frozen/ended producer',
                       'classification': 'UNEXECUTED_UI_PROTOTYPE' if group == GROUPS[-1] else
                           ('DESIGN_ONLY_NOT_IMPLEMENTED' if group.startswith('ROOT14-') else 'FROZEN_ORIGINAL_EVIDENCE'),
                       'closedRecord': record(closed) if closed.is_file() else None})
    return files, sorted(exclusions, key=lambda x: x['path']), groups


def snapshot(files):
    return {name: record(path) for name, path in sorted(files.items())}


def scan_stream(stream, label, findings, stats):
    tail = b''
    offset = 0
    last_end = {}
    while block := stream.read(1024 * 1024):
        stats['scannedBytes'] += len(block)
        data = tail + block
        base_offset = offset - len(tail)
        for kind, expression in PATTERNS:
            for match in expression.finditer(data):
                end = base_offset + match.end()
                if end > last_end.get(kind, -1):
                    findings.append({'path': label, 'kind': kind})
                    last_end[kind] = end
        offset += len(block)
        tail = data[-16384:]


def safety_scan(files, original_snapshot):
    findings = []
    stats = {'regularFilesCoveredWithFreshSHA256': 0, 'uniqueRegularContentsScanned': 0,
             'regularContentReuseCount': 0, 'uniqueByteContentsScannedIncludingNested': 0,
             'nestedContentReuseCount': 0, 'gzipContainersExpanded': 0,
             'zipContainersExpanded': 0, 'expandedZipMembersCovered': 0, 'scannedBytes': 0}
    byte_cache = {}
    regular_keys = set()

    def bounded_read(stream):
        data = stream.read(256 * 1024 * 1024 + 1)
        require(len(data) <= 256 * 1024 * 1024, 'Nested payload exceeds safety scan limit; stop rather than omit')
        return data

    def scan_content(data, depth=0):
        key = (len(data), hashlib.sha256(data).hexdigest())
        if key in byte_cache:
            stats['nestedContentReuseCount'] += 1
            return byte_cache[key]
        require(depth <= 8, 'Nested compression depth exceeds safety scan limit; stop rather than omit')
        local = []
        scan_stream(io.BytesIO(data), '', local, stats)
        stats['uniqueByteContentsScannedIncludingNested'] += 1
        # Recognize containers by their bytes, including extensionless payloads.
        # Any recognized unsupported format stops the delivery rather than being
        # silently treated as unexpanded bytes.
        if data.startswith(b'\x1f\x8b\x08'):
            with gzip.GzipFile(fileobj=io.BytesIO(data), mode='rb') as stream:
                decoded = bounded_read(stream)
            stats['gzipContainersExpanded'] += 1
            for finding in scan_content(decoded, depth + 1):
                local.append({'path': '::gzip' + finding['path'], 'kind': finding['kind']})
        elif data.startswith((b'PK\x03\x04', b'PK\x05\x06', b'PK\x07\x08')):
            with zipfile.ZipFile(io.BytesIO(data), 'r') as archive:
                stats['zipContainersExpanded'] += 1
                for member in archive.infolist():
                    if member.is_dir():
                        continue
                    safe_name(member.filename)
                    with archive.open(member) as stream:
                        decoded = bounded_read(stream)
                    stats['expandedZipMembersCovered'] += 1
                    for finding in scan_content(decoded, depth + 1):
                        local.append({'path': '::zip/' + member.filename + finding['path'], 'kind': finding['kind']})
        elif data[257:262] == b'ustar':
            with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as archive:
                seen = set()
                for member in archive.getmembers():
                    safe_name(member.name)
                    require(member.name not in seen, 'Duplicate tar member')
                    seen.add(member.name)
                    if member.isdir():
                        continue
                    require(member.isfile() or member.islnk(), 'Unsafe non-file tar member')
                    if member.islnk():
                        safe_name(member.linkname)
                        require(member.linkname in seen and member.linkname != member.name, 'Unsafe tar hardlink')
                    with archive.extractfile(member) as stream:
                        decoded = bounded_read(stream)
                    for finding in scan_content(decoded, depth + 1):
                        local.append({'path': '::tar/' + member.name + finding['path'], 'kind': finding['kind']})
        elif data.startswith((b'\xfd7zXZ\x00', b'BZh', b'7z\xbc\xaf\x27\x1c')):
            raise RuntimeError('Unsupported recognized nested compression/archive format; stop rather than omit')
        byte_cache[key] = local
        return local

    for index, (name, path) in enumerate(sorted(files.items()), 1):
        before = identity(path)
        # Every regular source file is actually re-read and SHA-checked here.
        # Only exactly identical bytes reuse a previously scanned result.
        actual = record(path)
        require(actual == original_snapshot[name], 'Original changed before safety scan: ' + name)
        key = (actual['bytes'], actual['sha256'])
        if key in regular_keys:
            stats['regularContentReuseCount'] += 1
            result = byte_cache[key]
        else:
            with path.open('rb') as stream:
                data = bounded_read(stream)
            require((len(data), hashlib.sha256(data).hexdigest()) == key, 'Safety scan read differs from source SHA: ' + name)
            result = scan_content(data)
            stats['uniqueRegularContentsScanned'] += 1
            regular_keys.add(key)
        stats['regularFilesCoveredWithFreshSHA256'] += 1
        findings.extend({'path': name + row['path'], 'kind': row['kind']} for row in result)
        require(identity(path) == before, 'Original changed during safety scan: ' + name)
        if findings:
            break
        if index % 2000 == 0:
            print(json.dumps({'phase': 'safety-scan', 'filesCompleted': index}), flush=True)
    return {'schemaVersion': 1, 'status': 'PASS' if not findings else 'BLOCKED_LITERAL_SHAPES',
            'at': stamp(), 'scope': 'every regular source freshly SHA-read; identical byte content reuses complete literal scan; recursive gzip/zip recognized by magic; no semantic or antivirus claim',
            'patternKinds': [x[0] for x in PATTERNS], 'statistics': stats,
            'findingCount': len(findings), 'findings': findings,
            'sensitiveValuesPrinted': False, 'originalFilesModified': False}


def owned_process_guard(files):
    live, recognized = [], 0
    for name, path in files.items():
        if path.name not in ('owned-process.json', 'owned-descendants.json'):
            continue
        v = json.loads(path.read_text(encoding='utf-8'))
        if isinstance(v, dict):
            vals = [v.get('identity', v)]
        elif isinstance(v, list):
            vals = v
        else:
            continue
        for item in vals:
            if not isinstance(item, dict) or type(item.get('pid')) is not int:
                continue
            ticks = item.get('startTicks')
            if not ((type(ticks) is int) or (isinstance(ticks, str) and ticks.isdigit())):
                continue
            recognized += 1
            try:
                p = Path('/proc') / str(item['pid']) / 'stat'
                raw = p.read_text()
                fields = raw[raw.rfind(')') + 2:].split()
                if fields[0] != 'Z' and int(fields[19]) == int(ticks):
                    live.append({'recordPath': name, 'pid': item['pid'], 'startTicks': ticks})
            except (FileNotFoundError, ProcessLookupError):
                pass
    require(not live, 'A recognized frozen original owned process is still active; stop')
    return {'at': stamp(), 'recognizedPIDStartTimeRecords': recognized, 'recognizedActiveOwners': [],
            'limitation': 'unrecognized historical schemas and global unrelated processes are not certified'}


def write_archive(files, expected):
    name = 'yunshan-root13-frozen-originals.zip'
    path = OUT / name
    with zipfile.ZipFile(path, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
        for i, (rel, source) in enumerate(sorted(files.items()), 1):
            before = identity(source)
            info = zipfile.ZipInfo(rel, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info._compresslevel = 1
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            h, count = hashlib.sha256(), 0
            with source.open('rb') as stream, archive.open(info, 'w', force_zip64=True) as payload:
                while block := stream.read(1024 * 1024):
                    payload.write(block)
                    h.update(block)
                    count += len(block)
            require(identity(source) == before and {'bytes': count, 'sha256': h.hexdigest()} == expected[rel],
                    'Original changed while archiving: ' + rel)
            if i % 2000 == 0:
                print(json.dumps({'phase': 'archive', 'filesCompleted': i}), flush=True)
        archive.write(OUT / 'ORIGINAL-FILEMAP.json', 'ORIGINAL-FILEMAP.json')
    return {'name': name, **record(path)}


def main():
    started = stamp()
    require(OUT.name == 'ROOT13-originals-delivery-20261004-01', 'Wrong output namespace')
    files, exclusions, groups = inventory()
    initial = snapshot(files)
    write_json('SOURCE-SNAPSHOT-BEFORE.json', {'schemaVersion': 1, 'at': stamp(), 'files': initial})
    write_json('EXCLUSIONS.json', {'schemaVersion': 1, 'exclusions': exclusions})
    safety = safety_scan(files, initial)
    write_json('SAFETY-REPORT.json', safety)
    require(safety['findingCount'] == 0, 'Literal credential or signed URL shapes found; archive not created; see paths-only safety report')
    process_guard = owned_process_guard(files)
    map_value = {'schemaVersion': 1, 'kind': 'frozen-producer-originals', 'at': stamp(),
                 'groups': groups, 'regularFileCount': len(initial), 'payloadBytes': sum(x['bytes'] for x in initial.values()),
                 'files': initial, 'unexecutedPrototypeGroup': GROUPS[-1],
                 'excludedNamespacesAndLinks': exclusions,
                 'currentIntegratedAndV8GroupsIncluded': False, 'projectCodeExecutedByPackager': False,
                 'originalsChangedByPackager': False}
    write_json('ORIGINAL-FILEMAP.json', map_value)
    archive = write_archive(files, initial)
    files_after, exclusions_after, groups_after = inventory()
    final = snapshot(files_after)
    write_json('SOURCE-SNAPSHOT-AFTER.json', {'schemaVersion': 1, 'at': stamp(), 'files': final})
    require(initial == final and exclusions == exclusions_after and groups == groups_after,
            'Frozen source inventory differs before/after; reject archive')
    parts = []
    with (OUT / archive['name']).open('rb') as stream:
        for i in range(1, 100000):
            data = stream.read(PART_BYTES)
            if not data:
                break
            name = archive['name'] + '.part' + str(i).zfill(3)
            with (OUT / name).open('xb') as part:
                part.write(data)
            parts.append({'name': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    manifest = {'schemaVersion': 1, 'status': 'PACKAGED_PENDING_INDEPENDENT_RESTORE', 'startedAt': started,
                'endedAt': stamp(), 'groupCount': len(GROUPS), 'originalRegularFiles': len(initial),
                'originalPayloadBytes': sum(x['bytes'] for x in initial.values()),
                'zipMemberCount': len(initial) + 1, 'originalZIP': archive, 'partBytes': PART_BYTES, 'parts': parts,
                'originalFilemap': {'name': 'ORIGINAL-FILEMAP.json', **record(OUT / 'ORIGINAL-FILEMAP.json')},
                'publicVerifier': {'name': 'RESTORE.py', **record(OUT / 'RESTORE.py')},
                'safetyReport': {'name': 'SAFETY-REPORT.json', **record(OUT / 'SAFETY-REPORT.json')},
                'beforeSnapshot': {'name': 'SOURCE-SNAPSHOT-BEFORE.json', **record(OUT / 'SOURCE-SNAPSHOT-BEFORE.json')},
                'afterSnapshot': {'name': 'SOURCE-SNAPSHOT-AFTER.json', **record(OUT / 'SOURCE-SNAPSHOT-AFTER.json')},
                'sourceBeforeAfterMemberSizeSHA256Equal': True, 'ownedProcessGuard': process_guard,
                'zipCompressionLevel': 1, 'Library': {'status': 'NOT_ATTEMPTED_BY_THIS_PRODUCER', 'newLibraryIDs': []},
                'Git': {'status': 'NOT_ATTEMPTED_BY_THIS_PRODUCER'},
                'noSimulationTestsBuildGPUExecuted': True}
    write_json('DELIVERY-MANIFEST.json', manifest)
    print(json.dumps({'status': manifest['status'], 'groups': len(GROUPS), 'regularFiles': len(initial),
                      'ZIP': archive, 'parts': len(parts), 'beforeAfterEqual': True, 'literalSafetyFindings': 0}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Error messages only contain safe file paths, never the detected bytes.
        print(json.dumps({'status': 'BLOCKED', 'reason': str(exc), 'secretsPrinted': False}), file=sys.stderr)
        sys.exit(1)
