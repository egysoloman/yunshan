"""Plot retained full native saves; this script does not run the game."""
import argparse, gzip, hashlib, json, os, pathlib, tempfile

os.environ.setdefault('MPLCONFIGDIR', str(pathlib.Path(tempfile.gettempdir()) / 'root22-mpl'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager

p = argparse.ArgumentParser()
p.add_argument('--artifacts', required=True)
p.add_argument('--out', required=True)
a = p.parse_args()
source, output = pathlib.Path(a.artifacts), pathlib.Path(a.out)
sha = lambda value: hashlib.sha256(value).hexdigest()
frames = json.loads((source / 'primary/FRAMES.json').read_text())
series = []
for frame in frames:
    saved = frame['save']
    raw = gzip.decompress((source / saved['file']).read_bytes())
    assert sha(raw) == saved['sha256']
    state = json.loads(raw)['state']
    job = state['hydroMaintenance']['job']
    grid = state['powerGrid']
    series.append({'tick': state['tick'], 'at': frame['at'],
        'workedMinutes': job['workedMinutes'] if job else 0,
        'escrow': job['escrow'] if job else 0,
        'purchasePaid': job['purchasePaid'] if job else 0,
        'serviceFees': job['serviceFees'] if job else 0,
        'paidWage': job['payment']['amount'] if job and job['payment'] else 0,
        'servedKW': grid['dispatch']['servedKW'] if grid['dispatch'] else 0,
        'transferredM3': grid['hydro']['transferredM3'],
        'generatedKWh': grid['hydro']['generatedKWh'],
        'status': job['status'] if job else 'not-requested',
        'fullSaveSHA256': saved['sha256']})
assert len(series) == 162 and series[-1]['tick'] == 160
dataset = {'scope': 'Actual six-building other-city full-save checkpoints; no Simulation or renderer run by this plot.',
    'sourceFramesSHA256': sha((source / 'primary/FRAMES.json').read_bytes()), 'series': series}
output.mkdir(parents=True, exist_ok=True)
(output / 'maintenance-actual-data.json').write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + '\n')
font = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
font_manager.fontManager.addfont(font)
plt.rcParams.update({'font.family': font_manager.FontProperties(fname=font).get_name(),
    'axes.unicode_minus': False, 'font.size': 11, 'axes.spines.top': False, 'axes.spines.right': False})
fig, axes = plt.subplots(3, 1, figsize=(12.8, 9.8), sharex=True)
fig.patch.set_facecolor('#f7f7f1')
fig.subplots_adjust(top=.85, bottom=.14, left=.11, right=.94, hspace=.28)
fig.suptitle('ROOT22｜维修完成，工资结清后才恢复供电', x=.11, y=.967, ha='left', fontsize=21, fontweight='bold', color='#15383b')
fig.text(.11, .916, '真实工程师、有限材料与资金；全部数值取自已保存的原生完整存档。', color='#51696a')
x = [r['at'] / 60 for r in series]
for axis in axes:
    axis.set_facecolor('#f7f7f1')
    axis.grid(axis='y', color='#dce3df', linewidth=.7)
    axis.axvline(17, color='#b95b48', linestyle='--', linewidth=1.3)
axes[0].step(x, [r['workedMinutes'] for r in series], where='post', color='#126d70', linewidth=2.5)
axes[0].set_ylabel('工程师现场工时\n分钟')
axes[0].set_ylim(-4, 70)
axes[0].annotate('09:08 · 60分钟劳动完成', xy=(548 / 60, 60), xytext=(10.15, 43),
    arrowprops={'arrowstyle': '->', 'color': '#126d70'}, color='#126d70')
axes[0].text(13.8, 64, '等候原工资实付，设备持续停机', color='#94602d', fontsize=10)
for key, label, color in [('escrow', '未用托管', '#c48b35'), ('purchasePaid', '实购物料款', '#8caaa3'), ('serviceFees', '已付维护服务费', '#126d70')]:
    axes[1].step(x, [r[key] for r in series], where='post', label=label, color=color, linewidth=2)
axes[1].set_ylabel('玩家维护资金\n文')
axes[1].legend(loc='center left', frameon=False)
axes[1].annotate('17:00 原工资毛额44.12864实付\n余96文托管结为公共维护服务费', xy=(17, 96), xytext=(12.7, 65),
    arrowprops={'arrowstyle': '->', 'color': '#b95b48'}, color='#944638', fontsize=10)
axes[2].step(x, [r['servedKW'] for r in series], where='post', color='#126d70', linewidth=2.5)
axes[2].set_ylabel('电网实际供电\nkW')
axes[2].set_ylim(-.5, 15)
axes[2].annotate('17:04 下一能源阶段\n11.5 kW；31.260618 m³；0.766667 kWh', xy=(1024 / 60, 11.5), xytext=(11.5, 8.1),
    arrowprops={'arrowstyle': '->', 'color': '#126d70'}, color='#126d70', fontsize=10)
axes[2].set_xticks([8, 9, 12, 15, 17, 18 + 40 / 60], ['08:00', '09:00', '12:00', '15:00', '17:00', '18:40'])
axes[2].set_xlim(8, 18 + 40 / 60)
axes[2].set_xlabel('主实例原生游戏时钟')
fig.text(.11, .071, '另城6建筑；主实例160步，三个新恢复实例各24步，共232普通step。一次玩家现场定位，NPC未定位或改身份。', fontsize=9.6, color='#51696a')
fig.text(.11, .048, '维护材料4文、服务费96文；工程师工资由原公共雇主支付。图表不代表设备购建、补水、默认612城水电或参考美术完成。', fontsize=9.2, color='#51696a')
path = output / 'maintenance-actual.png'
fig.savefig(path, dpi=150, facecolor=fig.get_facecolor())
plt.close(fig)
receipt = {'artifact': path.name, 'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size,
    'dataSHA256': sha((output / 'maintenance-actual-data.json').read_bytes()),
    'fullSaveCheckpoints': len(series), 'source': str(source), 'newSimulationRuns': 0, 'imageEditing': False}
(output / 'CHART-RECEIPT.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
