/** Display only: the line under the district name (bottom left), one for day and one for night per
 * district of the product city. Where the reference town has one it is used as written (文澜学苑,
 * 松风里, 临岚坊); the generic lines remain for any other district (2026-10-22: seven of the eleven
 * districts matched no name rule and all read 「重峦之间，街巷与轨道连接一城生息。」). */
export const NIGHT_FROM = 19, NIGHT_UNTIL = 5;
export const DISTRICT_LINES: Readonly<Record<string, readonly [day: string, night: string]>> = {
  market: ['千灯初挂，摊肆沿阶，一城烟火由此而起。', '千灯齐明，夜市沿石阶而上。'],
  river: ['云影入水，桥与船连接两岸。', '水岸灯火，渡船沿溪而行。'],
  workshop: ['炉火映铜，匠作之声沿谷不绝。', '工坊尚明，货物流向远方。'],
  west: ['崖岫之间，街巷与轨道连接一城生息。', '松风入巷，家家窗下灯暖。'],
  academy: ['书山为径，文脉连云，学海无涯。', '书窗未熄，夜读声随风过廊。'],
  government: ['玉衡持平，议事与政令在此往来。', '官署灯明，城中诸事有人值守。'],
  core: ['瀑声入阁，开放的市政大厅迎接每位旅人。', '天枢灯明，市政与一城生息相连。'],
  summit: ['层峦在足下，山风穿过飞檐。', '登临高处，望一城灯火。'],
  east: ['沿山而筑，百工有序，车流不息。', '坊巷灯暖，晚归的人沿阶回家。'],
  airport: ['云端起落，远客与货物在此往来。', '跑道灯明，夜航在云下等候。'],
  starport: ['星舟泊岸，此城与星海相通。', '星港不眠，航灯指向天外。'],
};

export function districtLine(districtId: string, hour: number): string {
  const night = hour < NIGHT_UNTIL || hour >= NIGHT_FROM, lines = DISTRICT_LINES[districtId];
  if (lines) return lines[night ? 1 : 0];
  return night ? '夜色入山，万家灯火沿谷而生。' : hour < 9 ? '晨雾渐散，街巷间的一天正在开始。' : hour >= 16 ? '斜阳染檐，山城在暮色中舒展。' : '重峦之间，街巷与轨道连接一城生息。';
}
