# ROOT07 实际九图复核

captures02 的九张原 PNG 已逐张实际查看并核对 SHA、1440×900 PNG 尺寸与逐场景原始 metadata。实际生产 bundle SHA 为 409236890d3388d0338532a78061913fd22867672fb26a7efb719210fe211063，ROOT07 241 个冻结输入首尾一致。原数据 errors=[]。

ART 仍为 FAIL；Mac 原机验证 NOT_RUN。实际 Linux Chromium SwiftShader 只作功能与光学证据，画面角落 FPS 不作硬件性能结论。PNG 原字节未裁切、增强或后处理。内部渲染分辨率按生产动态分辨率下降到0.65，完整记录前后值。

| 原图 | 实际观察 |
|---|---|
| [spawn-day](captures02/capture-originals/spawn-day.png) | 桥面和深色檐底遮住上部大面积天空；道路/砖铺装可见，墙体和标识仍偏块状，生活尺度细节不足。 |
| [spawn-night](captures02/capture-originals/spawn-night.png) | 固定同机位夜景明显转暗，路面和右侧墙体落入蓝黑区域，仅少数灯块可辨；未达到参考图细密灯火与可读街景。 |
| [overview-day](captures02/capture-originals/overview-day.png) | 可见多峰、多台地、溪流与架空路线，建筑密度已形成；大片裸台地/绿坡、重复浅色塔体、软糊的远景和缺少城市主次层级仍明显。 |
| [core-waterfall](captures02/capture-originals/core-waterfall.png) | 中心分层地标、白色落瀑及下游蓝色水道可见；瀑布单薄，山体台阶/裸坡和方块树冠突出，仍缺参考图深谷与丰富崖壁/水景关系。 |
| [market-street](captures02/capture-originals/market-street.png) | 实际街区门廊、木柱、瓦檐、窗格和铺装可见；空白墙/空地较多，连续商铺招牌、货架陈列和街面生活密度不足。 |
| [residential-first-person](captures02/capture-originals/residential-first-person.png) | 实际住宅庭院、门廊、两层窗格/屋顶可辨；材质和细部重复，庭院空、绿化少，近处下沿桥/边沿遮挡。 |
| [commercial-skyline](captures02/capture-originals/commercial-skyline.png) | 实际高楼群在山谷与河道上形成不同高度；外观仍主要重复浅色直筒塔体，近距离商业门面与中式金属玻璃细节未由此远景证明。 |
| [commercial-ground-bank-reception](captures02/capture-originals/commercial-ground-bank-reception.png) | 真实一层接待用途与银行账本界面可读；相机向下贴近浅色柜台，柜台占画面主体且室内过亮，空间/家具整体关系未能清晰展示。 |
| [commercial-first-office-floor](captures02/capture-originals/commercial-first-office-floor.png) | 真实中文三层记账结算办公室及当前位置匹配工作点；棕色工作台占主体，室内布局/桌椅关系不清，仍偏亮。 |

银行接待厅 floor0／中文一层；第一办公室 floor2／中文三层，均来自真实 market-b35 钱庄既有用途与真实服务/工作功能点。操作从公开声明的门外站位调用原交互进入，再使用原有真实功能点定位，未把受控定位称为原生步行登楼。原始资格始终 traveler、identities=[traveler]、现金600、银行余额0；截图未存取款、借贷、投资或付薪工作。UI 的五个银行按钮当前可用，不能仅凭此推导任意余额和贷款条件下成功。

前六个固定光学机位只改变相机，屏幕位置/地区 UI 仍来源于 controller 的原 spawn；远景所见不是普通出生旅程。新家庭七分支另有控制 DOM 作用域；市长、current crew 和公司退回新增分支仍 NOT_VERIFIED。

webgl01 非独占 GPU 的原8PASS/3未完成FAIL以及capture01的CJS导入FAIL/0PNG完整保留。webgl02原脚本原60秒独占隔离复验11/11PASS；不能凭两个结果直接宣称已证明航空超时的唯一因果机制。旧/tmp截图与raw事故仍明确LOST，此九图不是旧失落文件恢复。
