#!/usr/bin/env python3
"""Restore complete original file trees from CAS ZIP or ordered parts.

Uses only Python's standard library. Never runs archived code. Unsafe paths,
symlinks and mismatching existing files are refused. Matching existing files
may be reused after a fresh SHA check. Historical ZIP compression is not rebuilt.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import tempfile
import zipfile
import zlib


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def safe_name(name):
    require(isinstance(name, str) and name and '\\' not in name and '\x00' not in name,
            'Unsafe relative name')
    p = PurePosixPath(name)
    require(not p.is_absolute() and ':' not in p.parts[0] and
            all(x not in ('', '.', '..') for x in name.split('/')), 'Unsafe relative name')
    return p.parts


def public_name(name):
    require(len(safe_name(name)) == 1, 'Expected single public artifact filename')
    return name


def expected(value):
    require(isinstance(value, dict) and type(value.get('bytes')) is int and value['bytes'] >= 0,
            'Invalid expected size')
    digest = value.get('sha256')
    require(isinstance(digest, str) and len(digest) == 64 and all(c in '0123456789abcdef' for c in digest),
            'Invalid expected SHA256')
    return {'bytes': value['bytes'], 'sha256': digest}


def identity(path):
    value = path.stat(follow_symlinks=False)
    require(stat.S_ISREG(value.st_mode), 'Expected regular file')
    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns


def stream_record(stream):
    h, n = hashlib.sha256(), 0
    while data := stream.read(1024 * 1024):
        h.update(data); n += len(data)
    return {'bytes': n, 'sha256': h.hexdigest()}


def record(path):
    before = identity(path)
    with path.open('rb') as stream:
        value = stream_record(stream)
    require(before == identity(path) and value['bytes'] == before[2], 'File changed while reading')
    return value


def guarded(directory, value):
    path = directory / public_name(value['name'])
    require(record(path) == expected(value), 'Artifact differs from manifest: ' + value['name'])
    return path


def read_json(path):
    before = identity(path)
    data = path.read_bytes()
    require(before == identity(path), 'JSON changed while reading')
    return json.loads(data), data


def reconstruct(directory, manifest, output):
    require(output.parent.is_dir(), 'Reconstructed ZIP parent missing')
    require(not output.exists() and not output.is_symlink(), 'Reconstructed ZIP already exists')
    parts = manifest['parts']
    names = [public_name(p['name']) for p in parts]
    require(names and len(names) == len(set(names)), 'Invalid ordered parts')
    require(manifest['partBytes'] == 64 * 1024 * 1024, 'Invalid part maximum')
    require(sum(expected(p)['bytes'] for p in parts) == manifest['contentZIP']['bytes'], 'Part sum differs from ZIP')
    all_h, all_n = hashlib.sha256(), 0
    with output.open('xb') as destination:
        for i, part in enumerate(parts):
            require(0 < part['bytes'] <= manifest['partBytes'], 'Invalid part size')
            require(i == len(parts) - 1 or part['bytes'] == manifest['partBytes'], 'Non-final short part')
            path = directory / part['name']; before = identity(path)
            h, n = hashlib.sha256(), 0
            with path.open('rb') as stream:
                while data := stream.read(1024 * 1024):
                    h.update(data); n += len(data); all_h.update(data); all_n += len(data)
                    destination.write(data)
            require(before == identity(path) and {'bytes': n, 'sha256': h.hexdigest()} == expected(part), 'Part SHA/size mismatch')
        destination.flush(); os.fsync(destination.fileno())
    require({'bytes': all_n, 'sha256': all_h.hexdigest()} == expected(manifest['contentZIP']), 'Reconstructed CAS ZIP differs')
    require(record(output) == expected(manifest['contentZIP']), 'Reconstructed ZIP reread differs')
    return output, {'status': 'PASS', 'parts': names, 'wholeCASZIP': expected(manifest['contentZIP'])}


def validated_index(directory, manifest):
    index_path = guarded(directory, manifest['index'])
    index, index_data = read_json(index_path)
    require(index.get('schemaVersion') == 1 and index.get('contract') == 'complete-original-file-tree-bytes', 'Unsupported tree contract')
    require(index['fileCount'] == manifest['fileCount'] == len(index['files']), 'File count mismatch')
    require(index['objectCount'] == manifest['objectCount'] == len(index['objects']), 'Object count mismatch')
    require(index['sourceMaps'] == manifest['sourceMaps'], 'Source map references differ')
    combined, source_maps, metadata = {}, [], {'INDEX.json': index_data}
    for ref in index['sourceMaps']:
        path = guarded(directory, ref)
        value, data = read_json(path)
        require(isinstance(value.get('files'), dict), 'Source map missing paths')
        require(len(value['files']) == ref['originalRegularFiles'], 'Source map count mismatch')
        for name, row in value['files'].items():
            safe_name(name); expected(row)
            require(name not in combined, 'Overlapping original paths')
            combined[name] = row
        source_maps.append((ref, value))
        metadata[ref['name']] = data
    require(combined == index['files'], 'Complete index differs from independent original source maps')
    referenced = set()
    for name, row in index['files'].items():
        safe_name(name); value = expected(row); digest = value['sha256']
        require(digest in index['objects'], 'Missing referenced object')
        object_row = index['objects'][digest]
        require(expected(object_row) == value and object_row['member'] == 'objects/' + digest, 'Invalid object contract')
        referenced.add(digest)
    require(referenced == set(index['objects']), 'Unused or missing CAS object')
    for digest, row in index['objects'].items():
        require(expected(row)['sha256'] == digest and row['member'] == 'objects/' + digest, 'Unsafe CAS object key')
    return index, source_maps, metadata


def verify_and_cache(zip_path, manifest, index, metadata, cache):
    require(record(zip_path) == expected(manifest['contentZIP']), 'Complete CAS ZIP SHA/size mismatch')
    before = identity(zip_path)
    objects = {row['member']: row for row in index['objects'].values()}
    wanted = set(objects) | set(metadata)
    with zipfile.ZipFile(zip_path, 'r') as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)) and set(names) == wanted, 'Unexpected/duplicate ZIP members')
        for info in archive.infolist():
            safe_name(info.filename)
            require(not info.is_dir() and stat.S_ISREG((info.external_attr >> 16) & 0xffff), 'Non-regular ZIP member')
            h, n, crc = hashlib.sha256(), 0, 0
            output = (cache / info.filename.split('/')[1]).open('xb') if info.filename in objects else None
            try:
                with archive.open(info, 'r') as stream:
                    while data := stream.read(1024 * 1024):
                        h.update(data); n += len(data); crc = zlib.crc32(data, crc)
                        if output is not None: output.write(data)
            finally:
                if output is not None: output.close()
            require((crc & 0xffffffff) == info.CRC, 'ZIP member CRC mismatch')
            value = objects.get(info.filename)
            wanted_record = (expected(value) if value is not None else
                             {'bytes': len(metadata[info.filename]), 'sha256': hashlib.sha256(metadata[info.filename]).hexdigest()})
            require({'bytes': n, 'sha256': h.hexdigest()} == wanted_record, 'ZIP member SHA/size mismatch')
            if value is None:
                require(archive.read(info.filename) == metadata[info.filename], 'Embedded metadata is not byte-exact')
    require(before == identity(zip_path), 'CAS ZIP changed while reading')
    return {'status': 'PASS', 'zipMembers': len(wanted), 'objects': len(objects),
            'allMemberSizeSHA256CRCVerified': True, 'embeddedIndexAndFourSourceMapsExact': True}


def parent_fd(root_fd, components):
    current = os.dup(root_fd)
    try:
        for name in components:
            try: os.mkdir(name, 0o755, dir_fd=current)
            except FileExistsError: pass
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            os.close(current); current = child
        return current
    except Exception:
        os.close(current); raise


def restore_tree(output, index, cache):
    require(output.parent.is_dir(), 'Tree output parent missing')
    try: output.mkdir()
    except FileExistsError:
        require(stat.S_ISDIR(output.lstat().st_mode) and not output.is_symlink(), 'Tree destination is not a real directory')
    root_fd = os.open(output, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    created, reused = 0, 0
    try:
        for name, row in sorted(index['files'].items()):
            parts = safe_name(name); fd = parent_fd(root_fd, parts[:-1])
            try:
                try:
                    file_fd = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=fd)
                except FileExistsError:
                    require(stat.S_ISREG(os.stat(parts[-1], dir_fd=fd, follow_symlinks=False).st_mode),
                            'Existing destination is not a regular file')
                    file_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
                    with os.fdopen(file_fd, 'rb') as stream:
                        before = os.fstat(stream.fileno())
                        require(stat.S_ISREG(before.st_mode), 'Existing destination is not regular')
                        actual = stream_record(stream)
                        after = os.fstat(stream.fileno())
                        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'Existing file changed during check')
                    require(actual == expected(row), 'Existing destination differs; it was not overwritten: ' + name)
                    reused += 1; continue
                with os.fdopen(file_fd, 'wb') as destination, (cache / row['sha256']).open('rb') as source:
                    h, n = hashlib.sha256(), 0
                    while data := source.read(1024 * 1024):
                        destination.write(data); h.update(data); n += len(data)
                require({'bytes': n, 'sha256': h.hexdigest()} == expected(row), 'Copied object differs')
                created += 1
            finally:
                os.close(fd)
    finally:
        os.close(root_fd)
    actual = {}
    for root, ds, fs in os.walk(output, followlinks=False):
        for name in ds:
            require(not (Path(root) / name).is_symlink(), 'Restored tree contains symlink directory')
        for name in fs:
            path = Path(root) / name
            actual[path.relative_to(output).as_posix()] = record(path)
    require(actual == index['files'], 'Full reread of restored paths/bytes differs from index')
    return actual, {'status': 'PASS', 'createdFiles': created, 'reusedMatchingFiles': reused,
                    'allOriginalPathsAndFileBytesRereadSHA256Verified': True,
                    'existingMismatchingFilesOverwritten': False, 'symlinksFollowedInTree': False}


def per_source_verification(output, actual, source_maps):
    results = []
    for ref, value in source_maps:
        for name, row in value['files'].items():
            require(actual.get(name) == row, 'Restored file differs from its source map')
        if value.get('kind') == 'supplemental-frozen-originals':
            original_ref = value['originalProducerManifest']; closed_ref = value['producerClosed']
            require(record(output / original_ref['path']) == expected(original_ref), 'Restored original producer manifest differs')
            require(record(output / closed_ref['path']) == expected(closed_ref), 'Restored producer CLOSED differs')
            original, _ = read_json(output / original_ref['path'])
            rows = original.get('files', original)
            prefix = value['group'] + '/'
            expected_names = {prefix + name for name in rows} | {original_ref['path'], closed_ref['path']}
            require(expected_names == set(value['files']), 'Supplement derived set differs from its actual original manifest')
            for name, row in rows.items(): require(actual[prefix + name] == row, 'Supplement original manifest SHA differs')
        results.append({'sourceMap': ref['name'], 'fileCount': len(value['files']), 'status': 'PASS',
                        'everyOriginalPathSizeSHA256Verified': True})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--output-tree', type=Path, required=True)
    parser.add_argument('--from-parts', action='store_true')
    parser.add_argument('--reconstructed-zip', type=Path)
    parser.add_argument('--receipt', type=Path, required=True)
    args = parser.parse_args()
    require(args.from_parts == (args.reconstructed_zip is not None), '--from-parts requires --reconstructed-zip')
    manifest, _ = read_json(args.manifest)
    require(manifest.get('schemaVersion') == 1 and manifest.get('status') == 'PACKAGED_PENDING_INDEPENDENT_FILE_TREE_RESTORE', 'Unsupported delivery manifest')
    require(record(Path(__file__)) == expected(manifest['publicVerifier']), 'Verifier differs from public manifest')
    directory = args.directory.absolute()
    index, maps, metadata = validated_index(directory, manifest)
    if args.from_parts:
        zip_path, parts = reconstruct(directory, manifest, args.reconstructed_zip.absolute())
    else:
        zip_path = guarded(directory, manifest['contentZIP']); parts = {'status': 'NOT_REQUESTED_WHOLE_CAS_ZIP_MODE'}
    with tempfile.TemporaryDirectory(prefix='root13-cas-objects-') as name:
        cache = Path(name)
        zip_result = verify_and_cache(zip_path, manifest, index, metadata, cache)
        actual, tree = restore_tree(args.output_tree.absolute(), index, cache)
        source_results = per_source_verification(args.output_tree.absolute(), actual, maps)
    result = {'schemaVersion': 1, 'status': 'PASS', 'manifest': record(args.manifest),
              'verifier': record(Path(__file__)), 'reconstruction': parts, 'CASZIP': zip_result,
              'tree': tree, 'sourceMaps': source_results, 'originalFileCount': len(actual),
              'originalFileBytes': sum(row['bytes'] for row in actual.values()),
              'originalHistoricalZIPCompressionBytesRecreated': False,
              'archivedCodeExecuted': False, 'projectSimulationTestsBuildGPUExecuted': False,
              'LibraryOrGitAttempted': False}
    with args.receipt.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2); stream.write('\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'status': 'FAIL', 'reason': str(exc)}), file=sys.stderr)
        sys.exit(1)
