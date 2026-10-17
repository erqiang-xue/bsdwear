import assert from 'node:assert/strict';
import test from 'node:test';
import { vtonModel } from '../src/decartClient.js';
import { cameraConstraints } from '../src/tryOn.js';

test('lucy-vton-latest does not force its 16:9 size onto the front camera', () => {
  assert.equal(vtonModel.name, 'lucy-vton-latest');
  assert.equal(vtonModel.width, 1280);
  assert.equal(vtonModel.height, 720);
  assert.deepEqual(vtonModel.fps, { ideal: 30, max: 30 });

  const { video } = cameraConstraints(vtonModel);
  assert.deepEqual(video.facingMode, { ideal: 'user' });
  assert.deepEqual(video.frameRate, { ideal: 30, max: 30 });
  assert.notDeepEqual(video.width, vtonModel.width);
  assert.notDeepEqual(video.height, vtonModel.height);
  assert.ok(video.width.ideal < vtonModel.width);
  assert.ok(video.aspectRatio.ideal < vtonModel.width / vtonModel.height);
  assert.equal(video.width.exact, undefined);
  assert.equal(video.height.exact, undefined);
});
