import datetime, gzip, hashlib, json, pathlib, re, stat, zipfile

out = pathlib.Path(__file__).parent
archive = out / 'yunshan-E1-course-original-evidence-20261003.zip'
assert not archive.exists()
index = pathlib.Path('/tmp/yunshan-education-e1-original-index-20261003/archive-paths03.txt')
paths = set()
excluded_links = []
for line in index.read_text().splitlines():
    p = pathlib.Path(line.strip())
    assert p.is_absolute() and p.exists(), str(p)
    if p.is_symlink():
        excluded_links.append(str(p))
    elif p.is_file():
        paths.add(p)

roots = [
    '/tmp/yunshan-education-e1-original-index-20261003',
    '/tmp/yunshan-education-course-revision04-17-01',
    '/tmp/yunshan-education-history-window-causal-20261003',
    '/tmp/yunshan-education-persistence-artifact-repair-20261003',
    '/tmp/yunshan-system-coherent-18',
    '/tmp/yunshan-education-dom-prep-root18-20261003',
    '/tmp/yunshan-education-dom-revision02-20261003',
    '/tmp/yunshan-education-dom-canvas-revision02-readonly-review-20261003',
    '/workspace/yunshan/docs/validation/2026-10-03-education-e1-readonly',
]
def visit(directory):
    for p in sorted(directory.iterdir()):
        if p.is_symlink():
            excluded_links.append(str(p))
        elif p.is_dir():
            assert p.name not in {'.git', 'node_modules'}, str(p)
            visit(p)
        elif p.is_file():
            paths.add(p)
for root in roots:
    visit(pathlib.Path(root))
assert paths and all('node_modules' not in p.parts and '.git' not in p.parts for p in paths)
assert not any('library-current' in str(p) or p.name == 'library_file_transfer.py' for p in paths)
dom = json.loads(pathlib.Path('/tmp/yunshan-system-coherent-18/education-dom-02/result.json').read_text())
assert dom['state'] == 'PASS_CONTROLLED_EDUCATION_DOM6' and len(dom['results']) == 6
build = json.loads(pathlib.Path('/tmp/yunshan-system-coherent-18/build-receipt.json').read_text())
assert build['state'] == 'PASS_FRESH_BUILD' and build['exitCode'] == 0
patterns = {
    'tripo-key': rb'tsk_[A-Za-z0-9_-]{20,}',
    'openai-key': rb'sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}',
    'aws-access-id': rb'(?:AKIA|ASIA)[A-Z0-9]{16}',
    'private-key': rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'bearer-value': rb'(?i)authorization["\x27 ]*\s*:\s*["\x27 ]*Bearer\s+[A-Za-z0-9._-]{20,}',
    'google-oauth': rb'ya29\.[A-Za-z0-9_-]{24,}',
    'signed-query': rb'https?://[^\s"\x27]+[?&](?:X-Amz-Signature|X-Goog-Signature|sig|token)=[A-Za-z0-9%._-]{12,}',
}
compiled = {key: re.compile(value) for key, value in patterns.items()}
rows, content, hits = [], {}, {name: 0 for name in compiled}
for p in sorted(paths):
    data = p.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    member = 'originals/' + str(p).lstrip('/')
    row = {'member': member, 'originalPath': str(p), 'bytes': len(data), 'sha256': digest, 'kind': 'original-byte-copy'}
    rows.append(row)
    for name, pattern in compiled.items():
        hits[name] += len(pattern.findall(data))
    if p.suffix == '.gz':
        decoded = gzip.decompress(data)
        for name, pattern in compiled.items():
            hits[name] += len(pattern.findall(decoded))
    content[member] = data
