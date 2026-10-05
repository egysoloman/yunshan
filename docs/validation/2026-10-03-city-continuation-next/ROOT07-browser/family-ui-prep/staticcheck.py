#!/usr/bin/env python3
"""Read-only artifact/SHA/text checks; never import or run the application."""

import gzip
import hashlib
import json
import pathlib
import sys


BASE = pathlib.Path(__file__).resolve().parent
NATIVE = BASE / "originals/producer-native-evidence"
PRODUCER = BASE / "originals/producer-final-source"
RUNTIME = BASE / "originals/root07-runtime55"
EXPECTED_UI_SHA = "0a5b600ea4be90b4f5aaa0c919a4a999a7bf84245c13bc7dd39dac31493deecf"
EXPECTED_MANIFEST_SHA = "a1973816aa4df8d580155767641a6565f182219ec7e4bb9896fff624515220cb"
EXPECTED_ARCHIVE_SHA = "d69684b57c0f24ff1571acd1b85954fce799bce4e251e745c9c0ca01e89e9ea9"
EXPECTED_PATCH_SHA = "32f3c26b2af6b57ab817fba533d76f8375161b5108d03ae5c3c625be16cdba6d"
FIXTURES = {
    "ui-world.json": (6032, "983612f2783926d51285d2b33249bc424ca32b7a30079507a8c3f6f559386eb2"),
    "ui-opening.save.json": (444557, "a6f1ae16a11222fbbf9ceffa620c2bf2d4e703e9c0f4fcd9faab7d5a4bb224ef"),
    "ui-controls.json": (78397, "d6de9ad58df8c7b2ba7a436e601028f5e2e914d8bff039146ac97aab00bcdff1"),
}
LABEL_TOKENS = [
    "原保有资格 / 旧到校记录",
    "新增正式学时只来自真实教材与实际教师完成的课程。",
    "你不是该居民当前已登记的法定监护人，不能新代签；原付款权利继续保留。",
    "新的签约仍核验当前法定监护关系。",
    "我原先实付的子女课程",
    "active.payerId !== 'player'",
]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_bytes())


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_file(path, expected, size=None):
    require(path.is_file(), f"Missing original/input: {path}")
    data = path.read_bytes()
    require(digest(data) == expected, f"SHA256 mismatch: {path}")
    if size is not None:
        require(len(data) == size, f"Byte-count mismatch: {path}")
    return data


def original7(text):
    start = text.index("  const card =")
    end = text.index("} catch (error) {", start)
    return text[start:end]


def html_template(text):
    start = text.index("  const html = `")
    end = text.index("</script></body></html>`;", start)
    return text[start:end + len("</script></body></html>`;")]


def prep_file_records(value):
    """Check explicit local path+sha records without executing manifest content."""
    checked = []
    if isinstance(value, list):
        for child in value:
            checked.extend(prep_file_records(child))
    elif isinstance(value, dict):
        rel = value.get("archivedPath", value.get("path", value.get("file")))
        expected = value.get("sha256")
        if isinstance(rel, str) and isinstance(expected, str):
            path = pathlib.Path(rel)
            if not path.is_absolute():
                path = BASE / path
            verify_file(path, expected, value.get("bytes"))
            checked.append(str(path))
        for child in value.values():
            if isinstance(child, (dict, list)):
                checked.extend(prep_file_records(child))
    return checked


