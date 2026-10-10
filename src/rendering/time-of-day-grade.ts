/** Display-only time-of-day grade shared by the web renderer and (exported as
 * JSON) the Unity client: docs/设计/美术与渲染改造方案.md §2.2. The concept
 * art is lit by a low golden sun even at 11:45, so the DISPLAY sun elevation is
 * compressed to at most MAX_DISPLAY_ELEVATION while its azimuth follows the
 * clock; the simulation's time, weather and schedules never read this. All
 * colours are sRGB hex; intensities are three.js physical-light units as the
 * renderer used before (sun 2.9 at full day). */
export const MAX_DISPLAY_ELEVATION = 36 * Math.PI / 180;

export interface TimeOfDayGrade {
  /** Unit vector toward the displayed sun (y up). */
  sunDirection: [number, number, number];
  daylight: number; twilight: number;
  sunColor: string; sunIntensity: number;
  moonIntensity: number;
  fillSky: string; fillGround: string; fillIntensity: number;
  bounceColor: string; bounceIntensity: number;
  skyTop: string; skyHorizon: string;
  fogColor: string; fogDensityScale: number;
  exposure: number;
}

const smooth = (x: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
const parse = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
export const mixHex = (a: string, b: string, t: number): string => { const x = parse(a), y = parse(b); return '#' + x.map((v, i) => hex(v + (y[i] - v) * t)).join(''); };

/** Sun colour by displayed elevation (radians): <8° deep amber, 8–25° gold, >25° pale gold. */
export function sunColorAt(elevation: number): string {
  const deg = elevation * 180 / Math.PI;
  if (deg < 8) return mixHex('#ff9a4a', '#ffa65a', smooth(deg, 0, 8));
  if (deg < 25) return mixHex('#ffa65a', '#ffc684', smooth(deg, 8, 25));
  return mixHex('#ffbf78', '#ffcf8f', smooth(deg, 25, 36));
}

export function timeOfDayGrade(hour: number, visibility: number): TimeOfDayGrade {
  const angle = (hour - 6) / 24 * Math.PI * 2, altitude = Math.sin(angle);
  const daylight = smooth(altitude, -.12, .28), twilight = Math.max(0, 1 - Math.abs(altitude) * 4);
  // Same azimuth as before (x = cos, z follows altitude); elevation compressed for display.
  const elevation = altitude > 0 ? Math.asin(altitude) * (MAX_DISPLAY_ELEVATION / (Math.PI / 2)) : Math.asin(Math.max(-1, altitude));
  // The old sun sat at (cos a, sin a, .56 sin a): keep that azimuth, replace only the elevation.
  const horizontal = Math.cos(elevation), azimuthX = Math.cos(angle), azimuthZ = .56 * altitude;
  const norm = Math.hypot(azimuthX, azimuthZ) || 1;
  const sunDirection: [number, number, number] = [azimuthX / norm * horizontal, Math.sin(elevation), azimuthZ / norm * horizontal];
  const clear = Math.min(1, Math.max(0, visibility));
  // Key:fill >= 4:1 in clear daylight; overcast/fog flattens the key.
  const sunIntensity = daylight * (2.6 + clear * 1.2);
  const fillIntensity = .62 + daylight * .32 + (1 - clear) * .25;
  const horizon = mixHex(mixHex('#1d3546', '#d9c9a8', daylight), '#f0b27a', twilight * .45);
  return {
    sunDirection, daylight, twilight,
    sunColor: daylight > 0 ? sunColorAt(Math.max(0, elevation)) : '#ffd29a', sunIntensity,
    moonIntensity: (1 - daylight) * .72,
    fillSky: mixHex('#7f9fb6', '#9fb7c9', daylight), fillGround: mixHex('#3d5149', '#6f7a62', daylight), fillIntensity,
    bounceColor: mixHex('#8296a0', '#d8c39c', daylight), bounceIntensity: .03 + daylight * .3,
    skyTop: mixHex('#071822', '#3f86b4', daylight), skyHorizon: horizon,
    fogColor: mixHex(horizon, '#e8dcc0', daylight * .35), fogDensityScale: .55 + (1 - clear) * .6,
    exposure: 1.06 + daylight * .06,
  };
}
