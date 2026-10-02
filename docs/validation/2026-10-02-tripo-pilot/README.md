# Tripo 市集灯笼首件：实际连接与离线计划

2026-10-02。**尚未生成模型，未扣生成积分，未完成接入或美术验收。**

已从官方 CLI 路径安装 `tripo-cli@0.5.1` 于仓库外，不改变本游戏依赖。按 [Tripo CLI 官方文档](https://developers.tripo3d.ai/en/docs/cli) 实际运行本地 dry run：exit0 / validtrue，自动选择 `P1-20260311`，一个 text-to-model 请求，1800 face budget / PBR / standard。`dry-run.json` 是原始计划；这是离线参数检查，不是服务端成功。

使用用户提供的临时凭据做只读余额检查，实际 exit7 / `network error: fetch failed`，原结果保留在 balance.json / balance.stderr.log。两次不含凭据的官方 API 域名 HEAD（默认环境与获授权 escalation）均得到代理 CONNECT403 / curl exit56；status.json 如实记录这两次工具观察，不能把它当新增原始 stdout。尚无法判断临时密钥有效性或账户余额，不能把网络失败说成密钥无效/额度不足。

灯笼提示词与材质风格见 request.json；[第一批美术规格](../../美术资源制作规格.md) 来自实际参考图1–5与旧 coherent05 三图目视。该规格明确旧 baseline 尺寸和机位，不能把旧快照当新 v4 实机。当前用户之前的范围排除了付费，已请求单独确认首件最高40积分（约0.40美元）。[P1 官方价格](https://developers.tripo3d.ai/en/models/p1) 的标准贴图文生模型列40积分；本计划不包含额外纹理、转格式、绑定、付费重试或充值。授权与网络必须均满足才能提交生成。

凭据只在仓库外私密目录供环境变量读取，不进入源码、日志、截图、ZIP或Git提交。这里所有可交付原件均不含密钥；不记录密钥前缀/尾号。

下一步：连接恢复且费用获授权后仅提交已核计划一次，等待CLI原生任务完成并下载GLB/preview/task记录；查看原始预览，检查实际mesh triangles、PBR、米单位和枢轴，再在共享实体门侧做bounded实例接入。纸罩发光/门口净空、白天夜间、近区释放、真实玩家可通行都须实跑。生成一件道具不能证明粗坡、大檐和空街已返工完成。
