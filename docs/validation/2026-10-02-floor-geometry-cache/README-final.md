# 云山冻结11：隔离等价几何缓存候选原件

本包是冻结11的候选审查材料，未修改共享仓库/冻结源/原证据，未commit/push，未自行接合。仅新增内部几何派生缓存，保公开mutable FloorPlan与wall/slab/body/roof/routeGrid既有生命周期。完整目标、默认经济稳态、浏览器原0/11启动失败因果、城市美术、macOS性能仍未完成。

## 最终身份

- before完整105输入：冻结11 manifest `72dd109f5ba725ed8f02646f87d99d1d6046d8f18a9bf91a34c43710c6f780c6`；原provider `0a7d728e2714b2465002f509ff7ce8f389c4505cd3ff05070961336bd3a9ba78`。
- candidate完整106输入：manifest `5ea00a2c050d86e02ae7f6a98f25a7b17d41673f6c9984f355640ee872bcfe49`；provider `b4d0c35fb868deedfb10e14128c2f3255a1f3a5f3b54f2f853afb0d2656a4d42`；正式test `1d87502fa01a13a00514937530bce88008f8f7d866ac27d155d3c9bd53907963`。
- apply-ready patch `b6b28a748e3c3bc4b0d5f8623fb018a7ebd1c70db5040698bf8a79152936197a`，仅provider与正式test；git apply --check exit0。原Simulation SHA仍`ba289751a2990ae405538801561d6032c982148f15887c1c8745da2264a06f49`。

## 实际验证

严格tsc通过。首次外runner静态q类型错误与首次新5项3/5真实失败原件全部保留；后者只修新增fixture对旧浅rect引用和.2切割量化的误解，provider未改。原两失败输入另在外差分中硬对照old与candidate同实际result。

最终顺序16:28:10→16:29:18 UTC实际exit0：正式新5/5；原architecture-floor-plan/controller-v4/home-rest/npc-home-rest-voxels四文件37/37；完整外query 2662返回对象/17同异常/49case PASS，含用途、多层、上下实际tread、孔、旋转、.35/0、nested mutation、sparse与四旧recipe；105/106源和完整World前后同。这些不是完整suite。

16:33:51→16:39:00 UTC实际六实例144step PASS：原r5 exact import/export+各24真实step；默认v4 1×/08:00→08:06各24step；原11真实07:00 checkpoint/16×/未暂停各24step到08:36。每步全export逐字相同；最后双终档均逐字等原11已发生的24段原件，raw `7ea0ed5934179195de715522a33a35d5cf4bbb9e5585e384a71cd168da522018`。实际07输入raw `03e7155cdaddce72a3e09fdb8dda49017f6b4d03771976d7356781fbf38f79f6`。source/三原输入/World/runner前后同。没有新增默认首夜长跑。

## 公平独占 Linux Node 启动测量

16:40:18→16:43:25 UTC：四fresh进程串行before→candidate→candidate→before，完整612楼/616居民/default1×，World+Sim+仅4*.25实际tick到08:01，不setFocus或改settings。无其他Sim/GPU/build/ZIP并发、无新CPU采样profile。四轮source、初终World与full-export SHA完全相同，终档`64f79cab26ba1c244cdd68df9414b9c931c5e74c5940ceccd0696f999501723b`。

| 指标 | before两轮 | candidate两轮 | 均值变化 |
| --- | --- | --- | --- |
| 完整进程wall | 56.539/53.958s | 38.682/37.612s | -30.95% |
| 进程child CPU | 60.469/58.507s | 43.665/41.317s | -28.57% |
| 4实际tick wall均值 | 50.345s | 34.156s | -32.16% |
| process峰值RSS | 628936/555764KiB | 733164/731212KiB | +139838KiB均值/+23.6% |

RSS增加约136.6MiB是实测代价；未forceGC，不等于仅缓存自身字节或长期稳态内存。模块导入、World、Sim、每tick与只读JSON/SHA观察成本逐项保，不能将总wall都归geometry。只有2轮/侧，结果限Linux Node冷进程CPU；不是GPU、FPS、Mac/browser启动修复。Root应结合RSS代价决定是否接合。

## 内容与边界

before105/candidate106为完整独立src/runtime/test/script/config输入；所有实际失败attempt01、静态日志、独立最终review、外query、三模式initial/final原save、实际07原gzip输入、ABBA原JSON/log与runner全部原字节入包。node_modules、浏览器userdata、Git/env、Library工具/helper与密钥/签名URL不入包。

原件ZIP在性能进程全部退出后才生产；manifest列每个成员SHA/字节，独立CRC与每项直接原字节回读验证。Library只进行一次新文件保存，实际成功/失败与身份回执在ZIP外，避免改封存原件。若接合需新冻结12的同源build/规则/原default存档/串行GPU验证，11旧已验计数不转移。
