# ROOT07 两张补充室内context原图

captures03-context 于02:43:43–02:46:16，300秒期限内实际2/2PASS；241input及dist首尾一致，errors=[]，与原9scene逐字段硬assert同site/floor/functionpoint/cameraeye/hour/role/identities/cash/permission。仅相机方向target.y=eye.y保持水平；原9PNG逐SHA复核未变。

[commercial-ground-bank-reception-context](captures03-context/capture-originals/commercial-ground-bank-reception-context.png)：同公开服务点水平向前可见接待厅窗格、柱墙与下部铺装，原柜台不再遮滿画面。空间仍偏亮，柜台低于此次水平视锥，未完整展示银行桌椅/接待关系。

[commercial-first-office-floor-context](captures03-context/capture-originals/commercial-first-office-floor-context.png)：同真实office-east工作点水平向前可见铺装、窗格及墙面；上沿仍可见外部楼体/桥段的切顶视图，桌面低于此次水平视锥。室内家具布局与封闭顶面的美术表达仍不足；原supported station断言已过，图片本身不证明碰撞错误。

ART仍FAIL，MacNOT_RUN。桌子按原floor plan位于工作点前方0.8–2m且高0.8m；点位避让家具至少0.8m，原碰撞/支撑共享同fixtures。水平相机眼高1.72m与FOV48可使近处桌面落在视锥下面，不能从此空白地面断言家具不存在，也不能从原大桌面图断言站在桌中。未改家具、几何、点位、身份、钱、时钟或补拍隐藏站位；上沿切顶/外部结构和室内曝光不足作为实际美术证据保留。

只读roof/ceiling复核：renderer.ts1003–1008原applyInteriorRefs把高于当前层的refs及当前层/更高层roof refs置零缩放；setInterior仍使用该原切顶规则。context上沿可见外部屋面/桥段因此作为当前真实室内显示限度保留。architecture-bodies.ts126–145仍渲染同shared fixtures的桌面、腿、横梁；bank.kind实际fixture为table，只有market.kind使用counter。没有为补图删除资产。
