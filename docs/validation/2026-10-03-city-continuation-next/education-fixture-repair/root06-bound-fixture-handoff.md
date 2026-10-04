本交接取代此前 position-only patch。最终 root06-player-order-bound-fixture.patch 仅改 tests/education-fixture.ts 与 tests/resident-formal-education.test.ts；未改 ROOT06/shared/src。

ROOT06 原组真实 117 PASS / 1 FAIL / 3 SKIP，原件保留。独立直接导入 immutable ROOT06/source 后原 helper/原负例仍同断言 FAIL。原 service-2 真实40购4.069/6教材未消失；新增居民 citizen-0 在听证后遗留大厅真实自主发起教育请愿，玩家二次调用对应 service-3 真实30.48购6，所以 .at(-1) 混淆了它与资源不足单。

修正输入：听证后临时signers回原家，保留工业原owner/workers、两原工资reviewers、本课堂原学生的位置和工作。修正定位：E1 helper 用 ID 差集+player author+education topic 确认本次唯一新petition，再通过其executionId查真实单；负例也独立按该次player petition与对应executionId/petitionId查单，避免其它居民自治单混淆。未禁用/删除自治、订单或需求；不改工资、供价、预算、钱、料、学历。

最终窄负例已1 PASS /0 FAIL /0 SKIP exit0（5.96秒）；原40实付/部分教材不足/正式资格不涨/逐lot采购来源/完整trusted reader与partition+1x24原断言全部保留。相关E1/public四项窄验证另运行，不称ROOT06全组已经重跑或全PASS。子代理未上传Library，由root统一打包。
