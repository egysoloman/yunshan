/** The city's money is 云币. Some simulation messages and records (kept as
 * written in saves) count it in 文 after a number; shown to the player, an
 * amount always reads in 云币. Words such as 文化 or 文件 are untouched. */
export function displayMoney(text: string): string {
  return text.replace(/(\d+(?:\.\d+)?)\s*文(?![化字件档书学章])/g, '$1 云币');
}
