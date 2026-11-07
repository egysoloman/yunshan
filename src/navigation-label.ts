/** The navigation strip's distance label. A walking or transit goal reads in metres to its
 * real entrance; once the player stands inside the goal building it reads as arrived
 * (the entrance can be metres behind the counter). A district target reads in m / km. */
const rounded = (n: number) => Math.round(Number.isFinite(n) ? n : 0).toLocaleString('zh-CN');
export function routeDistanceLabel(input: { goal: boolean; metres: number; inVehicle: boolean; insideGoal: boolean; districtRadius: number }): string {
  const { goal, metres, inVehicle, insideGoal, districtRadius } = input;
  if (goal) return insideGoal && !inVehicle ? '已到达 · 室内' : metres < 8 && !inVehicle ? '已到实际入口' : `${rounded(metres)} m 至入口`;
  return metres < districtRadius ? '已抵达城区' : metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${rounded(metres)} m`;
}
