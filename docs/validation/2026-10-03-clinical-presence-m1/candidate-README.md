# M1 医疗同站配对：隔离候选实际验证

此候选来自 `/tmp/yunshan-system-coherent-14/source` 的实际冻结源，全部实现与验证仅在本目录 `candidate/`。最终 **16/16 新回归、38/38 相关回归通过，strict/build 均 exit0**。旧源用相同字节的七项回归得到 **2 PASS / 5 真实行为 FAIL**。三份补丁在 actual14 上 `git apply --check` exit0。尚未接合 `/workspace/yunshan`，没有本轮 full npm、浏览器/GL、默认医疗覆盖、14/30/60 日或性能测量；没有 ZIP 或 Library 上传。

最终候选的 48 个输入文件在 strict-05、新16、相关38、build四轮起止全部相同。完整清单为 `evidence/candidate-final-48.sha256`，该文件 SHA256 为 `9c7ceb37e8557a3653e5e8af212e05455c5187c3b15b52e88c49953f3295fb0f`。这是36个src、7个test/fixture及5个配置文件的冻结，不是整个103文件交付或当前dirty共享树的冻结。实际14和本目录original的36个原始src各自保持原捕获哈希，共72个逐文件比对见 `evidence/origin-verification.json`。

## 可接合的差异

| 补丁 | 实际文件 | SHA256 |
| --- | --- | --- |
| `01-shared-presence.patch` | clinical.ts、culture.ts | `67c594b45abc11b6db0ea5176669013ccd5b927e222d9deccfc97bb410c2afd6` |
| `02-doctor-ground-routing.patch` | simulation.ts | `9d5c04e91081b050c6844399d3cf856a95656792266d24eea27a939c53c075e0` |
| `03-proposed-tests.patch` | 3个新测试文件 | `4564cef19875c452720bb6a18367829f2befc707adad8cbb85c9a7d81f72482f` |

第一段把付费clinical与公共culture.health接到同一个实时站点谓词。每个实际治疗分钟都证明doctor和patient同一个可信service point、同一个实际支撑层，公共权限、两方身体与真实站点的动态体素清空。配对证明在既有共享医生slot分配前执行。公共health遍历实际eligible患者，然后应用既有每doctor两槽与剩余材料；不匹配前缀不会阻挡合法后序患者。education的原slice与transport保持。

第二段仅在marked clinic的 `work` 且真实role为医生/doctor时，优先具有同层公共service站、.35支撑与实时清空身体的ground工作点。工作点可以与service点不共位，但须落在原2m站点入场范围。优先站缺失/体素阻挡/不可达时继续原hash工作点及真实floorPlanRoute fallback；旧的blocked ground route不因earlyreturn永久保留。其它clinic员工、旧未标记地图、workId、角色、工资、考勤不改。不会传送或凭路径生成材料/收入。

最终三份生产文件 SHA256：

- `src/simulation/clinical.ts`：`7c5e112ff7b28ae3bc0e11169f5e918af1760b9c25ec1960bfbbc4e4045dffee`
- `src/simulation/culture.ts`：`f6280b07d9b6b36de74c7b3320a60f9258c808776303cb88a3af6753372b6381`
- `src/simulation.ts`：`bc00e75bb79aa593f00be637a86cb1e25da813bd74f90c241d3177753911d80b`

## 保留的合同与几何边界

保 FEE30、20实际分钟、1实际materials、每doctor两槽、公共先分配再付费、复诊期限、needs、alive/adult、实际任职/funded isOnDuty、ACL与原入场距离。没有新增doctor–patient距离阈值：两人分别在同一站已有2m内，即使彼此相距3.6m仍合法。每tick导出可信world站点证据，不新增保存字段、manifest、收费、工资来源或物料。既有/旧partial分钟、材料、escrow不擦除；以后不合格只暂停，不能把旧已赚分钟倒推成历史已验证同站。

未标记旧世界沿原治疗契约，不新增floor/station限制；caller原有duty/needs/site守卫保留。付款人不新增持续陪同20分钟义务。`clinicalAtPosition` 的marked分支现在与core一样读可信 `functionPoints ?? provider`，默认声明/provider点一致。

实际14的 `isAtBuildingFunctionPoint` 只有静态floorPlanPresence/ACL/功能点/距离，没有实时voxels检查。其 `floorPlanRoute` 也没有遍历placed voxels：有体素仅禁用route cache，额外碰撞callback只处理marketCounters。M1的医生新增优先点和治疗配对独立检查actor/station实时volume，**没有修复泛NPC动态体素沿路碰撞**。

floorPlanSupport(.35)沿已有1.72m实体体积、楼板/楼梯支持与脚位容差：普通面与楼梯原上下约.42/.22m支持窗仍在；core function-point presence另要求支撑脚位差<=.26m。controller使用同一静态support，另有roof支持和读档<1.5m容差。M1只接受room/stairs并沿已有caller，不给roof新医疗功能；不称任意站姿、任意屋顶或全城body物理已经闭合。

默认源码普通clinic为50×38m、7–9层、3.8m层高，v4 H型病房中央连接段每层有program，默认work/service同XYZ。原doctor.work按全层hash，patient.healing/service只ground；单加pair守卫会破坏默认相遇，所以包含医生独有ground优先路由。实际新增测试选了真实生成current-v4的一间clinic/一个原hash上层doctor，证明公共ground点支持和选择/fallback行为；不能外推所有诊所的自然出勤或医疗覆盖。core-clinic为未标记旧合同。

## 夹具控制和资金证据

七项旧源反例和候选生命周期使用完全相同fixture/regression文件：

