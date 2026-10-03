# 云山动态城市服务阶段交付

本目录对应最终22共享实现，不代表完整游戏已完成。实现和验证范围见 [REPORT.md](REPORT.md)、[validation-results.json](validation-results.json)，完整剩余需求见 ../../需求实现验证矩阵.md。

- 150执行输入与最终22逐SHA一致；新构建通过。任命/治理20/20、真实政策表决及120分钟生效和24步完整保存通过；软件GPU75/75，14张实际截图。
- 美术仍FAIL；0新增合格外部3D模型。未新跑30/60日经济稳态、完整npm或macOS实机。旧失败记录全部保留。
- Library本轮在连接阶段失败，0新ID；最新本地备忘录未替换云端version4。详细有序结果见 [library-save-result.json](library-save-result.json)。
- 原件ZIP为367,653,712字节、7,132成员，其中7,127原始成员。逐源字节、成员SHA、完整CRC及成员集合均经独立复核；安全模式计数为0。Git四分片仅按原ZIP字节切分，没有重压缩、删失败记录或缩包。

完整ZIP SHA256：`86462ab6a015309b5d0d897c50a5be979e6001416cee9f868b74e31fcb705255`。

获取本目录全部四个 `.part001`—`.part004` 文件及恢复脚本/清单后，在新路径恢复：

```bash
python3 reconstruct_originals.py --output /tmp/yunshan-dynamic-city-services-original-evidence-20261003.zip
```

脚本逐分片及完整流校验SHA与字节数，拒绝覆盖现有输出。恢复成功打印 `RESTORED_BYTE_EXACT`；中途失败的输出不得当作完整ZIP。

原包包括冻结运行源码、构建dist、真实保存、原始日志、测试/脚本输入、参考图、原始实际截图、修复前失败及修复后回执；没有node_modules、凭据、Library私人日志或浏览器profile。当前独立交付结果见 [delivery-receipt.json](delivery-receipt.json)。报告中 `receipt.json` 为文字生产者的原回执，当前验证证据则见 `validation-results.json` 与原件包。

本目录产生于提交前，因此不在自身树中预写未来commit SHA。实际提交/推送是否完成、远端精确SHA以根最终报告为准。仅推送用户授权工作分支，不合并main、创建PR或部署。
