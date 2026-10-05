#!/usr/bin/env python3
"""Verify or reconstruct a Yunshan delivery using only its public manifest.

Reads the public manifest, filemaps, archive bytes and archive parts. Never
extracts or executes an archived file. Uses only the Python standard library.
"""

import argparse
import hashlib
import json
import os
import pathlib
import stat
import sys
import zipfile
import zlib

PAYLOAD_MAP_NAME = 'ORIGINAL-FILEMAP.json'


class VerificationError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def safe_relative(value):
    require(isinstance(value, str) and value and '\\' not in value and '\x00' not in value,
            'Unsafe relative file name.')
    path = pathlib.PurePosixPath(value)
    require(not path.is_absolute() and all(part not in ('', '.', '..') for part in value.split('/')),
            'Unsafe relative file name.')
    return path


def public_filename(value):
    path = safe_relative(value)
    require(len(path.parts) == 1, 'Expected a single public artifact filename.')
    return value


def file_identity(path):
    info = path.stat(follow_symlinks=False)
    require(stat.S_ISREG(info.st_mode), 'Expected a regular artifact file.')
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


def sha_record(path):
    before = file_identity(path)
    digest = hashlib.sha256()
    count = 0
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            count += len(chunk)
            digest.update(chunk)
    require(file_identity(path) == before and count == before[2], 'Artifact changed while reading.')
    return {'bytes': count, 'sha256': digest.hexdigest()}


def expected_record(value):
    require(isinstance(value, dict) and isinstance(value.get('bytes'), int) and value['bytes'] >= 0,
            'Invalid public artifact size.')
    digest = value.get('sha256')
    require(isinstance(digest, str) and len(digest) == 64 and all(char in '0123456789abcdef' for char in digest),
            'Invalid public artifact SHA256.')
    return {'bytes': value['bytes'], 'sha256': digest}


def guarded_path(directory, value):
    name = public_filename(value['name'])
    path = directory / name
    require(path.is_file() and not path.is_symlink(), 'Missing regular artifact: ' + name)
    require(sha_record(path) == expected_record(value), 'Artifact SHA/size mismatch: ' + name)
    return path


def load_manifest(path):
    require(path.is_file() and not path.is_symlink(), 'Missing regular public manifest.')
    before = file_identity(path)
    with path.open('r', encoding='utf-8') as stream:
        manifest = json.load(stream)
    require(file_identity(path) == before, 'Public manifest changed while reading.')
    require(manifest.get('schemaVersion') == 1 and manifest.get('status') == 'ARCHIVES_VERIFIED_LIBRARY_NOT_ATTEMPTED',
            'Unsupported or incomplete archive manifest.')
    for key in ('sourceZIP', 'originalZIP', 'sourceFilemap', 'originalFilemap', 'publicVerifier'):
        require(key in manifest, 'Missing public artifact metadata.')
        expected_record(manifest[key])
        public_filename(manifest[key]['name'])
    require(isinstance(manifest.get('parts'), list) and manifest['parts'], 'Public part order is missing.')
    names = [public_filename(item['name']) for item in manifest['parts']]
    require(len(names) == len(set(names)), 'Duplicate archive part filename.')
    part_bytes = manifest.get('partBytes')
    require(part_bytes == 64 * 1024 * 1024, 'Unexpected archive part size.')
    for index, item in enumerate(manifest['parts']):
        expected_record(item)
        require(0 < item['bytes'] <= part_bytes, 'Invalid archive part byte count.')
        if index < len(manifest['parts']) - 1:
            require(item['bytes'] == part_bytes, 'Only the final part may be short.')
    require(sum(item['bytes'] for item in manifest['parts']) == manifest['originalZIP']['bytes'],
            'Part sizes do not sum to the original ZIP size.')
    return manifest


def verify_zip(path, filemap_path, archive_record):
    # SHA over the entire ZIP precedes parsing any archive payload.
    require(sha_record(path) == expected_record(archive_record), 'Whole ZIP SHA/size mismatch.')
    map_identity = file_identity(filemap_path)
    map_bytes = filemap_path.read_bytes()
    require(file_identity(filemap_path) == map_identity, 'Public filemap changed while reading.')
    payload_map = json.loads(map_bytes)
    require(payload_map.get('schemaVersion') == 1 and isinstance(payload_map.get('files'), dict),
            'Invalid public filemap.')
    expected_files = payload_map['files']
    for name, expected in expected_files.items():
        safe_relative(name)
        require(name != PAYLOAD_MAP_NAME, 'Payload manifest cannot list itself.')
        expected_record(expected)
    archive_identity = file_identity(path)
    with zipfile.ZipFile(path, 'r') as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)) == len(expected_files) + 1, 'ZIP contains duplicate or unexpected members.')
        require(set(names) == set(expected_files) | {PAYLOAD_MAP_NAME}, 'ZIP member set differs from the public filemap.')
        for name in names:
            safe_relative(name)
            info = archive.getinfo(name)
            require(not info.is_dir(), 'This archive contract contains only regular payload files.')
            # No extract(), import, subprocess, or execution is used.
            digest = hashlib.sha256()
            count = 0
            crc = 0
            with archive.open(info) as stream:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
                    count += len(chunk)
                    crc = zlib.crc32(chunk, crc)
            require((crc & 0xffffffff) == info.CRC, 'ZIP member CRC mismatch.')
            expected = ({'bytes': len(map_bytes), 'sha256': hashlib.sha256(map_bytes).hexdigest()}
                        if name == PAYLOAD_MAP_NAME else expected_files[name])
            require({'bytes': count, 'sha256': digest.hexdigest()} == expected_record(expected),
                    'ZIP member SHA/size mismatch: ' + name)
        require(archive.read(PAYLOAD_MAP_NAME) == map_bytes, 'Embedded manifest differs from its public filemap.')
    require(file_identity(path) == archive_identity and file_identity(filemap_path) == map_identity,
            'ZIP or public filemap changed during verification.')
    return {'name': archive_record['name'], 'bytes': archive_record['bytes'], 'sha256': archive_record['sha256'],
            'verifiedPayloadFiles': len(expected_files), 'verifiedZIPMembers': len(expected_files) + 1,
            'allMemberSHA256AndCRCVerified': True, 'archiveCodeExecuted': False, 'filesExtracted': False}


