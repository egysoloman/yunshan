# ROOT25 native02输入排队局部记录与最终中止失败

只读既有原action，未执行browser或输入。以下原局部记录写于native02运行期间，当时最终门PENDING；随后原RESULT与OPERATOR_ABORT_PARTIAL已封存，最终失败追加在末尾，入口/购买/完整保存/退出尚未全部验证，不宣称完整PASS。

两次W均请求200ms，但原trusted DOM与原Controller accepted timestamps一致地记录6054.39999999851ms和3364.89999999851ms。原件：

- `/tmp/ROOT25-reference-browser-originals/native02/00009-W-public-road-to-market-1.action.json` SHA `40dea11898d4bdfe2541778a4006871b60be729a0b305752e598938836191024`，keydown323747.19999999925→keyup329801.59999999776，两event trusted=true。body走4.804391517760694m，tick80→104；初始`(-279,80.4,408)`→`(-280.89081263317917,80.60537248097373,403.58810385591414)`，insideId仍null，实际curb脚高按原support抬起。
- `/tmp/ROOT25-reference-browser-originals/native02/00010-W-public-road-to-market-1.action.json` SHA `8b93552fff9aa1e1c7b176af619cd3686deae05ed96a462e7b6b511ea2facb99`，keydown359764.30000000075→keyup363129.19999999925。body再走4.804391517760694m，tick104→128，终点`(-282.78162526635833,80.4,399.1762077118283)`，insideId真实变为market-b26/floor0。

这两笔局部原action status为PASS；自然W已穿实际门进入market-b26有原body/insideId证据。没有E-enter动作通过的证据，不能把自然W入店写成E进入PASS，也不能把仍求门口1.8m目标的私有driver当全部购买流程完成。后续摆荡或超预算是否发生须等原最终回执。

root指出private v2的调度先await Playwright keydown回执，再由host等待200ms才发送keyup；软件GPU renderer忙时回执等待已消耗时间，导致真实held时长远大于requested200ms。实际trusted与accepted一致，不能沿用native01“捕获pre-handler accepted错位”解释这两笔。root正在预备独立private v3，从调用keydown时立即计时并发排队原real keyup，await两命令；游戏、原120s总W预算、阈值、冻结417输入与build不改。此为待核driver scheduling修正，尚不宣称其已运行或成功。

当时native02继续原绑定版本运行；旧原件不修改，最终FAIL/PASS按其独立receipt/RESULT保留。观察中软件GPU事件等待不作为Mac实机帧率或性能结论。

## 最终失败与operator中止追加

root在2026-10-07T08:32:10.690942Z核owned PID28302/startTicks1745280后SIGTERM，停止失效timed-key protocol；`browser02/OPERATOR-ABORT-PARTIAL.json`原status为OPERATOR_ABORT_PARTIAL，SHA `f7363fbcaaaf34925e6b2c55a775f05000b95d736f7a9cea21e43c38e934bbea`。原记录明确：last完整before/after save保留，任意被中断frontier未导出，不能称完整终档捕获。最后完整action是00013-native-ui-pause，body `(-282.3922127901785,80.4,400.07882920780696)`、真实在market-b26；这个位置不能冒E pair/购买/保存通过。

wrapper实际08:22:30.361466→08:32:16.203572 UTC/585.842106s，FAIL/exit1/timedOutfalse、417stable/active[]，raw SHA `56da7212a8587e89a39433c484a596da8591704b05cadb24937dd1ac35e629a8`。native02原RESULT SHA `028ddcffa3d03de84c6d36e3c22d51a688d3db05b88a381ea0d8701f623a0c1d`，FAIL、结果前原件23672477B、13完整actions与2真实PNG；failureSave=null。

`Target page, context or browser has been closed`发生在nativeE入口函数调用action的**before(snapshot)**阶段，原E输入尚未被该action验证；这不是原E使用失败的产品结论。全部FAILED/OPERATOR_ABORT/PARTIAL、原capture与原save保留，不补猜中断frontier。

root已绑定v3：BOUND-PLAN03 SHA `ec42c37d6ecbbc8f923a10bee3fb648b3ab6c90bdda1af9253deb3120edd73ed`、driver SHA `864d99e80ea183b53cd4d8b55ca050be082072677014dd3927450a5cd899149b`，同原417input graph/build，不重复build。v3从keydown调用即排队host200ms realkeyup并awaitBoth；真实trusted输入/native事件时间/原120s总预算/阈值保持。browser03 `/tmp/ROOT25-reference-browser-originals/native03`是新fresh门，当前PENDING最终独立receipt/RESULT，不能回填native02。
