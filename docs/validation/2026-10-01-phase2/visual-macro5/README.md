# 统一候选第五批原始画面

根代理统一不可变目录 `/tmp/yunshan-phase2-root-coherent-01`，81份源三方SHA一致、strict通过。实际入口 `/assets/index-9RmW2nKM.js`，SHA256 `4c8d85a0c70ec591e5edd8ab1f8336b02408f812f0acfb6fb0bcb09b872d9e57`。原source-snapshot字节与本轮起止核对见清单及 `run-manifest.json`；未修改任何冻结文件。本轮默认新浏览器上下文运行真正 current-v3，未打开旧 r5 profile。

固定六景技术 **6/6**、同源真实初代成年/老人正面 **2/2**，GL/page/console/着色器错误零，source/entry起止不变。外部观察wrapper与macro4完全相同，SHA256 `214cbd98199a90f92ed64c2494a98c1fb843c5093bc5e236556cd87c8919f6fb`；原六机位script未改。该轮与根代理CPU规则检查有时间重叠，不据此作独占计时或macOS性能推断。

根代理和独立审查员已实际查看全部六景和两张居民原图，**视觉仍 FAIL**。core的林冠更多、山体轮廓更有岩台感，但大素墙/模板楼群、简化森林、空前坪仍突出；market/home的真实门洞、窗框、灯笼继续可见，深黑大片屋檐、无细部大墙、home前坑切面仍粗。原bridge-structure仍在房体内而失败，保留全部原图；centerline通路清楚，远端裸墙与素桥面没有达到参考桥景；独立public-road视点不等于旧structure同镜头修复，水景不完整。成年/老人衣襟、腰带可见，老人灰鬓仍不够显著。

核心新白洞是实际网格问题。只读PNG像素分析定位 sky色RGB207/218/220 三角群，精确样本 `[917,853]`、`[949,829]`、`[1001,862]`、`[1192,489]`、`[1071,894]`。基于本次真实世界与landscape、相同48度镜头的独立CPU ray在这五点均没有 FrontSide 或 DoubleSide hit，邻近土面有hit，排除简单背面绕序解释；原件 `core-triangle-rays-precise.*`。初次肉眼近似坐标恰落邻土面，原近似诊断保留，不能拿它当洞证据。视觉owner另独立复核，定位5904条非world边界未配对边与混合步长格内T-junction，正在修复terrain/tests；该后续修复不属于9RmW2nKM，也未替换本目录失败原图。

| 固定视点 | 主 calls / 三角面 | 一次强制阴影总 calls / 三角面 | 实际驻留 |
| --- | ---: | ---: | ---: |
| core-waterfall | 564 / 574340 | 564 / 574340 | 0 |
| market-street | 433 / 593664 | 498 / 743846 | 7 |
| residential-first-person | 145 / 298734 | 226 / 436460 | 7 |
| bridge-structure | 141 / 293702 | 206 / 385116 | 7 |
| bridge-walk-center | 195 / 313110 | 263 / 399140 | 9 |
| bridge-public-road | 719 / 758058 | 785 / 837584 | 9 |

居民正面继续用实际citizen-551「许月3」31岁及citizen-133「云禾」63岁，镜头依据真实head matrix布置，未改年龄、居民坐标或姿态。暂停前后全people和instance矩阵相同，身体/面孔2 draw、面孔池3实例；初代最小年龄20，儿童无实际可渲染样本，明确未覆盖。镜头初始诊断布置不是普通玩家到达证据。

自己的六图4198与NPC4199 Chrome/preview均exit0并关闭，GPU释放。原PNG、逐图JSON、汇总、源清单、日志、实际wrappers和诊断源均按字节归档，大小与SHA见 `archive-checksums.json`。规则全套结果由根代理另行归档，本轮不重复或代称。普通r5旧current-v2-r5存档尚未在这些诊断上下文读取。
