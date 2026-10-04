29 组原件实际收集及独立恢复已通过。

原工具 exit 0 / VERIFIED_ORIGINALS：11,561 个文件，共 1,619,221,273 字节载荷；ZIP 11,562 个成员（含 ROOT_COLLECTION_MANIFEST.json），504,545,705 字节。前后原件 map 全等，changed[]，CRC error null，memberSHAErrors[]，凭据模式匹配0。

ZIP SHA256：e4f12462404f8eaf0e9d80499b27e681371b79a2bb58477fb7282f6e77dc3d88。8分片为7×67,108,864字节＋34,783,657字节；每part SHA/bytes及顺序恢复总SHA均匹配。

独立工具由本代理消费 session75404 exit0 / PASS：分别完整验证原ZIP与分片恢复ZIP，两份各11,562/11,562成员SHA MATCH且CRC验证；两个top testzip均null。两份扫描合计2条nestedZIP记录、632个nested成员SHA独立记录+CRC验证、1,342条gzip记录全流CRC验证；扫描扩展预算计数9,171,033,454字节，小于16GiB限制，depth8，失败0，七类凭据模式及路径redaction匹配均0。嵌套条目为READ_AND_HASHED，不假称另有外部nested goldens；其外层文件SHA已与收集manifest逐项匹配。

独立控制审查仅基于JSON：16旧控制/24关闭引用/5,386旧inventory行全匹配，报告漂移或缺失0；review40及自身manifest、最终计划备份5项及旧财政ROOT07 geometry50,032字节均已保留。控制审查原两文件逐byte复制到 independent-restored/control-review。

37项安全排除均为node_modules依赖或symlink命名空间，其子树未进入manifest；没有follow private/symlink/dependencies/.git。原FAIL、partial、timeout、fullsave/raw/driver/harness/guard及旧误图保持原字节/状态。本次封包不会补回既有34次历史运行缺失的25个path+SHA版本，不能声称所有历史运行全回放完整。

本代理未改共享源码、闭组原件或Git，也未调用Library；官方唯一批次由root完成。收集receipt、before/after清单、完整独立报告和执行摘要均为实际产物，输出目录由本代理最后关闭。
