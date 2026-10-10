import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_DISPLAY_ELEVATION, sunColorAt, timeOfDayGrade } from '../src/rendering/time-of-day-grade';

test('the displayed sun never climbs above the golden-hour cap and keeps its clock azimuth', () => {
  for (let hour = 0; hour < 24; hour += .25) {
    const g = timeOfDayGrade(hour, 1), [x, y, z] = g.sunDirection;
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-9, `unit vector at ${hour}`);
    assert.ok(Math.asin(y) <= MAX_DISPLAY_ELEVATION + 1e-9, `elevation capped at ${hour}`);
    const a = (hour - 6) / 24 * Math.PI * 2, h = Math.hypot(Math.cos(a), .56 * Math.sin(a));
    if (Math.hypot(x, z) > 1e-6) { assert.ok(Math.abs(x / Math.hypot(x, z) - Math.cos(a) / h) < 1e-9, `azimuth at ${hour}`); }
  }
  assert.ok(timeOfDayGrade(12, 1).sunDirection[1] > 0 && timeOfDayGrade(0, 1).sunDirection[1] < 0);
});

test('clear daylight keeps a key-to-fill ratio of at least 4:1; colours follow the spec', () => {
  const noon = timeOfDayGrade(11.75, 1);
  assert.ok(noon.sunIntensity / noon.fillIntensity >= 4, `${noon.sunIntensity} / ${noon.fillIntensity}`);
  assert.equal(sunColorAt(0), '#ff9a4a'); assert.equal(sunColorAt(36 * Math.PI / 180), '#ffcf8f');
  const night = timeOfDayGrade(1, 1); assert.equal(night.sunIntensity, 0); assert.ok(night.moonIntensity > .5);
  assert.ok(timeOfDayGrade(11.75, .58).fogDensityScale > noon.fogDensityScale, 'fog thickens with poor visibility');
});
