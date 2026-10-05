# 上层首踏步支撑修复：隔离交付

可合入补丁：`upper-stair-support.patch`，SHA256 `ad798b94a68bf2c82276e1f70ee0bac28966f65da56f94eef2f556d33c501ea3`，5800 bytes。仅修改 provider 与现有 `tests/controller-v4.test.ts`。生产测试没有 `/tmp` 路径、外部 world JSON 或报告环境变量依赖。

## 因果与最小改动

原 `market-b24` 从零层开始连续正常 W，完整走完 0→1 后，在 1→2 首踏步停在与实际浏览器相同的 `[-404.59997341778063, 80, 308.791474723644]`。下一步 `.072m` 的完整 `.35m` 身体盘支撑为 null，中心支撑为 80.2，权限未拒。原件见 `artifacts/baseline-continuous.{log,json}` 与 `baseline-exact.{log,json}`；没有为绕过失败重新赋脚高。

候选仅按每个真实、可达中心支撑的 top 计算完整盘的真实踏板/楼板 union。中心仍相对原脚高检查 `+.22/-.42`，每级 rise `.2m`、going `.4m`、半径 `.35m`、眼高 `1.72m`、步速 `4.8m/s` 全保留。真实楼梯孔、家具、墙窗、上层楼板/屋顶实体检查、权限、旧 floorPlan/版本及几何指纹均保持。provider 使用局部 per-top memo，避免重复候选共边检查。控制器未改。

基线 provider 首尾 SHA `9e3b35a9e3b667466e0360c287bd5b828b35e1fd2f1cd2a00228f2bb5f74a724`；候选 provider SHA `0a7d728e2714b2465002f509ff7ce8f389c4505cd3ff05070961336bd3a9ba78`；控制器两份相同 `9491986a2f037ed85f6b4f4f529786027e014984583b3dab3df864f0154d0ca6`。原来源 HEAD `6c70d27`，冻结 coherent04，完整文件/证据哈希及实际 argv 在 `provenance.json`。

## 已实际运行

- 精确原失败：baseline 0/1，candidate 1/1；candidate 正常 W 实际前进 `.072m` 并升 `.2m`。
- 可合入三项回归：baseline 0/3 FAIL；candidate 的完整现有 access+controller-v4 13/13 PASS。两个旧 stair 回归保留原断言，范围扩到 `0→1→2→1→0`；另加入真实建筑字段和失败坐标。
- 10 个实际楼体全层上行和原路下行及孔/侧缘/高度/权限/封闭立面负例 15/15 PASS，30,540 次实际 W motor 样本。包含原固定七个 ID、失败民居、13 层住宅和 12 层银行；星港 14 层、13 段 `6.6m` 上下全部完成。
- 另三项边界 3/3 PASS：真实上层楼板阻挡；明确标记的旋转克隆；明确标记的有两层地下室克隆，连续 `-2→-1→0→1→2` 往返。增加直接 head-level slab collision 断言后该单项再次 1/1 PASS。
- 原 architecture-floor-plan+controller 13/13 PASS（包含实体玻璃、真实门、屋顶、旧主阁 30 层/地下室、旧 E、桥栏杆）。定向生产相关测试合计 26/26。
- `tsc --noEmit` exit0；隔离 `vite build` exit0，entry `index-BwWZW0hZ.js`。未完整 npm test、未模拟、未 GPU。

`candidate/tests/upper-stair-actual.test.ts` 是只在本隔离目录运行的诊断 harness：它依赖复制的真实 world JSON 和 `STAIR_REPORT`，故**不包含在合入补丁**。15 项初次原始日志与 JSON 保留，新增边界日志分开保留，没有覆盖失败。

## 兼容保护

`artifacts/contract-protection-final.json`：10 个实际楼体完整 body/slab/wall/roof/usePoint、near/far descriptor 及每层 balanced detail 的 baseline 与 candidate 深度相等；几何版本 `architecture-v4-program-bodies-02-stairs-v1` 和 profile 不变。

四个旧受信 recipe × 三 seed（7/2024/20261001），共 7,344 栋 archived 实际旧楼的 provider/body support 仍为 null，旧 recipe fingerprint 均与冻结原值相同。完整已保存 v4 world 的真实 `savedWorldFingerprint` 前后均 `80cd31e2`。34 个 runtime 源文件仅 provider 改动，world/access/persistence/renderer/detail/site-fixtures/controller 均与冻结04 byte 相同。这里只重查本次受影响契约，没有重做全 renderer production emissions 或完整存档加载/长 tick。

## 交付边界

实际楼体正常 W 使用单楼投影：保留原山、水、路、交通数据及建筑尺寸/几何。移除其他楼体会影响地形 fallback，因此不宣称 whole-world normal W 已通过。连续楼梯每个 motor 姿态由完整真实 provider 支撑，不靠地形 fallback。封闭立面负例同时包含窗台，不能独自证明玻璃渲染。

root 需独立应用/检查补丁并冻结新 source/entry，然后只复验实际 `market-b24` 连续 `0→1→2→1→0`。本交付没有运行 GL，不能宣称原浏览器 bug 或美术验收已完成。共享源码、文档、原浏览器 FAIL、原 coherent04 来源均未由本 agent 修改。
