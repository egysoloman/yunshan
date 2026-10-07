# ROOT26：收窄近端餐修复与最终 421 源有限闭门（revision11 更正私稿）

本revision11更正文稿串源错误：revision10全部原件保留，不再作为最新交付稿。279窄方案两次成交改按[实际同钟原件比较](comparison.json)与[原阶段证明](sale-phase-proofs.json)记录；951原件的5个同clock比较、172/172阶段匹配，皆为纯I/O审原件，未新增Sim/import/step。这些是原阶段聚合前后身体/钱包/food证明，不虚构每单独立body capture。

收窄后的近端餐调度已用原生同钟对照验证：从5416同一原档，5576时初始89低饱足居民恢复旧43/新52，全城低饱足旧47/新38。最终421源另冷续8窗并4窗hot/cold完整存档逐字相同；相关最终测试去重103项实际通过，原失败和超时保留。有限供给分配、夜间供餐与所有38需求域仍PARTIAL，ART_FAIL、MacNOT_RUN、14日稳态NOT_RUN不变。本稿不包含尚无回执的Library保存或本stageGit交付。

## 真实来源与实现边界

原World291 SHA`2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512`是current-v6/fingerprint b85fa6ec、612建筑/616NPC；本stage旧档对照不代当前fresh默认v8普通URL验收。original417、已拒宽候选418、收窄03实际419、最终421四种来源分别绑定。最终相对原417只MOD simulation.ts/meal-route.ts，NEW pure recheck脚本、urgent测试、voxel运动模块与其测试4路径；417其余全输入保，全部原tests/路径逐字不动。[完整来源](SOURCE-LINEAGE-ORIGINAL261-READONLY.json)。261是ROOT24–25保护的测试/夹具/辅助数据路径数，非case数；原417全部tests/266路径同样不改。20项narrow-tests02实际PASS，但其meal helper SHA`efc6594a…c822`与03的`6ce96235…f2a4`不同，差为注释与finitewalkingrate guard，20项结果不冒同精确03源。

窄修复仅nearby-food-v1/age>=6/activity=eat/food<1/原累计elapsed投影hunger<30，并且已到站mealrider或完整参考折线余程不超过原walkingSpeed×25min，选择原people正常frequency1。雨中3.1/其他4.2速度不变，长路/非eat/儿童/携粮/legacy沿原频率。未写tier/focus、身体/钱粮/库存/角色/时间；原classification每8tick随真实body变化，双方tiersUnchanged=false不是人工注入。参考折线边界只是调度选择，不是全物理路线通达证明。

最终421另加入movement-only voxel子守卫：对已经与放块重叠的NPC，仅水平严格向外、径向净空不降低且不深入/穿越块心时可离开；全3D sweep拒新重叠，非有限或无效算术拒绝。原.2m方块、.35m半径/1.72m高/.01m脚底、站立/rest/meal和玩家判定不变，墙/支撑/权限/门/柜台/道路仍原守卫。home-rest生产SHA`60b2126e…b006`保持。放块来自明确synthetic `placeSnapshotVoxel`受控原生snapshot，不能冒正常玩家建造UI验收。

## 同钟对照、真实成交与仍低群

完整原checkpoint`ce40c74205c1126519e08c5d49e32d18f22cc4acf410d07f1fa4e709ff0337b8`，5416/t2089，89低群。419 patched03主40/24shadow、2构造/2import/40reader、0命令及注入，实际PASS254.753447s，至5576/t2129/末`836e6d9f99f226ce91a62784e0774203374c8fc2f3b59f31233dad92066af363`，400主phase守恒，24shadow逐窗whole bytesexact。shadow没有独立另240 phase捕获。131真实parts末whole exact并拒缺chunk；分区额外Sim/import/step0。

| 原5416初始89群 | 旧5480 | 新4195480 | 旧5576 | 新4195576 |
|---|---:|---:|---:|---:|
| 恢复人数 | 17 | 18 | 43 | 52 |
| 全城低饱足 | 72 | 71 | 47 | 38 |

只读作者独立解读四份完整原save与dualSHA，人数一致；[原读回](PATCHED03-READONLY-CONTROL-SUMMARY.json)。真实sale关联以根最新pure recheck BUS/phase/body/wallet writer原件核。279在narrow03于5432真实west-b41售qty2/cost35.93322820152043，5544再售qty1/cost18.127046066437075；旧5480尚无sale。两次原commerce阶段聚合钱包/food/hunger残差均为0，真实BUS序号456/3430及custody SHA均分别绑定；03终shopping/hunger100/food1，旧5576moving/hunger8.499999999999773/food0。这支持窄近端调度防原64min处理延迟错失，未增加食物或开店。

