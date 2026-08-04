import test from 'node:test';
import assert from 'node:assert/strict';
import { TradingViewClient } from '../src/tradingview/client.js';

const options = {
  origin: 'https://www.tradingview.com',
  wsUrl: 'wss://data.tradingview.com/socket.io/websocket',
  timeoutMs: 15_000,
  maxBars: 5_000
};

test('missing and blank tokens use anonymous mode', () => {
  assert.equal(new TradingViewClient(options).options.authToken, 'unauthorized_user_token');
  assert.equal(new TradingViewClient({ ...options, authToken: '' }).authenticationMode, 'anonymous');
  assert.equal(new TradingViewClient({ ...options, authToken: '   ' }).authenticationMode, 'anonymous');
});

test('configured tokens use token mode', () => {
  const client = new TradingViewClient({ ...options, authToken: ' private-token ' });
  assert.equal(client.options.authToken, 'private-token');
  assert.equal(client.authenticationMode, 'token');
});
