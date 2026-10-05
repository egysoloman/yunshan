# 云山 ROOT11 / ROOT12 原件恢复

这是 267 项执行输入、60 个生产源码文件的阶段归档。完整游戏目标仍未完成。当前源码、12 个具名原件 namespace 和原始失败／超时记录分别保留，历史 34 次 scope 缺少 25 种旧 path+SHA 的事实没有被本归档修复。

- 源码 ZIP：`Yunshan_ROOT12_Source_20261004.zip`，29785295 字节，SHA256 `37bb4917c0c984652874f5a13988ab145024e1c0a0cf7a5a11604b8844889194`。
- 全原件 ZIP：`Yunshan_ROOT11_ROOT12_All_Originals_20261004.zip`，353283217 字节，SHA256 `19c1d6593d8f77e94157a8f68c0a429e11123e378eadcb82079c2193700b2416`。
- `DELIVERY-MANIFEST.json` 记录本轮实际生成、验证和输入绑定。源码原件 ZIP 内的 `ORIGINAL-FILEMAP.json` 与公开 `SOURCE-FILEMAP.json` / `ORIGINALS-FILEMAP.json` 分别逐字对应。
- 仅具名 `node_modules` 依赖软链接不入原件 ZIP；具体排除项在 manifest 中。源码 ZIP 另外排除具名旧大型压缩包／分片，原件 ZIP 保留 12 组内的所有普通文件。

把公开 manifest、两个 filemap、恢复脚本和所有分片下载到同一个空目录。在该目录运行：

```sh
python3 restore-and-verify.py --manifest DELIVERY-MANIFEST.json --directory . --from-parts
```

脚本逐片验证 SHA 与大小，按 manifest 顺序重组一个新文件，再验证全 ZIP SHA、CRC 和所有原文件 SHA。它不覆盖现有文件、不解压、不执行归档中的任何代码。若已经下载完整 ZIP，可直接验证：

```sh
python3 restore-and-verify.py --manifest DELIVERY-MANIFEST.json --directory . --verify-only
python3 restore-and-verify.py --manifest DELIVERY-MANIFEST.json --directory . --verify-only --verify-source
```

第二条同时验证源码 ZIP。只有分片重组模式验证每片和合并结果；完整 ZIP 独立验证不冒充分片验证。恢复验证说明文件完整性，不替代游戏规则、美术、macOS 或长期经济验收。`Library` 和 `Git` 的实际保存／推送回执需另行读取，本生成器没有上传、创建附件或推送权限，也没有声称这些动作已经完成。

| 原件分片 | 字节 | SHA256 |
| --- | ---: | --- |
| Yunshan_ROOT11_ROOT12_All_Originals_20261004.zip.part01 | 67108864 | `a3abcff640442ca67febfac435c5d6be17ee48a3903f40db8d6c68ce7d86661f` |
| Yunshan_ROOT11_ROOT12_All_Originals_20261004.zip.part02 | 67108864 | `c1f4edd5bab1c1d4aa8a991f413002289aa592c6d4ec6822fa2177375e5d232c` |
| Yunshan_ROOT11_ROOT12_All_Originals_20261004.zip.part03 | 67108864 | `20c908f737f5553ea98941b9f4f987a35340e92fc066794321b0ee0eb8943631` |
| Yunshan_ROOT11_ROOT12_All_Originals_20261004.zip.part04 | 67108864 | `b26f9c6d80438241b43b0642abcdc5829b1be0644a5873958c6efaa123b6bea9` |
| Yunshan_ROOT11_ROOT12_All_Originals_20261004.zip.part05 | 67108864 | `eec91f58d4e19b008bc8d148cfd51cd1499aac4f66f42e5d4bba3da268b503c2` |
| Yunshan_ROOT11_ROOT12_All_Originals_20261004.zip.part06 | 17738897 | `cf7dd73b221cee1fd1201089772c92836a68fd9879a4c9ba9c3ed0ecbbbf0fb5` |
