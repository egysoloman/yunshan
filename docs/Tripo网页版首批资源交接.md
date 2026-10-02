# 云山：Tripo 网页版首批三件资源

2026-10-02。父会话负责用户 Mac 上的 Chrome；游戏开发会话不并行操作该浏览器。当前没有已提交或正在运行的 Tripo 生成任务、任务名或任务链接，API 与 Studio 本地浏览器均因环境代理连接失败。不要复述、粘贴或上传 API 凭据。

先只生成 **A1 一个模型**，确认下载及回传可行，再生成 A2、A3；不批量重抽、不购买、不升级。购买或升级由父会话另向用户确认。以下不是整座城市或完整可进入建筑的生成任务：可进入的房间、门洞、楼层、柜台、楼梯和权限使用 current-v4 已有共享 FloorPlan；模型承担精细真实木构、瓦口和纸木灯具。

## 共同交付要求

- 保留 Tripo 原始导出，优先一个可直接加载的 **GLB / glTF 2.0**；不要仅交 PNG、预览视频、OBJ 无材质、脚本或程序化体素。
- Y 向上、正面向 +Z，尺寸按米。Tripo 若不能精确保证尺寸/轴向，请如实记录原尺寸，交原文件由开发会话校正；不能仅改文件名声称尺寸已经匹配。最多轻微比例校正，不能把精细木构任意拉扁。
- UV 必须完整；baseColor 1024²（sRGB），normal 1024²（OpenGL/+Y），roughness 或 ORM 512²起（数值纹理）。GLB 内嵌贴图可以；独立原贴图也保留。若导出没有某张贴图，明确缺项，不从预览图臆称完整 PBR。
- 木、纸、瓦是非金属；局部铜件独立材质。禁止把太阳阴影、地面投影、环境天空或固定灯光烘在颜色图上。材质不要纯黑/纯白、全件同色或只有一张模糊贴图。
- 以下预算是**导出文件经三角化后实际三角形**，不相信网页档位名称或四边形 face 数。若网页只提供高模，先保留原高模并标超限，开发会话另做有证据的降面；不能声称已经合格。
- 每件需正面、背面、左右、底面和近景预览；可用同一模型的查看器截图，不以概念图代替实际三维验收。记录实际任务链接、模型名、导出时间、是否消耗现有积分及网页显示数额。费用/升级未授权时停止该购买步骤。

## 概念参考图与可传递链接

这两张是用户已经放在 GitHub 的真实参考原图，本会话实际查看过；2026-10-02 再次用网页工具打开以下公开原文件成功。它们是整城风格参考，请让 Tripo 只生成提示词中的单件，不要把整城塞进一个模型。

