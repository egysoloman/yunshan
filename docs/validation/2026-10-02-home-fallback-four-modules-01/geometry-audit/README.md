# market-b24 四类样件：真实挂位静态几何审计

本目录只有生产接口候选和原始计算证据：计划 4 类、已计算 4 类、收到并合格的模型 0、批准安装 0。没有修改生产源码、共享碰撞、存档或 recipe，也没有运行 GPU、普通玩家 W、完整测试或付费生成。

依据真实住宅 `market-b24`：40×34.4m、3 层、层高 3.4m，建筑位置 (-390.8,76,316.2)，共享地板原点世界 Y=76.6。原 BOM 的 617 近体件与 680 去重细件不是同等数量的独立模型。七份相关源文件在计算首尾 SHA 相同；provider SHA 为 `0a7d728e2714b2465002f509ff7ce8f389c4505cd3ff05070961336bd3a9ba78`。精确原 building 字段和含浮点原表示的 BOM 保存在 `inputs/raw-counts.json`；JSON 合同显示值舍入到 1e-8m，不替代原始保存字段。

`four-module-contract.json` 是首轮固定计算原件，包含每件 pivot、局部/世界坐标、正基矩阵、边界、端口、真实保护区与原 native 索引。`geometry-audit-supplement.json` 补门框邻墙共面、完整楼梯身体包络避让与已实际看过的参考映射；它不改变原合同尺寸或矩阵。供应方 SAMPLE-* 名称只是这些母版的别名，不增加模型数量。

| 样件 | 母版尺寸 W×H×D，米 | 真实挂位 building local → world | 状态与阻碍 |
|---|---|---|---|
| WALL-1400-3000-400 | 1.4×3×.4，两份 | (.8,0,-16.5)→(-390,76.6,299.7)；(.8,0,-15.1)→(-390,76.6,301.1) | 只选 floor0 wall1，原完整 2.8m 实墙；候选包络对应 near28/29。尚无语义替换 adapter/回模型。 |
| WINDOW-2000-2200-400 | 外框 2×2.2×.4；孔 1.6×1.4 | (-11.2,.4,15.2)→(-402,77,331.4) | floor0 wall18/window0，真实窗台 .8m，非退化。pane192 与 detail59–67 必须整组替换并局部裁邻墙，不能旁加。 |
| DOORFRAME-5600-3200-400 | 开放框 5.6×3.2×.4；净孔 4.8×2.8 | (0,0,17.2)→(-390.8,76.6,333.4) | 首件仅开放门框；detail0–3 与邻墙需同 owner。双门叶未有共享 authority，另列未批准。 |
| BONSAI-ASSEMBLY-800-1300-800 | 整组 .8×1.3×.8 | (12,0,10)→(-378.8,76.6,326.2) | floor0 courtyard7 的受支持候选；盆/植株实体未收到，placement/collision/save owner 未登记。 |

所有 GLB 采用右手米制、+Y 向上、+Z 朝外；局部 +X=(Nz,0,-Nx)，不要直接以墙边 a→b 当 +X（该组合会反射）。矩阵列主序、det=+1、scale=(1,1,1)。墙 yaw90°，其余 yaw0°。墙底中心/外框下缘中心/门框底中心/盆底中心各有独立原点，不通过整栋 bbox 归一缩放。

## 墙、窗和门的精确替换规则

墙唯一 selector 是 `floor:0:wall:1`，a(.8,-17.2)→b(.8,-14.4)，完整 2.8m，没有洞。不是 wall0 的 3.2m bay，也不是其 3.4..6.2 子区。两母版在 localZ=-15.8/worldZ=300.4 对接，必须隐藏共享端盖，边界转角保持原 owner。原 lower stone/upper wall 是 near28/29，物理 wallPanels 不变。

窗用正常 `floor:0:wall:18:window:0`。粗玻璃 near192 的朝外深度是 assetZ=[0,+.2]，不是猜测 ±.1；完整九件框/栅/石沿是 detail59..67（包括本 floor-view 下的真实 source references）。窗玻璃与细栅共面联合面积 .8m²；细框另与 near188/189/190/191/193/194/195/196 共面，逐件 .08/.28/.08/.64/.64/.08/.28/.08m²，联合总面积 2.16m²，平面 localZ=15.4/worldZ=331.6。合同列每 pair 的矩形、去重面积和精确裁切范围。

因此只删除 pane+九件 detail 仍不解决邻墙共面。应以单一模块 owner 原子替换旧 pane/细件，并把八个粗墙盒局部裁成不相交的剩余片段；保留所有其余墙面。原孔、窗台、wallPanels 物理、共享指纹不变。近/远、楼层和 cutaway 共享 visibility ownership，启用新近件与原近件互斥。不能删除整块大墙，不能用 .02 depthBias/polygonOffset 冒充消除共面。向外凸出备选会改变占用包络，需新共享碰撞净空审查，当前未批准。

开放门框 detail0..3 也与 near133..139 共面：逐件 .16/.4/.04/.96/.16/.4/.04m²，合计 2.16m²，平面 localZ=17.4/worldZ=333.6；补证列精确框实体裁切与保留 owner。现 renderer 没有语义 native-ID 裁分替换接口，这仍是工程阻碍，不能把计划写成已安装。