def reconstruct(directory, manifest, destination):
    require(not destination.exists() and not destination.is_symlink(), 'Output already exists; no file will be overwritten.')
    require(destination.parent.is_dir(), 'Output parent directory is missing.')
    temporary = destination.with_name(destination.name + '.partial')
    require(not temporary.exists() and not temporary.is_symlink(), 'A partial output already exists; choose another new output name.')
    digest = hashlib.sha256()
    count = 0
    checked_parts = []
    created_temporary = False
    owned_temporary_identity = None

    def remove_owned_temporary():
        try:
            info = temporary.stat(follow_symlinks=False)
        except FileNotFoundError:
            return
        if stat.S_ISREG(info.st_mode) and (info.st_dev, info.st_ino) == owned_temporary_identity:
            temporary.unlink()

    try:
        with temporary.open('xb') as output:
            created_temporary = True
            info = os.fstat(output.fileno())
            owned_temporary_identity = info.st_dev, info.st_ino
            for part in manifest['parts']:
                path = guarded_path(directory, part)
                before = file_identity(path)
                part_digest = hashlib.sha256()
                part_count = 0
                with path.open('rb') as stream:
                    while chunk := stream.read(1024 * 1024):
                        # Re-hash the same bytes actually written into the reconstruction.
                        part_digest.update(chunk)
                        part_count += len(chunk)
                        digest.update(chunk)
                        count += len(chunk)
                        output.write(chunk)
                require(file_identity(path) == before, 'Archive part changed during reconstruction.')
                require({'bytes': part_count, 'sha256': part_digest.hexdigest()} == expected_record(part),
                        'Written archive part differs from the public manifest.')
                checked_parts.append(part['name'])
            output.flush()
            os.fsync(output.fileno())
        require({'bytes': count, 'sha256': digest.hexdigest()} == expected_record(manifest['originalZIP']),
                'Concatenated parts SHA/size mismatch.')
        require(file_identity(temporary)[:2] == owned_temporary_identity,
                'Our temporary reconstruction was replaced; no replacement will be removed.')
        # Open the final name exclusively rather than replace() / rename-overwrite.
        with temporary.open('rb') as stream, destination.open('xb') as output:
            while chunk := stream.read(1024 * 1024):
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        require(sha_record(destination) == expected_record(manifest['originalZIP']), 'Final reconstruction SHA/size mismatch.')
        remove_owned_temporary()
    except Exception:
        # Remove only our new temporary file. Preserve any final partial output for diagnosis.
        if created_temporary and temporary.exists():
            remove_owned_temporary()
        raise
    return destination, {'status': 'ALL_PARTS_AND_CONCATENATED_SHA256_VERIFIED', 'parts': checked_parts,
                         'concatenatedBytes': count, 'concatenatedSHA256': digest.hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=pathlib.Path, required=True)
    parser.add_argument('--directory', type=pathlib.Path, default=pathlib.Path('.'))
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--from-parts', action='store_true')
    modes.add_argument('--verify-only', action='store_true')
    parser.add_argument('--output', type=pathlib.Path, help='New reconstructed ZIP path; valid only with --from-parts.')
    parser.add_argument('--verify-source', action='store_true', help='Also verify the source ZIP against its public filemap.')
    args = parser.parse_args()
    require(args.from_parts or args.output is None, '--output requires --from-parts.')
    directory = args.directory.absolute()
    require(directory.is_dir(), 'Public artifact directory is missing.')
    manifest = load_manifest(args.manifest)
    require(sha_record(pathlib.Path(__file__)) == expected_record(manifest['publicVerifier']),
            'This verifier differs from the file bound by the public manifest.')
    original_map = guarded_path(directory, manifest['originalFilemap'])
    if args.from_parts:
        destination = (args.output.absolute() if args.output else directory / manifest['originalZIP']['name'])
        original_zip, part_verification = reconstruct(directory, manifest, destination)
    else:
        original_zip = guarded_path(directory, manifest['originalZIP'])
        part_verification = {'status': 'NOT_CHECKED_WHOLE_ZIP_MODE', 'reason': 'No part verification is claimed in --verify-only mode.'}
    result = {'status': 'VERIFIED', 'originalZIP': verify_zip(original_zip, original_map, manifest['originalZIP']),
              'parts': part_verification, 'sourceZIP': {'status': 'NOT_REQUESTED'},
              'archiveCodeExecuted': False, 'filesExtracted': False}
    if args.verify_source:
        source_zip = guarded_path(directory, manifest['sourceZIP'])
        source_map = guarded_path(directory, manifest['sourceFilemap'])
        result['sourceZIP'] = verify_zip(source_zip, source_map, manifest['sourceZIP'])
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except (VerificationError, OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        message = str(error) if isinstance(error, VerificationError) else ('Verification stopped: ' + type(error).__name__ + '.')
        print(message, file=sys.stderr)
        sys.exit(1)
