# 公司产权/家庭死亡/租约结束只读正确性审查

结论：发现一条真实原生流程的经营资产接续缺口。公司化租赁结束或房东死亡后，钱和股份的保存链闭合，但旧租赁公司壳永久锁住所属房东的原经营资产；亡者遗产甚至登记为 settled，却没有将该经营资产交给真实继承人。此处不是恶意档、安全扫描或余额凭空丢失。

审查基线：从共享当前 core `9d06a11295fee68170530f2fc0a810a57c7f1f13f228eab0d087f8fb4dc139c2` 的54个src文件做稳定只读copy，接 delivery 四个production窄hunks（types、simulation、extensions、shop_lifecycle），没有将旧core整文件覆盖共享。隔离core SHA `af08cc478dbd137219b1255ec0f1bf71aa89d1e5fcac109b3ea3f7caaf3fff1e`。共享未修改，没有GPU、长测或重跑旧four。

真实输入来自 economy 的 `final-target01/artifacts/sale-incorporated.save.json` 和 `lease-incorporated.save.json`，使用其 test 中原 compact world()。384个原NPC、余额、已支付的经营资产/租约/公司来自原保存，原保存在当前familyFee+patch下立即导入导出逐字一致。受控前提仅原互相配偶（可读开局）和一名原角色terminal health=0；后续死亡、租约解除、工资/金融/遗产全通过普通 `Simulation.step(.25)`，没有手写estate、股权转移或退款。

## 可复现经营资产缺口

`probe.mts` 第三个死亡场景：读真实 lease-incorporated 保存，给原 lessor citizen-6 设置合法互相配偶 player及 terminal-health 前提，正常4tick。原生 endLease 后 rent arrears=0、depositEscrow=0、depositRefunded=6、advanceRefunded=200；ownerCashEscrow80→0/ownerCashReturned80，公司资本500→300。后续亡者实际434.21117050759494现金全部进入配偶，资金归属正确。

但状态是：

- `family.estates['citizen-6']`：heirIds=['player']，status='settled'，没有businesses回执。
- `title.assetOwnerId` 和 `shop.ownerId` 仍是已亡故 citizen-6；`shopLifecycleAssetOwnerId` 同样返回亡者。
- `shopLifecycleCanDispose=false`，`shopLifecycleAllowsSpaceUse=false`；原生保存可以立即逐字读回，错误生命周期没有被reader拒绝。

另第四场景：原 live landlord 正常退租、随后一普通finance tick。款项全部清偿，原房东仍为assetOwner/owner并在原工作点，但自己的 `restartShop` 和 `listShopForLease` 均被真实命令拒绝；不是离场或未归还垫款导致。

具体生产链（相对candidate源码）：

1. `src/simulation/shop_lifecycle.ts:99` operatorId 始终取 boundCompany.ownerId，租约结束后仍是租客公司负责人。
2. `:134` CanDispose 对任何 corporation永久false；`:207` 挂牌另直接拒绝corporation。
3. `src/simulation/family.ts:390` 继承原经营资产既要求CanDispose，又排除任何同building company，所以原房东的经营资产无法继承。
4. `family.ts:371` 仅凭银行 closed 将该estate置settled。`banking.ts:178` 的普通shop资产检查也排除companybuilding，结束且债务已清的lease不会再提供pending标志。
5. `shop_lifecycle.ts:141` transferBusinessOwnership 对corporation提前返回，不经过后面的合法遗产接续；`:512` validator 又将历史 lease.lessorId 与当前title.assetOwnerId强绑。仅强改title.owner不会形成可读的合法修复。

修复须区分历史租约/租客公司的资金股份与当前原房东经营资产。不要将租客company资本/股权交给房东，也不要删除租约、退款凭证、旧工资债或预授权。现有公司账本按building/shop查找资金，直接去掉company绑定会改变旧工资/货权资金来源，需要守卫接续。本审查未修改实现；已将脚本/源索引交给 economy，根决定修后再freeze。

## 通过的窄保护

- owned corporation 原founder player死亡：原生1000股全部交给原heir citizen-6，公司owner正确变更，capital保持2095.9428443570873；公司owned-site使用许可仍有效，保存逐字可读。原shop.owner保持founder仍符合明确的corporate镜像规则。
- leased corporation 原tenant player死亡：lease结束、全部押金/垫款实际返tenant，实际10银行债支付后197现金及1000股继承给配偶；company.owner正确变更，capital300，site use保持终止，保存逐字可读。
- landlord死亡和live退租的现金归属如上均正确；在这三个死亡场景各4个普通ticks中，保存均即时逐字可读。这不是14日稳态或自然结婚/到岗证明。
- 真旧 funded lease fixture保护：`shopPayrollDebt=73.57789711103706`、`shopProtectedFunds=1587.674289`；真实foundCompany300被拒绝，完整保存原字节不变。没有挪出预授权工资现金。单独 `payroll-probe.log` / `payroll-receipt.json` 和原保存保留。
- corporate镜像的新校验 `simulation.ts:2252` 排除companybuilding，与实际注册/股份继承后 runtime.playerBusinesses 一致；本次未复现镜像破坏或自己导出存档拒读。

原4case `probe.log` 的执行工具实际exit0；补齐工资保护后又记录五场景 `probe-combined-final.log`、`receipt.json`，执行输入前后56文件SHA无变化（54src+两driver）。后者启动wrapper只输出了output，因此没有保留独立session exit元数据；最后一条工资完整保存不变断言及五场景收据均已写成，不冒称另一个正式Node测试套数。没有运行24续演/旧four/全套。

原件：`evidence/*controlled-before.save.json`、各正常after1–4 native full saves、`lease-ended-native-next-finance.save.json`、`original-funded-lease-rejected.save.json`，以及完整本域 source/driver输入SHA清单 `combined-probe-inputs-before.json` / `combined-probe-inputs-after.json`。来源copy稳定性在 `shared-readonly-snapshot.json`。没有推送、上传或改共享源码。
