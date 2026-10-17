import assert from 'node:assert/strict';
import test from 'node:test';
import { vtonModel } from '../src/decartClient.js';
import { cameraConstraints } from '../src/tryOn.js';

test('lucy-vton-latest capture hints are forwarded to getUserMedia', () => {
  assert.equal(vtonModel.name, 'lucy-vton-latest');
  assert.ok(vtonModel.width > 0);
  assert.ok(vtonModel.height > 0);
  assert.ok(vtonModel.fps);

  const { video } = cameraConstraints(vtonModel);
  assert.equal(video.frameRate, vtonModel.fps);
  assert.equal(video.width, vtonModel.width);
  assert.equal(video.height, vtonModel.height);
  assert.equal(video.facingMode, 'user');
});
