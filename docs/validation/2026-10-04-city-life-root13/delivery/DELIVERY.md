# ROOT13 完整原件文件树去重交付

去重包已独立从两块分片重组，并在新的临时目录完整恢复 **26418 个常规文件、3043874458 字节**。恢复后实际重新读取每个文件 SHA/大小，四份独立来源文件图全部一致。CAS ZIP 的全部 1336 个成员也通过 SHA/大小/CRC，内嵌 INDEX 与四份来源图逐字一致。

ZIP：`yunshan-root13-complete-original-tree-cas.zip`，**68695513 字节**，SHA256 `7f094f7bdd643b077eceaf823900fff94e6893c454e12841e36981694b29281d`。它有 1331 份唯一内容（未压缩共 301212136 字节），通过 `objects/<sha256>` 及完整 path→size/SHA 映射保留所有重复路径。两块可选分片上限为 64 MiB，完整有序名字/大小/SHA 见 `DELIVERY-MANIFEST.json`。

这是原路径和原文件完整字节恢复，不重造历史完整 ZIP 的压缩字节、文件时间/权限或空目录。旧 13 组完整 ZIP/16 块、独立 v8 ZIP/2 块和全部 PASS 回执仍在原冻结组，未修改。合并图明确是原 **26,189** 个文件再加审计 **209** 个及站点设计 **20** 个，共 **26,418**，没有沿用旧计数。

| 独立来源图 | 原文件数 | 原始字节 | 独立恢复核验 |
|---|---:|---:|---|
| ORIGINAL-13-FILEMAP.json | 24030 | 2781156653 | PASS |
| ORIGINAL-V8-FILEMAP.json | 2159 | 251788729 | PASS |
| SUPPLEMENTAL-SCOPE-REPORT-FILEMAP.json | 209 | 6102177 | PASS |
| SUPPLEMENTAL-BOARDING-DESIGN-FILEMAP.json | 20 | 4826899 | PASS |

两份 supplemental 图先实读并核对各生产者的完整 regular tree 等于原 manifest 加 manifest/CLOSED 本身，恢复后又读取还原出的原 manifest/CLOSED 进行独立核对。所有源文件在打包前后实际读取 SHA 并完全一致。相同完整内容只存一次；凭据形状扫描实际覆盖 1331 个对象及 21 个不同展开内容（22 个 gzip），发现数 **0**。该检查只针对记录的字节形状，不扩大为语义安全审计。

## 使用

将 `DELIVERY-MANIFEST.json`、`INDEX.json`、表中四份来源图、`RESTORE.py` 和完整 CAS ZIP 放到同一目录。Python 3/POSIX 文件系统需要支持 `dir_fd` / `O_NOFOLLOW`。运行：

```sh
python3 RESTORE.py --manifest DELIVERY-MANIFEST.json --directory . --output-tree restored-originals --receipt local-restore.json
```

只下载有序两块分片时，使用相同辅助文件并运行：

```sh
python3 RESTORE.py --manifest DELIVERY-MANIFEST.json --directory . --from-parts --reconstructed-zip reconstructed-cas.zip --output-tree restored-originals --receipt local-restore.json
```

新 ZIP 和回执路径不能已存在。恢复目录可为新目录；若已有目标文件，内容相同经 SHA 核验可复用，不同内容会停止并保持该文件原样。符号链接、非 regular 文件和越级/绝对路径被拒绝。恢复器不执行归档代码。四项真实 writer 检查的结果见 `RESTORER-SAFETY-CHECKS.json`：不同已有文件不覆盖、目录 symlink 不跟随、`..` 越级拒绝、同字节已有文件复用。

本次实际结果是 `RESTORE-VERIFICATION.json`（全部 26418 文件新建后重新读 SHA、四来源分别 PASS）。`DELIVERY-MANIFEST.json` 保留打包时 pending-restore 状态；恢复完成由独立回执和 `HANDOFF.json` / `CLOSED.json` 表达，不倒改早期回执。

## 范围与交付

当前 integrated 的新运行资料不在此包；父任务另行提供。包中 UI 初稿未执行，ROOT14 历史归档/站点方案是设计，v8 是 CPU 候选且站点出口阻碍保持。各原件中的失败、超时、实际受控前件、旧源版本和未运行项逐字保留。压缩和恢复校验不意味着这些系统已全部验收或全游戏完成。

本生产者没有运行项目模拟/测试/build/GPU，没有修改生产者原件，没有 Git/Library 操作；新 LibraryID 为 **0**。父任务负责实际上传并返回真实 LibraryID 或 Git 交付结果。完整 CAS ZIP 小于 100 MiB，可直接作为原件文件树交付；若使用分片，需按 manifest 全部下载。