- fixture SHA256 `242aa19efabfaf79ff14489f95d609bd5e0ec8a1d2d88c5ce35e008f0404a526`
- regression SHA256 `c21b3bed0a443a8bdf650a1f6376ac067ddd1aea9fff7b293e3cffdb31edd717`
- 候选contract九项 SHA256 `8a8116872dfff02ce0c08d8981a357259b3c1fb3f3bb892084dab1f9a47b71e1`

世界建筑60m间距，constructor原生doctor是citizen-4，其home→clinic实际路网301.3921819126833m；两名原生官员citizen-6/citizen-14的home→hall实际路网422.78436382536665m。测试在运行前断言这三人原任职及路程<=500，不直接写身份/workId/cash/wage。初始玩家600由原初始化取得并记原log。

为隔离pair和路由两种原因，生命周期fixture明确把具名actors固定在真实站点/家门，并稳定其needs；仅这些controls中actor的同site `setDestination` 被覆盖。core functionpoint/body/有限employment/真实registerAttendance仍执行，clone安装相同listener并逐tick完整 `exportSave()` 字节对比24tick。生成world路由九项中相应default测试没有这个覆盖。控制函数逐字节摘录在 `evidence/controlled-route-function.txt`，SHA256 `449989165ea7a42861def227af9df6722ab17446e8a8a43bd9face2a4beac50e`。这是明确控制fixture，不称默认通勤/原生玩家导航/自主医疗恢复。

公共服务确实走filePetition、现场联署、两名原有在岗官员、40授权及真实物料收据；审批deadline用现有测试相同的保存时钟控制，不称自然跨日政治制度已经验证。paid30真实转escrow，actualquote买1，20分钟完成后只有剩余实际服务费入公库。每项保现金/材料/分钟强断言。

总物理现金穷举公库、税托管、钱包、实际bank.cash与legacyInvestmentCash、非公司shop.cash、company.capital、Organization.funds、pregnancy.escrow、family.households.balance、playerLabor.job.escrow、clinical订单escrow。不把publicBudget.cap、工资债/存款镜像当现金。函数摘录 `evidence/physical-cash-function.txt` SHA256 `689a56b0fa6e0dac446663096d8c58e85381fa6717405711b56b2f19e3ff4e96`。

动态cube案例先断言诊所原native build ACL拒绝且完整save不变，再用合法完整保存schema把现有block32→31加入一枚0.2m cube；不是原生命令成功建造。堵站保已赚6、已购1、未赚escrow，save24保持，移除同枚cube/回收原block后实际补14才完成20。路由fault injection只验证fallback控制流，不冒称默认ground存在实体障碍。

## 实际运行结果和保留失败

| scope | owned PID | exit | 实际结果 | 起止输入freeze |
| --- | --- | --- | --- | --- |
| original-seven-03 | 182016 | 1 | 7项：2 PASS / 5真实behavior FAIL | original41输入不变，生产36源与actual14相同 |
| strict-05 | 182275 | 0 | 最终候选tsc --noEmit | 48不变 |
| candidate-sixteen-01 | 182334 | 0 | 16 PASS / 0 FAIL / 0取消/跳过 | 48不变 |
| related-clinical-culture-v4-01 | 182455 | 0 | clinical21+culture15+v4services2=38 PASS / 0 FAIL / 0取消/跳过 | 48不变 |
| build-01 | 182508 | 0 | tsc --noEmit + Vite真实build | 48不变 |

Vite实际入口 `candidate/dist/assets/index-DE32DbEy.js`。所有时间只functional；没有基准/硬件/渲染吞吐结论。每个scope各自保PID、UTC起止、cwd、argv、exit、raw.log、before/after SHA。`evidence/run-results.json`是这些原件的索引，`owned-jobs-released.json`记录11个自有运行PID已退出、0signal；未控制他人进程。

有效原源五项失败分别是跨层paid20!=0、paid暂停阶段2!=0、跨层public20!=0、cube堵站后12!=已赚6、前序不匹配public患者20!=0。原共享两槽与未标记旧合同两项PASS。所有失败是使用旧源已有export执行，未把新helper不存在当反例。

更早原件完整保留：original-seven-01为0/7（100m间距使原生doctor招聘实际route>500，前提不成立）；original-seven-02为1/7（旧合同PASS，六项在清route后重新规划导致未funded在岗的夹具前提失败）。这两轮不是五项行为反例。strict-03虽tsc exit0，但wrapper cwd错在prototype根，前后freeze含0个输入，明确排除SHA证明。strict01/02/04都是中间source，不并入最终候选验证。一次相对copy命令exit127没有启动Node，没有伪造run记录。测试文件作者在GO前留下的“尚未跑原源”注释为历史编写状态；最终结果以本README和原log为准，未为了注释改动冻结测试字节。

最终新16内容：七项上述原源兼容/行为回归，加九项同层双站和3.6m同站、ACL/.35支撑、partial离层续接、真实默认医生ground与其它职能原hash、ground路由失败fallback、无声明ground站fallback、groundcube保旧upper、原groundroute新增cube后重规划、work清空而旁边service堵/无支撑不优先。公共后序案例后面三名同站者仍只两人完成20/耗2，第三人0，未扩医生容量。

## 接合与剩余边界

`evidence/patch-apply-check-final/`证明三补丁在actual14上只读apply-check exit0，没有实际apply。当前共享版本与actual14差异须由root按具体上下文review，再做同源联动验证；本候选不能替代shared全套。48全SHA、三补丁和失败原件保持，未改共享memo/root审计或src。

默认医疗覆盖/自然到岗排班、疾病诊断与药房/卫生病毒、政治P1与培训任命/预算修订、教育课程、能源计量、长期食品/财政稳态仍未在本次验证。下一步是root将认可的三个production差异与三个测试文件接合到coherent15并冻结构建/相关联动；ZIP与Library需另有GO，当前没有新包或ID。
