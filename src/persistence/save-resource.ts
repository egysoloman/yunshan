/** Old envelopes keep their exact character guard. Version four reserves a
 * separate bounded archive budget; it does not increase any live array cap. */
export const LIVE_SAVE_CHARACTER_LIMIT = 8_000_000;
export const CIVIC_ARCHIVE_BYTE_LIMIT = 16 * 1024 * 1024;
export const FULL_SAVE_CHARACTER_LIMIT = LIVE_SAVE_CHARACTER_LIMIT + CIVIC_ARCHIVE_BYTE_LIMIT;
export function parseSaveWithinResources(json: string): Record<string, any> {
  if (typeof json !== 'string' || json.length > FULL_SAVE_CHARACTER_LIMIT) throw new Error('存档超过完整历史格式的资源限制。');
  const document = JSON.parse(json);
  validateSaveResources(document, json);
  return document;
}
export function validateSaveResources(document: Record<string, any>, originalJSON?: string): void {
  if (document?.version !== 4) {
    if ((originalJSON ?? JSON.stringify(document)).length > LIVE_SAVE_CHARACTER_LIMIT) throw new Error('存档大小超过8MB限制。');
    return;
  }
  if (!document.state || typeof document.state !== 'object' || !document.state.civicHistory) throw new Error('历史存档缺失完整档案。');
  const { civicHistory, ...state } = document.state;
  if (JSON.stringify({ ...document, state }).length > LIVE_SAVE_CHARACTER_LIMIT) throw new Error('存档活跃数据超过原8MB限制。');
  if (new TextEncoder().encode(JSON.stringify(civicHistory)).byteLength > CIVIC_ARCHIVE_BYTE_LIMIT) throw new Error('公民历史存储不足；原完整档案必须保留。');
}
