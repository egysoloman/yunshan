#!/usr/bin/env python3
"""Restore the complete original-evidence ZIP from verified Git byte parts."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    manifest = json.loads((root / 'original-evidence-parts.json').read_text())
    output = args.output.expanduser().absolute()
    if output.exists():
        parser.error('output already exists; choose a new path')
    digest = hashlib.sha256()
    total = 0
    with output.open('xb') as dest:
        for item in manifest['parts']:
            name = item['name']
            if Path(name).name != name:
                raise ValueError('invalid part name')
            part = root / name
            if part.is_symlink() or not part.is_file():
                raise ValueError('missing or invalid part')
            part_digest = hashlib.sha256()
            size = 0
            with part.open('rb') as source:
                while chunk := source.read(1024 * 1024):
                    part_digest.update(chunk)
                    digest.update(chunk)
                    dest.write(chunk)
                    size += len(chunk)
                    total += len(chunk)
            if size != item['bytes'] or part_digest.hexdigest() != item['sha256']:
                raise ValueError('part hash or size mismatch; output is incomplete')
    if total != manifest['zipBytes'] or digest.hexdigest() != manifest['zipSha256']:
        raise ValueError('archive hash or size mismatch; output is invalid')
    print(json.dumps({'status': 'RESTORED_BYTE_EXACT', 'bytes': total,
                      'sha256': digest.hexdigest(), 'output': str(output)}))


if __name__ == '__main__':
    main()
