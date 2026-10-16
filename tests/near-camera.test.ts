import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMERA_CLEARANCE, clearsCamera } from '../src/rendering/near-camera';

test('a resident is hidden only while their body column encloses the camera', () => {
  const eye = { x: 0, y: 101.72, z: 0 }, feet = (x: number, y = 100, z = 0) => ({ x, y, z });
  assert.equal(clearsCamera(eye, feet(.2)), false, 'standing on the eye');
  assert.equal(clearsCamera(eye, feet(CAMERA_CLEARANCE)), true, 'just beside');
  assert.equal(clearsCamera(eye, feet(0, 97)), true, 'on a lower terrace');
  assert.equal(clearsCamera(eye, feet(0, 102.5)), true, 'on the floor above');
});