421 patched04是从03末836档另冷构造/导入，主8/4shadow、2Sim/2import/8reader，0命令注入，79.828184s，5576→5608/t2137，末`bbaa6a7a5e0bfcda107d22e62a820c6aa65336b3e0a48266f00846e2306dad29`。80主phase守恒、shadow4 fullbytesexact、129parts whole exact/缺part拒。03自然城没有放置voxel，所以该8窗是最终组合源的有限兼容接续，不声称在此城市观察了放块egress。40旧419+8新421为两来源48主窗，不能称单421主40或fresh同源48，更不接original80。

最新最终421纯重检62.253600s/PASS，从完整原件分别重算三链：旧80/800phase/850双SHA；已拒宽40/400/343；收窄两来源48/480/516。0Sim/import/step/nativeReader。所有主phase原cash/food/debt fullsnapshot等原feedback，guard/custody、原BUS与cust原件、每sale实际身体/付款/food writer、parts/段lineage及原hot/coldshadow双SHA全核。两来源末58/89具名实际sale且恢复，31仍低、全城32；238柜台/18stored。新pure工具是原件审计，不是游戏修复，不补任何历史缺捕获。

## 原负结果、原测试与最终实际门

宽418候选仍明确拒作最终gameplay修复。虽279提前成交且宽future24 fullsave exact，从同5416档5576恢复新34对旧43，全城低56对旧47；5480恢复13对旧17/全低76对72。两次宽前16原save/BUS/custody/trace逐SHA重放相同，只说明物理复现；不新增canonical窗或覆盖窄源结果。[保原宽证据](ROOT26-ACTUAL-EVIDENCE-SUMMARY.json)。

宽tests01真实41pass/2fail，原417 baseline-home01同两legacy床侧放块physicalWaiting!=moving复现5pass/2fail；baseline-capture02实际FAIL1/1含3原完整save/cause保。最终home04真实21新pure+7原home=28PASS，两原legacy断言已PASS，原测试字节不改。安装03错误header slice匹配注释`import to`，实际两文件加载FAIL/0behavioral cases，保brokenoriginal与04-CORRECTION，修正只去两错误header行；不把安装加载失败当游戏逻辑FAIL。

reg05原421门240.263373s真实TIMEOUT_PARTIAL，44runner条目40pass/0fail/4cancel，四个取消文件保；不能叫完整8files一次PASS，也不能推断微步死循环。reg06四余文件实际35/35PASS，动态14 doorway实例在计数内。原高层native实际运动case6.552017s，24真tick complete/partition/selector/RPG重建case238.364682s，解释长case真实成本；15坏cursor原子拒与真实上/下恢复通过，24份原件保。含oldreader的标题不能覆盖未设置env的旧244可选读器分支，该分支NOT_RUN。[最终421回执/103unique名称](FINAL421-CLOSED-GATES-READONLY.json)。home04 28 + reg05 completed40 + reg06 35 =103 unique PASS名称，无重复；不与旧20窄test或41宽test再加成一轮。

| 实际闭门 | 输入数 | 状态 | gate秒 | 原raw SHA256 |
|---|---:|---|---:|---|
| narrow-tests02 | 419 | PASS | 7.068991 | 9fa6aea71a40e9fcaa2f850231cf51405aae0d0a7fa091e96c649ae23cf81e1d |
| patched03 | 419 | PASS | 254.753447 | 249419cccf8fe8ee7664b423d8152bd87a76377ceb20b27e33c11d0545e759b9 |
| recheck-negative01 | 419 | PASS | 3.822408 | 2cfd0a805decda7e7dfff5b2d8fc3c120ead8b1c015d7f8baa091b94f026d97e |
| home-tests04 | 421 | PASS | 60.956525 | 1491e1a2522beaf3577310e57d93b15c19b9a435eb75861a8da0ef05886ada5f |
| regression06-remainder | 421 | PASS | 274.111118 | f6214069ceb80bfff12e9fc9841747708bd37d77574f34a1cc2782bb1f0946b4 |
| patched04 | 421 | PASS | 79.828184 | 750910cb4dd31533efb549ccca18c2b9d7676a64a01db8d3c340f4bdcde82e9e |
| recheck-positive02 | 421 | PASS | 62.2536 | f544d9a01382f932d757627633958f37f35be48ae95fa2eb293f2ebf454ee1df |
| build01 | 421 | PASS | 22.328996 | 291f37372fe2bd57e9a6315fac1b651c2f934e616eec3287d327e84ba0e75e1d |
| regression05 | 421 | TIMEOUT_PARTIAL | 240.263373 | d14fd5043cd313099debbf1311a76a7b0988981611df55cf17ae37e075b1312a |
| home-tests03 | 421 | FAIL | 1.652645 | 62c6e3f4e3bf54be226d7b9e087b38af3ac3bc59cb1d6c28474ed10c643a24dd |
| baseline-home-capture02 | 417 | FAIL | 2.277609 | 89731e1968333a8bc4f47bcb4368de8cff22002f9b14cde18f3c82bbcea14b91 |

