# 系统与2D、3D、文字表现：当前真实边界

静态审计基于coherent08，与本轮coherent09的世界与表现入口字节相同。不是已经实现独立2D/文字客户端，也不是一次新的runtime验收。

核心Simulation的19个本地运行时依赖闭包没有Three.js、Renderer或DOM依赖；它使用普通TypeScript状态、固定十阶段、命令与存档。WorldDefinition/Building为数据，world及architecture-floor-plan生成权威楼层、门、权限、fixtures和用途点，renderer读取这些数据生成mesh。此次实际2D地图同样直接读取World/平面数据，没有调用3D渲染器或推进Simulation。

UI命令通过UIActions.command→main.execute→Simulation.command；Renderer.update读取状态更新自身图形。尚未完成的分离是入口与玩家移动：main从3DController写player.position/航空input、设置focus，并由RAF/document.hidden驱动时钟；controller仍依Three/DOM处理行走和碰撞，WebGL失败会阻断入口。UI的可用性也读取walk/inside/nearby的ViewState。现有小地图不代表能独立运行2D或文字游戏；types还混有表现类型，共享状态/API可变。

后续公共宿主应持有时钟、command/save、只读snapshot及合法动作/原因；无Three的运动服务按真实route、权限、碰撞与elapsed移动，供2D/文字/3D输入共用；observer focus应与actor位置分开。表现层仅读取状态和提交输入，不能自行修改钱包、需求、身份或通过改坐标跳过旅程。这个adapter尚未实现，本轮没有为它改写现有客户端。

实际审阅入口：simulation.ts imports/step/setFocus/command；world.ts v4描述；architecture-floor-plan.ts共享平面；ui.ts UIActions；main.ts execute/RAF/controller；controller.ts移动与碰撞；renderer.ts update。完整状态机和经济仍有未完成项，表现层分离不能代替它们。
