/** Display only: after a successful purchase or meal, the message also tells
 * what the player's body actually gained, read from the player's own state
 * before and after the command (web App and native host alike). */
export interface MealBody { hunger: number; food: number }
export function mealFeedback(type: string, before: MealBody, after: MealBody): string {
  if (type !== 'purchase' && type !== 'eat') return '';
  const parts: string[] = [];
  const gained = after.hunger - before.hunger;
  if (gained > .05) parts.push(`饱腹 ${Math.round(before.hunger)} → ${Math.round(after.hunger)}`);
  const carried = Math.round(after.food - before.food);
  if (carried > 0) parts.push(`随身食物 +${carried}（共 ${Math.round(after.food)} 份）`);
  else if (carried < 0) parts.push(`随身食物剩 ${Math.round(after.food)} 份`);
  return parts.length ? `${parts.join('，')}。` : '';
}
