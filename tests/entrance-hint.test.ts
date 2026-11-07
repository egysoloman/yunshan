import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { entranceHint } from '../src/entrance-hint';

test('E with nothing nearby points to the nearest entrance, relative to the way the player faces', () => {
  const door = (name: string, x: number, z: number) => ({ name, door: { x, y: 0, z } }), at = { x: 0, y: 0, z: 0 }, north = { x: 0, z: -1 };
  // Facing −Z (the three.js camera at yaw 0): +X is to the right.
  assert.equal(entranceHint(at, north, [door('甲', 0, -14)]), '最近的入口：甲，在你正前方约 14 米。');
  assert.equal(entranceHint(at, north, [door('乙', 10, -10)]), '最近的入口：乙，在你右前方约 14 米。');
  assert.equal(entranceHint(at, north, [door('丙', -20, 0)]), '最近的入口：丙，在你左侧约 20 米。');
  assert.equal(entranceHint(at, north, [door('丁', 0, 30)]), '最近的入口：丁，在你身后约 30 米。');
  assert.equal(entranceHint(at, { x: 1, z: 0 }, [door('乙', 10, -10)]), '最近的入口：乙，在你左前方约 14 米。', 'turning changes the side');
  assert.equal(entranceHint(at, north, [door('远', 0, 81)]), null, 'beyond 80 m nothing is named');
  assert.equal(entranceHint(at, north, [door('远', 0, 60), door('近', 3, 4)]), '最近的入口：近，在你右后方约 5 米。');
});

test('the C# parity fixture is current', () => {
  const fixture = JSON.parse(readFileSync('dotnet/Yunshan.Core.Tests/Parity/entrance-hint.json', 'utf8'));
  for (const row of fixture.rows) assert.equal(entranceHint(row.position, row.forward, fixture.buildings), row.hint);
});