门净孔保持 4.8×2.8m、零抬高门槛；.35m 身体直径 .7m，中心可用宽 4.1m，1.72m 站立头部余高 1.08m。已有 144 个完整 .35 支撑盘只覆盖内侧 X±1.5、Z15.2..16.8。前楼板边 Z17.2 需要既有 controller 门口/地形联合支持；本静态审计未覆盖外侧整身体通路。初次采到楼板边被 support 拒绝的原日志保留，未填板、减半径或调门洞。

假设双叶每片 2.4×2.8×.2m 时，铰轴 localX±2.4/Z17.2，+Y 轴左 -90°/右 +90°。左叶 90° 与现 lantern detail6、7 各有 .016m³ 实体交叠，两个确切 witness 保留。共享 provider/useDoor 现无真实门叶、铰轴、开闭 state、扫掠 solid/route obstacle/save 状态；叶必须另增 authority 并解决此冲突。原合同 overall REQUIRES_AUTHORITY_CHANGE 包含假设叶；补证明确首件 OPEN_FRAME_ONLY 只是 CANDIDATE_ONLY。

## 盆景支撑与保护区

整组提案为 .8×.4×.8 容器加 .8×1×.8 植株，根/土 socket+ .3m、盆沿+ .4m，总高1.3m。容器内开口 .6×.6 是制作接口提案，不能称已有真实空心 mesh 或已测根埋入。地脚位于 courtyard7 的 x[5.6,18.4]/z[2,17.2]；半径 √2×.4 的完整支撑盘包住整个 .8m 方形地脚，provider 返回真实 courtyard floorY76.6。

四边 loop 的 72 个完整 .35 身体盘都有现有 courtyard 支撑，四条整段 provider collision 检查也未被墙/家具/头部实体挡住；环路采样间隔≤.1m，与提案盆/冠占用包络的最小盘边余量 .05m。这是当前环境加提案包络的静态检查，不是新盆模型碰撞或普通玩家 W 通过。需要真实 mesh 的保守 collider、placement identity/lifecycle/save owner 注册后才能安装。

补证对两条真实 0→1、1→2 楼梯 route 计算完整 .35m 身体盘及 1.72m 头部的保守整体包络。四类占用盒与这些包络、真实楼板孔、各层功能点 2m 保护区、3m 门前 public path 交集均为 0。没有重跑旧楼梯、全楼层旅程或 GPU。

## 参考图和现有失败保留

审计者已实际查看原 `庭院建筑模块图鉴.png` 与 `立面与细部组件.png`（原 SHA 见补证，图在 sibling `references/`）。28 个参考组件只提供风格，不是 CAD、比例或批准几何：REF-A08 只用于实墙材料/纹理语言，不开新格栅孔；REF-B01 是落地窗，本样件只能风格派生为保持 .8m 窗台的窗；REF-A09 开放门框是首件方向，REF-B02 玻璃门叶单列等待 authority；REF-B11 是长花槽，不能说已有 .8m 独立方盆图或模型。

正常窗的选择不掩盖旧缺陷：原 declared 54/coarse glass53，其中 floor1 panel x0=x1=5.6 的退化 source 单列 UNFIXED_NOT_THIS_SAMPLE。原库存 43/54→53 问题未在本任务修复，也不声明所有窗可挂模型。

父报告 60 积分整栋试验实际 15 mesh 分拆重组误差0、院/门孔开放，技术 split PASS；用户拒绝其墙窗融合/主门混长片/花箱缺的美术模块结果，合格 asset0。根与本审计者没有亲收 GLB，本目录没有重新生成、付费、集成或伪称逐 mesh 验收。

## 复核范围与原始失败

`derive-four-modules.mts` 与 `derive-supplement.mts` 是实际执行的静态计算脚本。原始脚本保留工作区/临时目录路径以真实记录当时 argv 与输入；归档同时保存 exact raw-counts 与七份读取源快照，不能把 `/tmp` 外部文件暗作交付必需条件。重放需相同 SHA 的源以及项目固定 Three0.180.0/tsx 环境，并把脚本路径映射到归档输入；本目录不自动安装依赖或做重放验收。

保存三次初失败：JSON 原件把 roof normal -0 序列化为0，首 strict DeepEqual 因此失败，改成相同 JSON 格式精确比较；门前盘采至楼板边遭 support 拒绝，范围限为真实内侧并保留外側未审；补证 first run 因尚不存在 geometry-audit/ 路径穿越到 reference 导致 ENOENT，改 path.resolve 后退出0。没有为这些诊断改生产几何或削弱身体半径。

`provenance.json` 记录运行/输入/来源限制。`sha256-manifest.json` 对本目录其余每个成员记录 SHA 和字节数，自身 SHA 由归档回执给出以避免自引用。秘密模式扫描只报告计数/路径，不输出匹配值；未读取 private/key 文件。旧 upper-stair 的45原件目录及其 manifest 保持原样。