def main():
    require(len(sys.argv) <= 3, "Usage: staticcheck.py [SOURCE [PREPARATION_MANIFEST]]")
    auth = read_json(BASE / "originals/root07-input-authorization.json")
    source = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else auth["sourcePath"]).resolve()
    prep_path = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else BASE / "preparation-manifest.json"
    preparation = read_json(prep_path)
    require(preparation["status"] == "PREPARED_NOT_RUN", "Preparation must retain PREPARED_NOT_RUN status")
    require(pathlib.Path(preparation["sourcePath"]).resolve() == source, "Preparation/source path mismatch")
    require(preparation["root07Inputs"] == auth["inputs"], "Preparation/authorization input hashes differ")
    require(preparation["root07InputCount"] == 241 and preparation["root07RuntimeSourceCount"] == 55, "ROOT07 preparation input counts differ")
    require(preparation["producerFinalSourceManifestEntries"] == 219 and preparation["producerFinalRuntimeSourceCount"] == 53, "Producer preparation input counts differ")
    require(all(preparation[key] == 0 for key in ["browserRuns", "gpuRuns", "buildRuns", "ruleTestRuns"]), "Preparation cannot claim an actual application run")
    require(len(preparation["archivedFiles"]) == 319, "Preparation archived file count changed")
    prep_records = prep_file_records(preparation)
    require(len(prep_records) >= 319, "Preparation archive file records were not checked")

    manifest_path = NATIVE / "FINAL_SOURCE_MANIFEST.json"
    verify_file(manifest_path, EXPECTED_MANIFEST_SHA)
    manifest = read_json(manifest_path)
    require(len(manifest["files"]) == 219, "Original producer manifest must contain 219 files")
    for item in manifest["files"]:
        verify_file(PRODUCER / item["file"], item["sha256"], item["bytes"])
    producer_runtime_count = sum(item["file"].startswith("src/") for item in manifest["files"])
    require(producer_runtime_count == 53, "Producer runtime source count changed")

    archive_path = NATIVE / "ARCHIVE_MEMBER_SHA256.json"
    verify_file(archive_path, EXPECTED_ARCHIVE_SHA)
    archive = {item["file"]: item for item in read_json(archive_path)["files"]}
    native_count = 0
    for path in sorted(NATIVE.rglob("*")):
        if not path.is_file() or path == archive_path:
            continue
        rel = "output/family-fee-education/" + path.relative_to(NATIVE).as_posix()
        require(rel in archive, f"Native archive member missing from original manifest: {rel}")
        item = archive[rel]
        verify_file(path, item["sha256"], item["bytes"])
        native_count += 1

    for rel, expected in auth["inputs"].items():
        verify_file(source / rel, expected)
    actual_source = set()
    for directory in ["src", "tests", "scripts", "adapters", "public"]:
        for path in (source / directory).rglob("*"):
            require(not path.is_symlink(), f"Unexpected frozen input symlink: {path}")
            if path.is_file():
                actual_source.add(path.relative_to(source).as_posix())
    for name in ["package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "index.html"]:
        path = source / name
        require(not path.is_symlink(), f"Unexpected frozen input symlink: {path}")
        if path.is_file():
            actual_source.add(name)
    require(actual_source == set(auth["inputs"]), "ROOT07 source input file set differs from authorization")
    source_runtime = {rel: sha for rel, sha in auth["inputs"].items() if rel.startswith("src/")}
    require(len(source_runtime) == 55, "ROOT07 runtime must contain 55 src inputs")
    for rel, expected in source_runtime.items():
        verify_file(RUNTIME / rel, expected)
    actual_runtime = {path.relative_to(RUNTIME).as_posix() for path in RUNTIME.rglob("*") if path.is_file()}
    require(actual_runtime == set(source_runtime), "ROOT07 archived runtime file set differs from authorization")
    ui_bytes = verify_file(source / "src/ui.ts", EXPECTED_UI_SHA)
    ui = ui_bytes.decode("utf-8")
    for token in LABEL_TOKENS:
        require(token in ui, f"Static UI label/guard token missing: {token}")
    for token in preparation["existingUILabelTokens"]:
        require(token in ui, f"Preparation UI label/guard token missing: {token}")
    require(preparation["uiSHA256"] == EXPECTED_UI_SHA, "Preparation UI SHA differs")

    for name, (size, expected) in FIXTURES.items():
        verify_file(NATIVE / name, expected, size)
    patch = verify_file(NATIVE / "family-fee-ui-verification-scripts.patch", EXPECTED_PATCH_SHA)
    require(preparation["originalVerificationPatchSHA256"] == EXPECTED_PATCH_SHA, "Preparation producer patch SHA differs")
    original_bytes = verify_file(PRODUCER / "scripts/family-fee-ui-test.mjs", "f3959f90b2b2812aaaabc2125fdc35498a45ed4d5bad99bcc7cffe514c2391f8")
    require(digest(original_bytes) == preparation["originalScriptSHA256"], "Preparation original script SHA differs")
    original = original_bytes.decode("utf-8")
    driver = verify_file(BASE / "family-fee-ui-root07.mjs", preparation["externalDriverSHA256"]).decode("utf-8")
    verify_file(BASE / "external-adaptation.diff", preparation["adaptationDiffSHA256"])
    verify_file(BASE / "run-phase-v2-original.py", preparation["wrapperSHA256"])
    block = original7(original)
    require(original7(driver) == block, "Original7 assertion block changed")
    require(digest(block.encode("utf-8")) == preparation["originalSevenAssertionBlockSHA256"] == preparation["adaptedSevenAssertionBlockSHA256"], "Preparation original7 block SHA differs")
    require(html_template(driver) == html_template(original), "Original HTML template changed")
    require(block.count("results.push(") == 7, "Original7 result count differs")
    require(block.index("const saveCheck =") < block.index("{alive:false,health:0}"), "Original canceled-before-death saveCheck order changed")
    require(all(name in driver for name in FIXTURES), "Driver fixture routes/names missing")
    require("createRequire" in driver and ("configFile: false" in driver or "configFile:false" in driver), "External dependency/config routing missing")
    require("cacheDir" in driver and "vite-cache" in driver, "External Vite cache routing missing")

    legacy_dir = PRODUCER / "tests/fixtures/family-fee-v1"
    legacy = read_json(legacy_dir / "metadata.json")
    require(len(legacy["files"]) == 3, "Original oldreader fixture count changed")
    for item in legacy["files"]:
        raw = gzip.decompress(verify_file(legacy_dir / item["file"], item["gzipSha256"]))
        require(len(raw) == item["rawBytes"] and digest(raw) == item["rawSha256"], "Original oldreader raw mismatch")
        original_raw = NATIVE / "legacy-original-prior-source" / item["file"].removesuffix(".gz")
        require(raw == original_raw.read_bytes(), "Oldreader gzip does not preserve original captured raw bytes")

    return {
        "status": "STATIC_CHECK_PASS",
        "runtimeStatus": "NOT_RUN",
        "scope": "Artifact/SHA/text equality only; no application import, browser, build or test execution",
        "driverVersionChecked": "v1; separate v2 evidence must retain its own diff and checks",
        "source": str(source),
        "preparationManifest": str(prep_path),
        "preparationExplicitFileRecordsChecked": len(prep_records),
        "producerFilesChecked": 219,
        "producerRuntimeFilesChecked": producer_runtime_count,
        "nativeArchiveMembersChecked": native_count,
        "authorizedSourceFilesChecked": len(auth["inputs"]),
        "root07RuntimeFilesChecked": len(source_runtime),
        "original7BlockByteExact": True,
        "original7Count": 7,
        "originalHtmlByteExact": True,
        "cancelSaveCheckPrecedesControlledDeath": True,
        "labelsStaticOnly": LABEL_TOKENS,
        "labelsAddedToOriginal7Evidence": False,
        "oldreaderFixturesChecked": 3,
        "producerPatchSHA256": digest(patch),
    }


if __name__ == "__main__":
    try:
        report = main()
    except Exception as error:
        print(json.dumps({"status": "STATIC_CHECK_FAIL", "runtimeStatus": "NOT_RUN", "error": str(error)}, ensure_ascii=False, indent=2))
        sys.exit(1)
    print(json.dumps(report, ensure_ascii=False, indent=2))
