import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplaySession } from '../src/replay/session.js';

const bars = [
  { time: 1, open: 1, high: 2, low: 1, close: 2, volume: 10 },
  { time: 2, open: 2, high: 3, low: 2, close: 3, volume: 20 },
  { time: 3, open: 3, high: 4, low: 3, close: 4, volume: 30 }
];

test('supports seek, speed, pause, and resume controls', () => {
  const replay = new ReplaySession({ symbol: 'TEST:X', interval: '1D', bars });
  replay.seek(1);
  replay.setSpeed(10);
  replay.resume();
  assert.equal(replay.snapshot().state, 'running');
  assert.equal(replay.snapshot().cursor, 1);
  assert.equal(replay.snapshot().speed, 10);
  replay.pause();
  assert.equal(replay.snapshot().state, 'paused');
  replay.stop();
});

test('moves by timestamp and steps through bars', () => {
  const replay = new ReplaySession({ symbol: 'TEST:X', interval: '1D', bars });

  replay.go(2);
  assert.equal(replay.currentTimestamp, 2);
  replay.next();
  assert.equal(replay.currentTimestamp, 3);
  replay.previous(2);
  assert.equal(replay.currentTimestamp, 1);
  replay.go(new Date(3_000));
  assert.equal(replay.currentTimestamp, 3);
  replay.reset();
  assert.equal(replay.currentTimestamp, 1);
  replay.stop();
});

test('rejects invalid replay controls', () => {
  const replay = new ReplaySession({ symbol: 'TEST:X', interval: '1D', bars });
  assert.throws(() => replay.seek(9), /index/);
  assert.throws(() => replay.go('not-a-date'), /timestamp/);
  assert.throws(() => replay.setSpeed(0), /speed/);
  replay.stop();
});
