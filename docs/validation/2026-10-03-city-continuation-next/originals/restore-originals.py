#!/usr/bin/env python3
"""Reconstruct the original evidence ZIP from its byte-exact Git parts."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def fail(message):
    raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--receipt', required=True, help='collection-receipt.json')
    parser.add_argument('--parts-dir', default='.')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    receipt = json.loads(Path(args.receipt).read_text())
    if receipt['status'] != 'VERIFIED_ORIGINALS':
        fail('Original archive did not pass its production guards')
    parts_dir, output = Path(args.parts_dir), Path(args.output)
    if output.exists():
        fail('Choose a new output file; existing work is preserved')
    archive_hash = hashlib.sha256()
    total = 0
    with output.open('xb') as destination:
        for index, expected in enumerate(receipt['parts'], 1):
            name = expected['name']
            if Path(name).name != name or not name.endswith('.part%03d' % index):
                fail('Part names must be consecutive and local')
            part = parts_dir / name
            if part.is_symlink() or not part.is_file():
                fail('Missing regular part: ' + name)
            h, size = hashlib.sha256(), 0
            with part.open('rb') as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    destination.write(chunk)
                    h.update(chunk)
                    archive_hash.update(chunk)
                    size += len(chunk)
            if size != expected['bytes'] or size > 64 * 1024 * 1024 or h.hexdigest() != expected['sha256']:
                fail('Part verification failed: ' + name)
            total += size
    if total != receipt['archive']['bytes'] or archive_hash.hexdigest() != receipt['archive']['sha256']:
        fail('Reconstructed archive SHA or byte count differs')
    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or len(names) != receipt['fileCount'] + 1:
            fail('Archive member count or unique names differ')
        if archive.testzip() is not None:
            fail('Archive CRC verification failed')
        manifest = json.loads(archive.read('ROOT_COLLECTION_MANIFEST.json'))
        if set(names) != set(manifest['files']) | {'ROOT_COLLECTION_MANIFEST.json'}:
            fail('Archive members differ from the complete original inventory')
        for name, expected in manifest['files'].items():
            h, size = hashlib.sha256(), 0
            with archive.open(name) as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    h.update(chunk)
                    size += len(chunk)
            if size != expected['bytes'] or h.hexdigest() != expected['sha256']:
                fail('Original member verification failed: ' + name)
    print(json.dumps({'status': 'VERIFIED_RECONSTRUCTION', 'bytes': total,
                      'sha256': archive_hash.hexdigest(), 'members': len(names)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
