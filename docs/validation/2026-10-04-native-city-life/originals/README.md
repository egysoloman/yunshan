# 29组现存原件的逐字分片

完整ZIP为504545705字节，SHA256 `e4f12462404f8eaf0e9d80499b27e681371b79a2bb58477fb7282f6e77dc3d88`。11561原文件、11562成员；失败/partial/superseded、现存as-run源/构建/fullsave均保留，缺34次历史scope的25种旧源码字节事实仍保留。另2D接口只读文档位于相邻rpg2d-space-contract，不混入已冻结29组。

Git保存8个原分片（单片不超过64MiB）。在本目录运行：

```sh
python3 restore-originals.py --receipt collection-receipt.json --parts-dir . --output /tmp/Yunshan_ROOT09_ROOT10_Delivery_Originals_20261004_01.zip
```

输出文件须不存在。脚本验证所有分片、连接ZIP、每成员SHA/字节与CRC；本轮独立恢复结果另有报告。库附件是否送达，以最终Library实回执为准。分片是Git交付，不能称Library附件。

独立双ZIP完整验证已PASS，报告INDEPENDENT-VERIFICATION.json SHA256 `22ff7b0036f7639bf3091899b0a8d0d73cc36c962f7f9031d385f3b471d92243`；嵌套2ZIP/632成员和1342gzip，展开9171033454B，凭据0。Library唯一批连接前失败/newID0，详见上层LIBRARY-DELIVERY-RECEIPT。
