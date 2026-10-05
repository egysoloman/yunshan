#!/usr/bin/env python3
"""Preserve authorized S1 original bytes; never execute any archived source."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time
import zipfile

BASE = Path(__file__).resolve().parent
TREE = BASE / 'payload'
ZIP = BASE / 'yunshan-S1-research-original-evidence-20261003.zip'
ROOTS = [
    ('original-coherent14', Path('/tmp/yunshan-system-coherent-14')),
    ('original-coherent15', Path('/tmp/yunshan-system-coherent-15')),
    ('isolated-preparation14', Path('/tmp/yunshan-research-attendance-prep-14-01')),
    ('original-causal-and-v21-repros', Path('/tmp/yunshan-research-attendance-repro-14-01')),
    ('final-isolated-S1-and-preserved-revisions', Path('/tmp/yunshan-research-attendance-fix-15-01')),
    ('root-coherent16-original-failure', Path('/tmp/yunshan-system-coherent-16')),
    ('root-coherent17-build-tests-and-controlled-DOM', Path('/tmp/yunshan-system-coherent-17')),
    ('readonly-research-reviews', Path('/tmp/yunshan-research-fix15-readonly-review-20261003')),
]
REVIEW_ROOT = Path('/tmp/yunshan-controller-static-review-20261003')
REVIEW_FILES = [
    'research-v31-save-legacy-suffix-static-review.md',
    'coherent14-mutable-city-world-static-review.md',
    'controller-yaw-static-review.md',
    'e1-education-save-boundary-static-review.md',
]
EXCLUDED_PARTS = {'node_modules', '.git', '__pycache__', '.pytest_cache'}
EXCLUDED_NAMES = {'.DS_Store', '.env', '.env.local', '.env.production'}
RULES = {
    'private-key-block': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
    'aws-access-key': re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'github-token': re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b'),
    'api-secret-token': re.compile(rb'\bsk-[A-Za-z0-9_-]{32,}\b'),
    'signed-transfer-url': re.compile(rb'https?://[^\s"<>]{1,2000}[?&](?:X-Amz-Signature|X-Goog-Signature|sig)=[A-Za-z0-9%]{16,}', re.I),
}


def sha(b):
    return hashlib.sha256(b).hexdigest()


def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def originals():
    exclusions = []
    files = []
    for label, root in ROOTS:
        if not root.is_dir():
            raise RuntimeError('Missing required source group: ' + str(root))
        for dirpath, dirs, names in os.walk(root, followlinks=False):
            d = Path(dirpath)
            kept = []
            for name in sorted(dirs):
                p = d / name
                if name in EXCLUDED_PARTS or p.is_symlink():
                    exclusions.append({'sourcePath': str(p), 'reason': 'dependency/cache or symlink; no file content copied'})
                else:
                    kept.append(name)
            dirs[:] = kept
            for name in sorted(names):
                p = d / name
                if p.is_symlink() or name in EXCLUDED_NAMES or 'xattrs' in name.lower() or name.startswith('.library'):
                    exclusions.append({'sourcePath': str(p), 'reason': 'symlink/private/environment/Library identity excluded'})
                    continue
                if not p.is_file():
                    continue
                files.append((label + '/' + p.relative_to(root).as_posix(), p))
    for name in REVIEW_FILES:
        p = REVIEW_ROOT / name
        if not p.is_file():
            raise RuntimeError('Missing specified readonly report: ' + str(p))
        files.append(('readonly-other-relevant-reports/' + name, p))
    return sorted(files), exclusions


def main():
    started = time.time()
    if TREE.exists() or ZIP.exists():
        raise RuntimeError('Fresh immutable archive destination required; do not overwrite prior delivery')
    TREE.mkdir(parents=True)
    files, exclusions = originals()
    members = []
    alerts = []
    for name, source in files:
        b = source.read_bytes()
        for rule, pat in RULES.items():
            if pat.search(b):
                alerts.append({'name': name, 'rule': rule})
        dest = TREE / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b)
        members.append({'name': name, 'sourcePath': str(source), 'sha256': sha(b), 'sizeBytes': len(b), 'kind': 'original-byte-copy'})
    save_json(BASE / 'privacy-scan.json', {'status': 'PASS' if not alerts else 'BLOCKED', 'scannedOriginalCount': len(files), 'rules': list(RULES), 'alerts': alerts, 'excluded': exclusions, 'matchedValuesNeverPrinted': True, 'scope': 'Targeted credential/signed-transfer pattern scan plus explicit source allowlist; no private helper/provider directories read or copied.'})
    if alerts:
        raise RuntimeError('Privacy scan blocked archive; see filename/rule-only receipt, no matching values emitted')
    root17 = json.loads(Path('/tmp/yunshan-system-coherent-17/build-related-run-status.json').read_text())
    root16 = json.loads(Path('/tmp/yunshan-system-coherent-16/build-related-run-status.json').read_text())
    current = json.loads(Path('/tmp/yunshan-research-attendance-fix-15-01/execution-manifest.json').read_text())
    dom1 = json.loads(Path('/tmp/yunshan-system-coherent-17/research-dom/result.json').read_text())
    dom2 = json.loads(Path('/tmp/yunshan-system-coherent-17/research-dom-02/result.json').read_text())
    readme = '''# 云山 S1 科研现场劳动：完整原件包

本包保存每次源版本、实际命令与原始失败，不执行包内代码。所有原文件的来源路径、包内路径、SHA-256 和字节数见 archive-manifest.json。常规 ZIP 直接解压即可，node_modules、缓存、私有 provider/helper、Library 元数据及签名传输内容不入包。

## 当前实际结果

- 最终隔离 S1：strict 退出0；40项有意义回归通过（联合运行另有2项旧来源检查明确跳过）、真实旧14档导入2/2、原同字节强反例3/3、相关定向50/50及一次 build 退出0。
- root coherent16：116归档输入/111执行输入，build0；相关96/97，1项原临床夹具失败，原日志完整保留；失败后未执行其科研联合组。
- root coherent17：116归档输入/111执行输入，build0、相关97/97；科研42总数中40通过/2项明确跳过。root没有在该联合命令中重复旧档捕获。
- 真实 CityUI + Simulation 原生研究按钮：第一次1/4后中止，脚本把真实0.5分钟错断言为8；修正原时间条件的第二次4/4通过。两次 as-run 驱动、回执、原 PNG、资源退出记录均保留。受控默认世界位置/资格前置，无 Renderer/GPU，不是普通步行旅程或自然全城科研。

## 保留的失败与版本边界

原14真实投入200后离开实验室120分钟仍自动升级的失败、v2.1三项强失败（低频研究少计、同一actor跨sector伪造容量、公共教育与科研同分钟重复）、原保存/provenance、首严格类型夹具错误、首次错误占用sector夹具、修正后真实latch命令失败、原相关21失败、原15零售时序oracle失败与首次迁移1失败都保留。v3/v3.1保存原件与最终795688版本分组，不把后来通过结果归到旧 SHA。历史 PREP/NOT_RUN 文案保持 as-of；当前实际执行以 current-delivery-README/execution-manifest 及 root16/17 原回执为准。

旧无marker档（包括没有pending任务）首次导入会一次写入模块marker与legacy名单，初始导出字节变化；新档/已迁移完整Tick档与后续24步完全一致。没有承诺 midphase 断点恢复。新科研具名actor与实际120有效分钟、现场身体净空/权限、单actor时间容量、真实计薪前段窗口、公共教学实际claim优先、保存suffix容量均有定向证据；旧legacy计时任务是明确兼容例外。

## 未验与剩余范围

未跑本阶段整套、全城长周期/自然第一夜、WebGL、Mac性能或美术验收，未声称城市稳态。科研耗材采购/消耗链仍缺；E1新课程生命周期仍为独立后续工作。只读附审中的早期地图/控制器/E1合同报告保留其原时间与状态，不冒当前S1执行结果。

本包的原件清单在创建后冻结。Library 保存结果另外交付公开最小回执，私有传输输出不入包。
'''
    (TREE / 'README.md').write_text(readme, encoding='utf-8')
    toolsdir = TREE / 'archive-tools'
    toolsdir.mkdir()
    shutil.copyfile(Path(__file__), toolsdir / 'produce-archive.py')
    shutil.copyfile(BASE / 'privacy-scan.json', toolsdir / 'privacy-scan.json')
    for rel in ['README.md', 'archive-tools/produce-archive.py', 'archive-tools/privacy-scan.json']:
        b = (TREE / rel).read_bytes()
        members.append({'name': rel, 'sourcePath': str((BASE / ('produce-archive.py' if rel.endswith('produce-archive.py') else 'privacy-scan.json'))) if rel.startswith('archive-tools/') else 'generated-current-summary', 'sha256': sha(b), 'sizeBytes': len(b), 'kind': 'archive-produced-document'})
    manifest = {'createdAtUTC': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'status': 'S1_SCOPED_PASS_WITH_PRESERVED_BASELINE_FAILURES', 'scope': 'Original sources, isolated candidates/revisions, every scoped actual receipt, old-origin pending save, readonly reviews, composite16/17 original builds/raw and controlled DOM PNG; no new source execution.', 'runtimePatchSHA256': current['runtimePatchSHA256'], 'integrationPatchSHA256': current['fullIntegrationPatchSHA256'], 'sourceEpochs': {'original14': '/tmp/yunshan-system-coherent-14', 'original15': '/tmp/yunshan-system-coherent-15', 'composite16': root16['manifestSHA256'], 'composite17': root17['manifestSHA256']}, 'actualStatus': {'isolated': current['finalScopes'], 'root16': {'state': root16['state'], 'exitCode': root16['exitCode'], 'related': {'total': 97, 'pass': 96, 'fail': 1}, 'sourceStable': root16['sourceStable']}, 'root17': {'state': root17['state'], 'exitCode': root17['exitCode'], 'related': {'total': 97, 'pass': 97}, 'research': {'total': 42, 'pass': 40, 'skip': 2}, 'sourceStable': root17['sourceStable']}, 'controlledDOM': {'first': {'state': dom1['state'], 'passBeforeFailure': len(dom1['results'])}, 'second': {'state': dom2['state'], 'pass': len(dom2['results'])}, 'scope': dom2['scope']}}, 'originalPayloadCount': len(files), 'originalPayloadBytes': sum(x['sizeBytes'] for x in members if x['kind'] == 'original-byte-copy'), 'listedMemberCount': len(members), 'manifestSelfExcludedFromMemberHashes': True, 'privacyScan': 'PASS; no matched secret values printed', 'excluded': exclusions, 'members': sorted(members, key=lambda x: x['name'])}
    save_json(TREE / 'archive-manifest.json', manifest)
    save_json(BASE / 'archive-manifest.json', manifest)
    with zipfile.ZipFile(ZIP, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
        for p in sorted(TREE.rglob('*')):
            if p.is_file():
                z.write(p, p.relative_to(TREE).as_posix())
    if ZIP.stat().st_size > 100 * 1024 * 1024:
        raise RuntimeError('ZIP exceeds single-file100MiB bound; preserve archive and produce explicit lossless parts next')
    original_changed = []
    with zipfile.ZipFile(ZIP) as z:
        bad = z.testzip()
        if bad:
            raise RuntimeError('CRC failed: ' + bad)
        for member in members:
            b = z.read(member['name'])
            if len(b) != member['sizeBytes'] or sha(b) != member['sha256'] or b != (TREE / member['name']).read_bytes():
                raise RuntimeError('ZIP member differs: ' + member['name'])
            if member['kind'] == 'original-byte-copy' and b != Path(member['sourcePath']).read_bytes():
                original_changed.append(member['name'])
        if original_changed:
            raise RuntimeError('Original files changed while archiving; preserve failed receipt: ' + str(original_changed))
        total = len(z.infolist())
    receipt = {'createdAtUTC': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'producerPID': os.getpid(), 'status': 'PASS_ARCHIVE_CRC_AND_EVERY_BYTE', 'zipPath': str(ZIP), 'zipSizeBytes': ZIP.stat().st_size, 'zipSHA256': sha(ZIP.read_bytes()), 'archiveManifestSHA256': sha((BASE / 'archive-manifest.json').read_bytes()), 'originalPayloadCount': len(files), 'zipMemberCount': total, 'allOriginalBytesMatchBeforeAfter': True, 'originalsChanged': original_changed, 'allZIPMembersMatchSHAAndBytes': True, 'crc': 'PASS', 'privacyScan': 'PASS', 'elapsedSeconds': time.time() - started, 'noNodeSimulationTestsBuildBrowserGPUExecuted': True, 'libraryStatus': 'NOT_YET_SAVED'}
    save_json(BASE / 'archive-verification.json', receipt)
    print(json.dumps(receipt, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
