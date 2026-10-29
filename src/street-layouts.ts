/** Layouts built with the R2 street recipe (smooth streets, terrace rows, plinths): current-v8 and
 * its dense-market successor current-v9. Display and terrain rules written for v8 apply to both. */
export const isStreetLayout = (layout: string | undefined): boolean => layout === 'current-v8' || layout === 'current-v9';
/** current-v9 only: the whole market district gathered into one dense shophouse town. */
export const isDenseMarketLayout = (layout: string | undefined): boolean => layout === 'current-v9';
