import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const config = {
  logLevel: 'silent',
  tradingView: { maxBars: 5000 },
  replay: { ttlMs: 60_000, maxSessions: 10 }
};
const mockClient = {
  async searchSymbols() { return [{ symbol: 'AAPL', fullName: 'NASDAQ:AAPL' }]; },
  async getSymbolInfo({ symbol }) { return { symbol, delaySeconds: 600, realtime: false, dataStatus: 'delayed' }; },
  async getQuotes(symbols) { return symbols.map((symbol) => ({ symbol, lp: 123 })); },
  async getHistory({ symbol, interval = '1D' }) { return { symbol, interval, bars: [{ time: 1 }, { time: 2 }] }; }
};

test('health and quote endpoints respond', async (t) => {
  const app = await buildApp(config, { client: mockClient });
  t.after(() => app.close());
  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  const quotes = await app.inject({ method: 'GET', url: '/api/v1/quotes?symbols=NASDAQ:AAPL' });
  assert.equal(quotes.statusCode, 200);
  assert.equal(quotes.json().quotes[0].lp, 123);
  const symbol = await app.inject({ method: 'GET', url: '/api/v1/symbols/CME_MINI%3ANQ1!' });
  assert.equal(symbol.statusCode, 200);
  assert.equal(symbol.json().delaySeconds, 600);
});

test('creates and controls a replay', async (t) => {
  const app = await buildApp(config, { client: mockClient });
  t.after(() => app.close());
  const created = await app.inject({ method: 'POST', url: '/api/v1/replays', payload: { symbol: 'NASDAQ:AAPL', speed: 2 } });
  assert.equal(created.statusCode, 201);
  const id = created.json().id;
  const controlled = await app.inject({ method: 'POST', url: `/api/v1/replays/${id}/control`, payload: { action: 'resume' } });
  assert.equal(controlled.json().state, 'running');
  const removed = await app.inject({ method: 'DELETE', url: `/api/v1/replays/${id}` });
  assert.equal(removed.statusCode, 204);
});
