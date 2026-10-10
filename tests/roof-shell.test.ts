import assert from 'node:assert/strict';
import test from 'node:test';
import { programRoofShell } from '../src/renderer';
import type { Building } from '../src/types';

const building = (kind: string, floors: number) => ({ id: 'b', kind, floors, position: { x: 0, y: 0, z: 0 }, rotation: 0 }) as unknown as Building;
const roofPart = (x: number, z: number, w: number, d: number, top: number, floor: number) => ({ position: { x, y: top - .1, z }, size: { x: w, y: .2, z: d }, floor, roof: true });

test('the display roof sits on the actual top roof of the body and covers its outline', () => {
  const shell = programRoofShell(building('school', 3), [roofPart(0, 0, 20, 12, 9.6, 2), roofPart(0, 0, 30, 20, 3.2, 0)])!;
  assert.equal(shell.form, 'hip'); assert.equal(shell.position.y, 9.6); assert.equal(shell.floor, 2);
  assert.ok(shell.width > 20 && shell.depth > 12 && shell.rise > 1.8, 'eaves overhang the top outline');
  assert.equal(programRoofShell(building('home', 2), [roofPart(0, 0, 10, 8, 6, 1)])!.form, 'gable');
});

test('courtyard clusters, towers and transport bodies keep their own tops', () => {
  assert.equal(programRoofShell(building('home', 2), [roofPart(-10, -10, 4, 4, 6, 1), roofPart(10, 10, 4, 4, 6, 1)]), null, 'a loose cluster would get a floating roof');
  assert.equal(programRoofShell(building('home', 9), [roofPart(0, 0, 10, 8, 30, 8)]), null);
  assert.equal(programRoofShell(building('station', 2), [roofPart(0, 0, 10, 8, 6, 1)]), null);
});