final421 home04/reg05/reg06/patched04/recheck-positive02/build01逐项来源相同，before=after/421stable/active=[]；build仅为该真实源构建门，不替GPU、正常URL旅程、Mac或长期仿真。旧419 narrow03来源未升级。[实际证据摘要](ROOT26-ACTUAL-EVIDENCE-SUMMARY.json)。3tamper回归在另一实际419源PASS/225原files未改/0Sim，不能当最终421上新重跑；其auditor源码与421相同，但门绑定仍原419范围。

## 钱粮、历史80与下一缺口

419主40 food1.0743647328613164/material2.1510779069859334，206counter/16stored，earned262.77067088031504/paid0；最大原cash/food/debt/fiscal残差1.7462298274040222e-10 / 1.8189894035458565e-12 / 2.2737367544323206e-13 / 3.410605131648481e-11。421另8 food/material0、32counter/2stored、earned73.8405644012972/paid0，残差1.7462298274040222e-10 / 0 / 1.1368683772161603e-13 / 6.430411758628907e-12。未跨原payrollAt6780，不能称下一工资/长期财政成功。

original417四cold段80仍原事实：5340→5660/t2070→2150，616基线NPC alive（617profiles含player，不是617NPC），86/115具名sale恢复，29低+1新低，393counter/23stored；6原群hunger0food0，210shop终全closed。153于5600真sale qty2/cost29.980531266965833，只有其余三target有后stored，153无后stored witness。前三64原诊断212目标变化203旧stock0/9旧店开有货、42moving边界无所列waiting/unreachable且有位移，仅支持供给竞争/长路/处理间隔的局部原因，不是全路修复。原旧4缺phase/FAIL不由本stage新80或pure审计补造。

下一完整缺口为有限供给竞争与分配、合法夜间餐食经营，须保真实owner/许可、成本/劳动/钱包库存/工资债与时间；不能凭空补食物或让所有店夜开。其他能源/家庭/医卫/社会/建造等原完整目标未由食品完成。正常玩家第一人称新生活、14日现金财政供粮稳态、ART_FAIL与MacNOT_RUN继续。Library/Git由根取得真实回执后追加，本文不预写提交或送达。

[新52列38行矩阵](REQUIREMENTS-38.csv)只追加ROOT26五列，旧47headers/1786cells/38IDs次序exact，全38PARTIAL。[memo追加私稿](MEMO-APPEND-ROOT26-DRAFT.md)必须接在已实际621373bytes checkpoint全文之后，保原timestamp RUNNING/NOT_RUN不回写；本作者0Sim/step/tests/build/browser/GPU/共享写/ZIP/上传，全部前稿和FAIL原件保。

## ROOT26 根代理封存实录（2026-10-07T11:39:31.114800+00:00）

实际封存已完成：4494份完整原件、24组、29个ZIP，所有分卷均需保留；ZIP合计664376379 bytes，单卷最大69395550 bytes。每成员解压字节/SHA/CRC与原件一致，原件before/after全量SHA不变；根另逐个复核成品ZIP SHA。419及421冻结源码、417完整基线、真实对照/弃用候选/采用候选/组合续跑和失败原件均分别封存。依据为本目录`PACK-SUMMARY.json`与`artifacts/index.json`。

同钟原件比较实际951文件、5个比较点；172项scenario/clock/phase/actor销售聚合证明全部匹配、0缺捕获/0差额不符，不作为172独立事件身体捕获或新增测试。279 narrow03真实5432买2份/35.93322820152043，5544买1份/18.127046066437075。文稿曾混用弃用宽方案金额，已在revision11及新矩阵列纠正，旧错误私稿完整保留。

原件统计图已生成PNG/SVG并实际查看，属于旧城市同钟数据展示，不是游戏或美术截图。下一真实接续原档单独提供`NEXT-COLD-INPUT.save.json.gz`，解压SHA bbaa6a7a5e0bfcda107d22e62a820c6aa65336b3e0a48266f00846e2306dad29、clock5608/tick2137。Library本轮尚未运行，Git本轮尚未提交/推送；以之后实际交付回执为准。

## Library结果

本轮72文件保存因Library连接失败而未完成，0新LibraryID，备忘录未替换；不声称附件送达。[逐文件未保存清单](LIBRARY-DELIVERY.json)保留原件SHA和次序。完整29卷与报告继续随当前开发分支交付，本段追加时Git提交/推送尚待执行。