- [参考图1：细木构、薄青灰瓦檐、崖台与暖灯](https://raw.githubusercontent.com/egysoloman/yunshan/6955d374a7d5bd928d2dadf4d0fdda74d416ca57/%E5%8F%82%E8%80%83%E5%9B%BE/%E5%8F%82%E8%80%83%E5%9B%BE1.png)
- [参考图2：居住院、木灰石材质与石阶](https://raw.githubusercontent.com/egysoloman/yunshan/6955d374a7d5bd928d2dadf4d0fdda74d416ca57/%E5%8F%82%E8%80%83%E5%9B%BE/%E5%8F%82%E8%80%83%E5%9B%BE2.png)

这两张没有可声称成功的新 LibraryID。既有资源规格的官方 Library 上传实际 network 失败，不能说附件已送达。父会话可直接打开上述已验证原图链接；若网页不支持 URL 导入，可在用户 Mac 下载原 PNG 后上传参考图片，不发送任何凭据。

## A1：开敞市集木构门框

**优先用途**：替换第一人称铺面入口的粗棕色方条，让玩家近看有真实梁柱、榫接、克制雕刻和木纹。只用于 current-v4 的 3.2 米院内门洞；不是主入口 4.8 米门洞，不伸缩冒用。

**尺寸/原点**：外宽 X=3.6m，高 Y=3.0m，厚 Z=0.30m；原点底面中心 y=0，门框立面中心 z=0。中间必须贯穿留空：净宽 3.2m，净高 2.8m；两柱约 .20m，上梁 .20m。无门扇、无墙、无玻璃、无底槛、无底座、无人。参考图1/2的深褐木、少量朱褐，浅灰石柱脚只占柱内底部约 .15m，不能侵入通路。

**内部/碰撞**：不生成可进入室内。真正门洞、墙与身体净空由原 FloorPlan 决定；木框贴在对应墙面内，不另加阻挡。AI 若把开口填实，直接判不合格，不能用碰撞穿墙掩盖。

**预算/文件**：近景≤2500 triangles，中景目标≤700，远景省略并保留现有主体。最多2种非金属材质。`ys_market_doorframe_3200_v01.glb`；贴图同名前缀。网页可指定 face limit 时先约1200 faces，最终仍查真实 triangles。

**直接提示词（英文，完整复制）**：

```text
Create ONE production-quality modular Chinese mountain-city market doorway frame, a real textured 3D game asset, not a building or scene. Refined stylized architectural craftsmanship inspired by the supplied Chinese cliff-city references: restrained angular shapes, fine timber joints, shallow geometric carving, dark desaturated walnut wood with small aged vermilion accents, subtle grain and material variation. NOT crude cubes and NOT a grey clay blockout.

Real dimensions: outer width 3.6 m, height 3.0 m, depth 0.30 m. Two 0.20 m timber posts and one 0.20 m lintel. A fully OPEN, unobstructed rectangular passage exactly 3.2 m wide and 2.8 m high must run through the centre. Absolutely no door leaf, wall, glass, floor, threshold, base, pedestal, ground, people, sign text or other objects inside that opening. Small pale stone post feet may be contained entirely beneath each post, never inside the passage. Front faces +Z; Y-up; bottom-centre pivot. Fully model the back, sides and underside of the lintel; no one-sided paper cutout.

Use clean UVs, PBR timber and stone, separate non-metallic materials, 1024 px base colour and normal textures, roughness variation. No baked sunlight, ground shadow or dramatic lighting in the colour texture. Limit the triangulated exported model to 2500 triangles if available. Deliver a single GLB with textures and real open geometry. Do not generate a whole house, roof, diorama or city.
```

**验收**：旋转查看背面仍完整；看穿整个洞；用 .35m 半径、1.72m 身高的实际玩家通过，不改身体规则；木纹可近看，无模糊贴墙照片；尺寸/材质/三角数实测并记录。

## A2：可拼接薄瓦檐模块

**优先用途**：给市集真实屋面边缘形成薄瓦口、梁椽与真实侧面轮廓，改善目前厚黑板檐。只作为檐缘装饰，主体屋顶、屋面支撑和坡度仍取原共享楼体。

**尺寸/原点**：X=4.8m，Y≤.48m，Z=1.2m；原点底面中心。+Z为朝街的前檐，-Z接屋面；前瓦唇薄约 .03–.06m、后缘高约 .45m，轻微前缘上翘可≤.06m。两端适合横向拼接；不要在每个模块两端做飞翘大角或山墙。克制灰青瓦、深褐椽梁，瓦列向前后延展、沿X约 .20m节奏。

**内部/碰撞**：不做整栋屋顶或室内；模块只挂原檐缘高处，不能盖住院落和楼板孔，不改变可站屋面的高度。若资产过厚或侵入入口人体净空，先修资产/安装，不扩大碰撞豁免。

**预算/文件**：近景≤3500 triangles，中景目标≤900，远景保留原屋顶代理。最多2材质。`ys_market_eave_4800_v01.glb`；可指定 face limit 时先约1600 faces。只先装样段4块，不给605栋全城无条件加载。

**直接提示词**：

```text
Create ONE high-quality repeatable Chinese timber-and-tile eave strip for a playable mountain-city market. It is a modular architectural EDGE, not a whole roof, house, miniature scene or city. Refined stylized craftsmanship with a clear thin silhouette: muted grey-teal clay barrel tiles, subtle uneven glaze and edges, slender dark walnut rafters and a modest timber fascia. Angular readable shapes with authentic fine details, not a thick black slab, not giant square blocks.

Real bounding dimensions: 4.8 m wide along X, at most 0.48 m high along Y, 1.2 m deep along Z. Front eave faces +Z, rear connection -Z, Y-up, bottom-centre pivot. Thin front tile lip 0.03 to 0.06 m; rear roughly 0.45 m high. Very restrained front lip lift, at most 0.06 m. Flat repeatable side ends: no large upturned corner, dragon, ridge, gable end or end cap that prevents horizontal repetition. Tile courses run rear-to-front with approximately 0.20 m spacing across the width. Model the actual visible tile edge, side thickness and slender underside rafters. No wall, columns, floor, courtyard cover, pedestal, text or surrounding objects.

Clean UVs, physically based non-metallic tile and timber materials, 1024 px base colour and normal textures with aligned roughness. No baked directional shadows or fixed reflections. Prefer no more than two materials and 3500 actual triangles after triangulation. Export a single GLB with textures. Do not generate a complete curved roof or an opaque thick rectangular block.
```

**验收**：侧看有薄瓦口和椽梁；近看木/瓦质感区别明确；四块拼接不出现四个巨大飞角；檐下没有大块发黑贴图；安装后真实共享屋顶的射线/站立高度仍一致。

## A3：独立木纸灯笼

**用途**：市集檐廊夜间视觉锚点。替换粗发光盒；真实局部灯光由开发会话按昼夜、供电、距离与资源预算控制，不能把光池画在灯笼贴图上。

**尺寸/原点**：罩体约 X=.55m、Y=.8m、Z=.55m，吊钩/短吊绳再约 .15m；顶部吊挂点为原点，罩体向 -Y垂下。深褐细木框、暖米白纸、少量朱褐与旧铜，所有视角和底面完整。不是照片级霓虹灯、不含文字/牌/底座。

**内部/碰撞**：不要求室内可进入；安装在通道上方，灯笼最低点不得低于2.3m。纸罩独立材质，发光遮罩/区域分离，木架和金属不发光。

**预算/文件**：近景≤1800 triangles，中景目标≤400，远景省略或原有小代理。最多3材质，纹理1K够用。`ys_market_lantern_0550_v01.glb`；可指定 face limit 时先约900 faces。以前的API dryrun仅计划，未创建此任务，不需要防重做已生成模型。

**直接提示词**：

```text
Create ONE refined Chinese timber-and-paper hanging lantern as a real 3D game prop for a playable mountain-city market. Small square lantern with slender dark walnut wood framing, warm ivory handmade paper panels, very restrained aged vermilion accents and a small weathered bronze hook. Fine construction and believable paper texture, clean angular stylized forms inspired by the Chinese cliff-city references, not crude voxel cubes, not a grey clay model, not a neon sign.

The lantern body is approximately 0.55 m wide, 0.80 m tall and 0.55 m deep, plus a short 0.15 m hanger. Y-up, front +Z; pivot at the top hanging attachment, body extending downward. Fully model the rear and underside. Separate the paper, timber and small metal parts into sensible materials. Paper can receive a separate soft emission mask; timber and metal must not emit. No letters, logo, building, street, pedestal, background geometry, flames or baked ground shadows.

Clean UVs, PBR materials and 1024 px base colour/normal textures with roughness. Preserve subtle paper variation without baking a bright orange glow over the entire asset. Target at most 1800 actual triangles after triangulation. Deliver a single textured GLB. Only this one lantern, no set of lanterns and no whole scene.
```

**验收**：顶部枢轴/悬挂可靠；纸、木、铜可分别检视；无整件发橙/纸板单面；正午纸不刺眼，夜间仅纸发光，近处受控真实光源才能产生地面/墙面光池。

## 回传和集成责任

父会话请回传每件原 GLB、原贴图（如导出单独给出）、实际任务链接以及所用参考和提示词。文件生产者按其当前 Library 技能上传并返回真正 LibraryID；上传失败要保留原件/明确失败，不能只报Mac路径。这里负责从用户授权附件或 LibraryID取得原文件，记录SHA、检查 glTF 结构/材质/三角数/尺寸/UV，再在**一个真实可走可入店可交易的市集**接入；不把Tripo预览替代游戏截图。

首样段先上4个门框、4条檐缘、至多6灯笼：最高新增近景三角数约34800，限定单样段，使用距离LOD/共用材质/真正资源释放。该数是规划上限，实际glTF展开、阴影提交与贴图内存必须运行测量。保原六数值镜头，增门前/檐下/柜台一人称日夜原PNG，与用户五参考实际目视，保原失败。

工程责任不外包：自然地形目前被地区 .62R、住宅70+170m肩、建筑外框与道路宽肩压平；楼群缺真实沿坡街墙/林冠。开发会话继续共享地形、街道和城区组合改造。三件道具不会单独解决城市整体差距，也不代表完整游戏或美术已通过。
