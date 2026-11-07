/** Display only: one line naming what a place offers, for the context panel seen from the street
 * (the buttons themselves stay one click away and keep their own enablement). */
export const PLACE_SERVICES_SHOWN = 4;
export function placeServicesSummary(labels: readonly string[]): string {
  const names = [...new Set(labels.map(label => label.split(' · ')[0].split('，')[0].trim()).filter(Boolean))];
  if (!names.length) return '这里可办理的事项';
  const shown = names.slice(0, PLACE_SERVICES_SHOWN).join(' · ');
  return `这里可办理：${shown}${names.length > PLACE_SERVICES_SHOWN ? ` 等 ${names.length} 项` : ''}`;
}
