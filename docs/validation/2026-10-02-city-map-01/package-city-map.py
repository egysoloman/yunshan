from pathlib import Path
import hashlib, json, re, zipfile

root = Path('/tmp/yunshan-current-city-map-01')
names = [
    'README.md', 'world-native.json', 'city-census.json',
    'building-footprints.json', 'city-layers.geojson', 'buildings.csv',
    'transport-edges.csv', 'terrain-height-f64.bin', 'terrain-grid.json',
    'source-start.json', 'source-end.json', 'collection-manifest.json',
    'geometry-source-08-to-09-proof.json', 'collect-city-map.mjs',
    'collect.log', 'plot-city-map.py', 'plot-manifest.json',
    'plot-warnings.json', 'plot.log', 'city-map-preview.png',
    '云山巨城-当前城市设计图.png', '云山巨城-当前城市设计图.pdf',
    '云山巨城-市集与主阁局部.png', 'package-city-map.py',
]
def sha_file(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

# Explicit allowlist excludes private helpers, transfer replies and cache files.
patterns = [
    rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    rb'\bAKIA[0-9A-Z]{16}\b',
    rb'\bsk-[A-Za-z0-9_-]{20,}\b',
    rb'(?i)authorization\s*[:=]\s*["\x27]?bearer\s+[A-Za-z0-9._-]{15,}',
    rb'(?i)https?://[^\s"\x27<>]{1,1000}[?&](?:X-Amz-Signature|sig|signature|token)=',
]
failures=[]
for name in names:
    p=root/name
    if not p.is_file():
        raise RuntimeError('missing member: '+name)
    if p.suffix not in {'.png', '.pdf', '.bin'}:
        data=p.read_bytes()
        for i, pat in enumerate(patterns):
            if re.search(pat, data):
                failures.append({'file':name,'patternIndex':i})
if failures:
    raise RuntimeError('credential scan failed; names only: '+json.dumps(failures))

rows=[{'path':name,'bytes':(root/name).stat().st_size,'sha256':sha_file(root/name)} for name in names]
manifest={'status':'EXPLICIT_MEMBERS_HASHED','sourceFingerprint':'80cd31e2','members':rows,'credentialScan':{'matchedFiles':0,'patterns':len(patterns),'binaryFilesNotContentScanned':True,'privateDirectoriesExcluded':True}}
(root/'SHA256SUMS.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
zip_name='云山巨城-当前城市地图-原始数据.zip'
with zipfile.ZipFile(root/zip_name,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for name in names+['SHA256SUMS.json']:
        z.write(root/name,arcname=name)
with zipfile.ZipFile(root/zip_name,'r') as z:
    for row in rows:
        h=hashlib.sha256()
        with z.open(row['path']) as f:
            for chunk in iter(lambda:f.read(1024*1024),b''):
                h.update(chunk)
        if h.hexdigest()!=row['sha256']:
            raise RuntimeError('ZIP SHA mismatch: '+row['path'])
    if z.read('SHA256SUMS.json')!=(root/'SHA256SUMS.json').read_bytes():
        raise RuntimeError('ZIP manifest mismatch')
    zip_members=len(z.infolist())

small_names=[n for n in names if n not in {'building-footprints.json','city-layers.geojson'}]+['SHA256SUMS.json']
small_rows=[{'path':n,'bytes':(root/n).stat().st_size,'sha256':sha_file(root/n)} for n in small_names]
(root/'safe-copy-manifest.json').write_text(json.dumps({'status':'MAP_ALLOWLIST_ONLY','files':small_rows,'excluded':['private Library helpers/responses','plot font cache','building-footprints.json (in ZIP)','city-layers.geojson (in ZIP)'],'rawZIP':{'path':zip_name,'bytes':(root/zip_name).stat().st_size,'sha256':sha_file(root/zip_name),'members':zip_members,'allMemberSHA256Verified':True}},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':'ZIP_COMPLETE','zip':zip_name,'bytes':(root/zip_name).stat().st_size,'sha256':sha_file(root/zip_name),'members':zip_members,'rawBytes':sum(row['bytes'] for row in rows),'smallSafeCopyFiles':len(small_rows),'privateDataIncluded':False,'credentialMatches':0},ensure_ascii=False))
