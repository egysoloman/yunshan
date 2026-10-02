# 云山：首夜原始失败、公共休息窄修复与独立续演证据

此包保留原始失败，不将不同代码版本的结果合并为一次通过。

- coherent10：默认 seed20261001，从真实08:00以已授权speed16、step(.25)运行360主tick至翌日08:00。原result仍FAIL（六条）：五条警方公务覆盖留下rest标签造成的审计误纳；一条563真实满床且本区无公共休息、反复unreachable。原81文件/126,697,911字节全部逐字保留。04:00原save和24双实例逐字续演通过；单夜不是全城长期稳态验收。
- 原CPU profile完整保留。原耗时解析因七个负timeDelta失败，count-only独立诊断也保留；samplecount不是时长/FPS/macOS性能结论。观察器开销独立标注，不能当生产基准。
- v1候选sim4234f040…：90实际tick至06:00仍在途、PARTIAL；另15实际tick至07:00真到core-b16公共service、净疲劳恢复及24逐字续演通过。原“reservations”字段过宽的命名另有澄清文件；无人工修改不表示预约恒定。全部先前fixture失败、错误解析尝试和原始日志保留。
- minimal-v2 / coherent11 simba289751…：只在night && !homeBedAvailable时跨区加入pavilion/station/clinic公共rest后continue；本区social/rest原调用位置、travel cap150、原评分/权限/费用/速度/资金/床和存档规则保留。正式10项纯依赖测试和strict通过；正式测试没有全局sort monkeypatch或写回执分支。原始order诊断仅在独立进程中，old10/v2完整order逐字相同。
- coherent11：独立从原240/00:00save运行105主tick，07:00真实到core-b16站点floor2；.35支撑盘、1.72静态身体净空和权限成立，首次净疲劳恢复+.25506686701904613。途中无正恢复；实际三次4文交通费用。之后保存/import及24实际双实例全save逐字一致。此项真实结果有独立11哈希，未借用v1通过。
- 审计selector的12项纯记录回归保留；未来审计应采集当前真实警务dispatch/crime/public资格，不能仅凭responding字符串放行，563重复failedselection风险继续硬报。没有新自然首夜重跑。

完整11全套NOT_RUN（此包不冒充09 full496/10 DOM35）。公共服务筛选仍可能遇到内部路由/体素动态条件缺口；免费NPC公共rest、玩家收费、站点不供粮等原规则没有被本修复扩展。本次解除满床夜间本区无休息候选的循环，不能称默认全城补给、长期财政或生命稳态完成。

目录：audit10为原准备/完整首夜/CPU profile/只读诊断/v1/v2；frozen-sources为09(102)、10(103)、11(105)完整输入；coherent11-actual为本次105+24原件；audit-input-dependencies为原容量审计依赖。原脚本内绝对路径是来源记录，包并不声称无需路径映射即可直接运行。未复制node_modules、 inherited dist/UI artifacts、环境变量转储、认证/签名传输或Git凭据。Library helper准备保留在包外，上传等待root单独GO。

manifest.json列每个payload成员大小/SHA及原路径，递归自哈希文件除外。SHA256SUMS另包括manifest。外部archive-verification.json记录CRC、所有ZIP成员与staging逐字比较、所有原源首尾一致及ZIP SHA。原档/原FAIL/原profile不得覆写；README是解释，原件是事实依据。