assert not any(hits.values()), 'Private credential/URL pattern detected; preserve inputs and do not upload.'
readme = '''# 云山教育E1 · 完整原件交付

本包保存实际源码、构建、驱动、日志、存档、截图与失败事实，不把不同版本测试相加成完整游戏完成。

最新实际集成源码位于 originals/tmp/yunshan-system-coherent-18/source：125输入/120共享执行文件。新构建exit0，生产入口index-BlbDqBpw.js、692224B。教育课程40文托管、真实1份教材采购、教师工资窗口覆盖60分钟、离场暂停/手动续课、取消未赚款退款与教材复用、成绩经验各一次、分区保存和原子导入校验已实现。

最终候选REV04：strict0；原历史时间B2完全同字节修后1/1和24逐相位续演；正常保存时间5/5；分区/合成钱包容量/受控死亡偿债6/6，125源首尾一致。合法旧root17无课程档10模块和24逐步exact另在原03/02范围验证，不冒新的现场结果。

原03：相关97/97、原科研40PASS/2显式旧档skip；七原suite156 PASS/0断言FAIL且exit0，但persistence after-hook EACCES必须保留。独立相同124源副本仅外部artifacts软链，persistence26/26和真实21条报告成功，补报告不改写原错误。

真实界面DOM02：6/6、exit0/errors[]、272默认1x十阶段tick/68单调分钟/4实际按钮命令。原老师citizen-26、原钱/needs/角色/材料/速度/工资不改，只有明示一次到岗定位。教材采购净额/税、部分1.25分钟取消退35.25、再次40入学复用、60课堂分钟消费1、成绩经验+1及另24tick无重复均验。截图是CityUI和原二维小地图；页面执行Vite转换的源码，验证新dist但没有执行生产入口、Renderer、3D/ART/macOS或普通spawn通勤。

DOM01原错误canvas=0断言FAIL原件保；它已完成全部课程与+24业务断言。DOM02仅把外部画布oracle改为原CityUI真实420x270已绘制二维minimap，业务断言/前后字节/wrapper均同，独立只读审查原件保。

本包保留old15瞬间授课真实FAIL、首5e语法transform FAIL、仅修一个括号后的真实8/4共同时间FAIL、REV02原25=24PASS/1墙边夹具FAIL与单独修后1PASS、各strict/短scope缺失现场清单事实、历史64/60 B2真实FAIL、原七套EACCES、两轮DOM及全部后修原件。旧已生成dist是各自历史构建，原03首131输入包含继承dist不是教育新build。旧19b补丁序列化缺无newline标记原件保，canonical可审补丁在revision04/reviewable-final，SHA118c7f49c4ec8cf8bb25104abb7aa9724f00afc3f2929e13a6b97d49fcedab1a；实际源码字节未改。

archived教育汇总不认证任意历史；钱包容量测试为明确守恒合成开户，死亡测试为受控死亡，不冒自然财富/死亡。完整教育课程、儿童自然教育、科研物料设备协作、能源电网、疾病卫生病毒、政治制度深度、产权买租重开、拆迁路网与空间火震、经济稳态/美术/Mac/流式仍未完成。

original-files.json逐原文件映射及SHA；SHA256SUMS核对成员。依赖软链均排除，不跟随node_modules；源码可另装正常依赖。全部原件的实际身份/时点/范围以各不可变回执为准。Library保存结果在包外公开交付回执，不能在ZIP创建时凭空写成功ID。
'''.encode()
filemap = (json.dumps({'originalCount': len(rows), 'files': rows, 'excludedSymlinks': sorted(set(excluded_links))}, ensure_ascii=False, indent=2) + '\n').encode()
content['README.md'] = readme
content['original-files.json'] = filemap
content['SHA256SUMS'] = ''.join(hashlib.sha256(data).hexdigest() + '  ' + name + '\n' for name, data in sorted(content.items())).encode()
with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for name, data in sorted(content.items()):
        z.writestr(name, data)
    assert z.testzip() is None
for row in rows:
    assert hashlib.sha256(pathlib.Path(row['originalPath']).read_bytes()).hexdigest() == row['sha256'], row['originalPath']
receipt = {'state': 'PRODUCED_AND_CRC_VERIFIED', 'writtenAtUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'producer': '/root', 'archivePath': str(archive), 'archiveBytes': archive.stat().st_size,
    'archiveSHA256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'members': len(content),
    'originalByteCopies': len(rows), 'originalBytes': sum(row['bytes'] for row in rows),
    'originalFilesStableAfterArchive': True, 'CRC': 'PASS', 'credentialPatterns': hits,
    'manifestSHA256': hashlib.sha256(filemap).hexdigest(), 'excludedSymlinks': sorted(set(excluded_links)),
    'LibraryState': 'NOT_UPLOADED', 'noLibraryIDInvented': True}
(out / 'production-receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
(out / 'original-files.json').write_bytes(filemap)
(out / 'README.md').write_bytes(readme)
print(json.dumps(receipt, ensure_ascii=False), flush=True)
