import test from 'node:test';
import assert from 'node:assert/strict';
import { TradingviewAPI } from '../src/index.js';

const bars = [
  { time: 100, close: 1 },
  { time: 200, close: 2 },
  { time: 300, close: 3 }
];

test('public class creates and controls replay sessions', async () => {
  const client = {
    async getSymbolInfo({ symbol }) {
      return { symbol, delaySeconds: 600, realtime: false, dataStatus: 'delayed' };
    },
    async getHistory({ symbol, interval }) {
      return { symbol, interval, bars };
    }
  };
  const api = new TradingviewAPI({ client, replay: { ttlMs: 60_000, maxSessions: 10 } });

  try {
    const replay = await api.replay('TEST:X', {
      interval: '1D',
      startTimestamp: 200,
      speed: 2
    });

    assert.equal(replay.currentBar.close, 2);
    assert.equal((await api.symbol('TEST:X')).delaySeconds, 600);
    assert.equal(api.getReplay(replay.id), replay);
    replay.next().previous().setSpeed(5).play().pause();
    assert.equal(replay.speed, 5);
    assert.equal(replay.state, 'paused');
  } finally {
    api.close();
  }
});
