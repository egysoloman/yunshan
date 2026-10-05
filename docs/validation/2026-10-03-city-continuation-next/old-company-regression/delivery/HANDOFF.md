# ROOT07 原四公司回归与真实工资融资夹具修复

本轮仅运行 `tests/v4-extensions.test.ts` 四个原公司用例，未重完整套件、未碰其他进程/GPU/14日审计。ROOT07 原四案在 2026-10-04 01:26:47–01:39:18 UTC 真正结束：**3 PASS / 1 FAIL / 0 SKIP，非 TIMEOUT**。原 raw SHA256 为 `1ed7bb00f34277399175b12d46ab2bb746665bff20c94857a6180994ea083a93`。

| 原用例 | ROOT07 四案原轮实际结果 |
|---|---|
| founding：远房、入口与合格个人现金 | FAIL：合法资产夹具要求借121文，但真钱庄现金0、无存款，因此原准备金守卫正确拒绝 |
| expansion / hiring：真实工作点、材料、工资及未完成守卫 | PASS |
| financial：真实银行点、有限发行股份和交换 | PASS |
| acquisition：另一房间拒绝及原股东结算 | PASS |

首失败前原课程实际完成60有效分钟、消耗1份实购教材，教育0→1；merchant考试真实扣款后钱包480文。远房、门、院落及未有经营资产拒绝全部通过。失败存档 `run01/artifacts/sim-1-event-0013-command-loan.save.json` 为2244319字节，SHA256 `3d233547805eb7e28e00c01ba3d06c0d7326d5a111ed621be5ae0305ad10e51f`。没有放宽银行准备金或注入钱包。

对比两条真实融资路径：

- **受控存款到场**：原失败存档全字节即时reader一致；将具名原银行职员citizen-78/citizen-309一次放到合法service点，原people phase真实各扣原钱包100、记各100存款债权。实借121后银行现金79，保留原20准备金，玩家601。独立probe PASS，但该到场是受控夹具，不能冒自然自筹。
- **采用原玩家工资路径**：原资格课程/考试不变，仅在不足601时开始三个原merchant工班。每班原雇主真实托管62税前工资，实际60分钟才支付；共180分钟、税前186（累计浮点值185.99999999999773）、净171.12、税14.88。钱包480→651.12，随后实际buyShop251和foundCompany350→50.12，贷款0。没有额外居民银行到场控制。玩家工作点到场和原卖家一次到场仍属原CPU几何夹具；不宣称自然步行创业旅程。

最终只复验失败的founding**原整案**，从原fresh600/身份traveler/08:00开始，实际课程241tick＋工资720tick，共961tick：2026-10-04 01:50:39–01:57:49 UTC，**1 PASS / 0 FAIL / 0 SKIP，非TIMEOUT**。241运行输入及2762外部driver、Node和私有安装依赖输入首尾同，active descendants0，1个Z保留。raw SHA256 `e9fd56b443c26d6012c991d0b5e17389281326fe4e8760d45017477953727125`。原四案3/1与这次单案1/0为不同scope，不能拼成一次4/4。

最终原生存档为 `candidate-player-paid-work/founding01/artifacts/sim-1-event-0027-process-exit.save.json`，2824000字节，SHA256 `a1f95040da01794d3add9d81d819eeb01f40a3087c205a2dcc45ff768d13395e`。它与先前真实tick720工资档reader后实际购买、创业的续演终局**全部字节相同**。课程60/1教材、工资180分钟/3班、学历1、贷款0均源于实际规则。自然NPC在三小时中存入银行500文也是实际状态，没有要求其保持0。

`node node_modules/typescript/bin/tsc --noEmit` 实际25秒PASS，241输入稳定、active0。没有额外重复公司或全套测试。

最终补丁只改变 `tests/v4-extensions.test.ts` 的融资前提helper及其说明；原四个test body、34条原assert、qualify/fundedMerchant逐字保留。before SHA256 `12d137106c0d0ae0d9f6ccd438b6bde3f1a6e77098e375c5645c24dbea39dff1` → after `0834ab99a952c506baa6d959a41c43fd00fff77b920d4ce193c608d529e591ea`。其他240个ROOT07运行输入及全部55个src输入相同。root已报告02:01守卫接共享test-only文件；本代理未写共享，ROOT07冻结源不改。

必须保留的失败与边界：

- 原ROOT05四案FAIL、原180/120秒TIMEOUT均不覆盖，仍NOT_VERIFIED历史结果。
- 本轮首原四案的**全2772依赖guard为false**：只有8个 `node_modules/.vite/deps/` 浏览器生成缓存变化，原guard false保留。其外2764个Node可执行文件、driver、安装包文件稳定。未对原进程采集live Node解析trace，不把全2772说成稳定。路径及前后hash在 `dependency-cache-boundary-audit.json` 和两份原external manifest；后续候选采用私有安装包副本，排除独立生成的`.vite`缓存，全部候选依赖guard实际稳定。
- 工资probe原FAIL：我额外要求银行现金始终0，实际原生NPC已存500；这是探针错误，不是银行bug。三班实际工资和原档保留，未重720tick。
- `asset-continuation01` 原FAIL：我把累计工资186作严格二进制比较，实际185.99999999999773；新v2外部driver采用原`close`的1e-7约定，source不改、三班不重跑，`asset-continuation02`实际PASS。两份FAIL raw/receipt/driver完整保留。
- 原金融夹具依旧包含既有居民等额2000转款、二级发行人level=2和700等额资本转款；不称完成实体扩建或自然积蓄。原资格helper控制具名教师站位与需要，真实资费/材料/60分钟仍执行；这些已有夹具约束未改。

完整证据索引见 `delivery/original-files-index.json`；逐SHA见 `delivery/evidence-sha256.json`。所有运行保存immutable SHA172ad82f wrapper、实际argv、raw、241首尾输入、owned-process及active/Z区分。当前独立检查所有自有组active0，Z保留、不杀其他PID。官方Library保存与Git由root统一；本代理未启动Library helper、未造ID、未commit/push，也不表示全部城市目标完成。
