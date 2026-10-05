当前医疗状态：**actual03真实FAIL / source318 stable / owned active[]；1patient未治疗，6目标未完成。** 源码无diff；本组按 root 当前指令 **SEALED**，不再修改。后续工作另立NEW组，不改本组、旧SEALED预算组或共享源。

先读 `REPORT.md`、`RUN-INDEX.json`、`ACTUAL03-STAGE-BINDING.json`；实际失败原件为 `actual03/raw.log`、`actual03/receipt.json`、`actual03/artifacts/FAIL-summary.json` 和 true terminal4 `actual03/artifacts/frontier.save.json`（SHA `74b488c8e3c39d762b90613f50c2cf97aa34bd89c54ef8027ebdef2f4cdeccce`）。所有318源码原件在 `source` 及 `actual01-source-as-run`，精确清单 `SOURCE-INPUTS-318.json`；不要把 root 后续helper或新graph结果混入本次归因。

真实断供诊断 `TERMINAL-WORKER-FOOD-DIAGNOSTIC.json` / `TERMINAL-GIFT-SUPPLY-DIAGNOSTIC.json`：厂owner55和farmowner11饥饿0/过期工班、库存0或不足整份，无原door等待；HOST ref/meal不会造路、粮、钱、岗位或工时。远区有限购粮再合法赠粮方案 `GIFT-LIFE-SUPPLY-PLAN.md`，0Sim motor路线 `GIFT-ROUTE-PREPARED.json`；往返1074.74米/896等效`.25`帧，超已有512，且当前医生授权仅day7，真正远途后要新的原双委员现场paid审批。

已type PASS的HOST-only候选 `public-health-policy-continuation.mts` / `POLICY-CONTINUATION-PREPARED.json` 原状态为 **PREPARED_NOT_RUN**，root 当前状态 **PAUSED_NOT_RUN**，driver SHA `29825435f94675ed9cda392abf437647a7f7f9bb6f28e39d1158330300c35794`。该driver带真terminal→ref新SHA→meal新SHA的HOST二步receipt及marker剥除原业务相等断言；候选界NEW512普通`.25`帧/speed16/cap600，旧240fail界不扩。root已认定没有当前门误阻针对性、不期待修复断粮/断薪，暂不运行。下式只保存此前准备的精确command来源，**不是执行指令**，`continuation01` 尚不存在；将来若明确新目的须在NEW组建立新source/driver/bound，不向本SEALED组运行：

```
python3 /workspace/yunshan-work/ROOT15-public-health-player-20261004-01/run-phase.py /workspace/yunshan-work/ROOT15-public-health-player-20261004-01/source /workspace/yunshan-work/ROOT15-public-health-player-20261004-01/continuation01 '["node","--import","tsx","/workspace/yunshan-work/ROOT15-public-health-player-20261004-01/public-health-policy-continuation.mts"]' 600
```

若后续另NEW scope运行，在phase前保存冻结driver/stagebinding和完整inputs；结束后保PASS/FAIL/timeout、真末档、rawhash、墙钟时间、before/after及owned PID/startTicks清理。生活gift支援为conditional NOT_RUN，需正常开放/有限未来offer/实到同层及真实未来publicreview，不能借旧day7授权。11 road components不连并未阻止玩家free-terrain W，但原NPC chooseFacility要求finite road tree；后续正式设计NPC terrain walking/城市诊断或合法有限身体搬运，不能手改图/needs。root先审计新默认日供需。

未来真1patient成功仍不得报成6公共目标、自然NPC医疗；卫生batch只来自原耗材消费，full/partition+24只在真实患者成功后执行。本组仅提供本地producer，Library由root统筹；封存/暂停来源是root工作安排，不能说成用户禁止。
