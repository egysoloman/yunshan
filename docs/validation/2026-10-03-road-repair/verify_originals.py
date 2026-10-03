"""Restore (if split) and verify the lossless evidence archive beside this file."""
from pathlib import Path
import hashlib, json, tempfile, zipfile

root=Path(__file__).resolve().parent
receipt=json.loads((root/'original-evidence-receipt.json').read_text())
hash_all=hashlib.sha256()
with tempfile.TemporaryDirectory(prefix='yunshan-road-evidence-verify-') as tmp:
 archive=Path(tmp)/receipt['archiveName']
 with archive.open('wb') as out:
  for item in receipt['files']:
   data=(root/item['name']).read_bytes()
   assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256'],item['name']
   hash_all.update(data);out.write(data)
 assert archive.stat().st_size==receipt['archiveBytes'] and hash_all.hexdigest()==receipt['archiveSha256']
 with zipfile.ZipFile(archive) as z:
  assert z.testzip() is None
  manifest=json.loads(z.read('payload-manifest.json'))
  assert len(z.namelist())==receipt['memberCount']==manifest['payloadCount']+1
  assert set(z.namelist())=={'payload-manifest.json'}|{r['member'] for r in manifest['files']}
  for item in manifest['files']:
   data=z.read(item['member'])
   assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256'],item['member']
print(json.dumps({'status':'ACTUAL_CRC_AND_ALL_MEMBER_SHA_PASS','members':receipt['memberCount'],'archiveSha256':hash_all.hexdigest()}))
