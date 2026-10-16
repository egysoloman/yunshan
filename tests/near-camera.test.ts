import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMERA_CLEARANCE, clearsCamera, vehicleClearsCamera } from '../src/rendering/near-camera';

test('a resident is hidden only while their body column encloses the camera', () => {
  const eye = { x: 0, y: 101.72, z: 0 }, feet = (x: number, y = 100, z = 0) => ({ x, y, z });
  assert.equal(clearsCamera(eye, feet(.2)), false, 'standing on the eye');
  assert.equal(clearsCamera(eye, feet(CAMERA_CLEARANCE)), true, 'just beside');
  assert.equal(clearsCamera(eye, feet(0, 97)), true, 'on a lower terrace');
  assert.equal(clearsCamera(eye, feet(0, 102.5)), true, 'on the floor above');
});

test('a vehicle is hidden only while the camera lies inside its body', () => {
  const eye = { x: 0, y: 101.72, z: 0 }, van = (x: number, z: number, y = 100) => ({ x, y, z });
  assert.equal(vehicleClearsCamera(eye, van(0, 1), 0, 5.5, 2.5), false, 'standing inside a stopped van');
  assert.equal(vehicleClearsCamera(eye, van(2, 0), 0, 5.5, 2.5), true, 'beside it');
  assert.equal(vehicleClearsCamera(eye, van(2, 0), Math.PI / 2, 5.5, 2.5), false, 'turned across the street, its length reaches the eye');
  assert.equal(vehicleClearsCamera(eye, van(0, 0, 94), 0, 5.5, 2.5), true, 'on the street below');
});
