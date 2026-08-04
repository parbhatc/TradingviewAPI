import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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

class HistoryConnection extends EventEmitter {
  constructor(pages) {
    super();
    this.pages = [...pages];
    this.sent = [];
    this.closed = false;
  }

  send(message) {
    this.sent.push(message);
    if (!['create_series', 'request_more_data'].includes(message.method)) return;

    const [chartSession, seriesId = 'series_1'] = message.params;
    const page = this.pages.shift();
    queueMicrotask(() => {
      if (page?.length) {
        this.emit('message', {
          type: 'timescale_update',
          params: [chartSession, { [seriesId]: { status: 'ok', s: page } }]
        });
      }
      this.emit('message', {
        type: 'series_completed',
        params: [chartSession, seriesId, page?.length ? 'streaming' : 'no_data']
      });
    });
  }

  waitFor(predicate) {
    return new Promise((resolve) => {
      const onMessage = (message) => {
        if (!predicate(message)) return;
        this.off('message', onMessage);
        resolve(message);
      };
      this.on('message', onMessage);
    });
  }

  close() {
    this.closed = true;
  }
}

const bar = (time) => ({ v: [0, time, time, time + 1, time - 1, time + 0.5, 10] });

test('loads history in chunks and deduplicates overlapping bars', async () => {
  const connection = new HistoryConnection([
    [bar(400), bar(500)],
    [bar(200), bar(300), bar(400)],
    [bar(100), bar(200)]
  ]);
  const client = new TradingViewClient(options);
  client.createConnection = async () => connection;

  const history = await client.getHistory({
    symbol: 'NASDAQ:AAPL',
    interval: '5',
    bars: 5,
    chunkSize: 2
  });

  assert.deepEqual(history.bars.map(({ time }) => time), [100, 200, 300, 400, 500]);
  assert.deepEqual(
    connection.sent
      .filter(({ method }) => ['create_series', 'request_more_data'].includes(method))
      .map(({ method, params }) => [method, method === 'create_series' ? params[5] : params[2]]),
    [['create_series', 2], ['request_more_data', 2], ['request_more_data', 1]]
  );
  assert.equal(connection.closed, true);
});

test('stops chunking when TradingView has no older bars', async () => {
  const connection = new HistoryConnection([
    [bar(300), bar(400)],
    [bar(100), bar(200)],
    null
  ]);
  const client = new TradingViewClient(options);
  client.createConnection = async () => connection;

  const history = await client.getHistory({ symbol: 'TEST:SHORT', bars: 10, chunkSize: 2 });

  assert.deepEqual(history.bars.map(({ time }) => time), [100, 200, 300, 400]);
  assert.equal(connection.sent.filter(({ method }) => method === 'request_more_data').length, 2);
});

test('pages backward until it has enough bars at or before the requested end time', async () => {
  const connection = new HistoryConnection([
    [bar(500), bar(600)],
    [bar(300), bar(400)],
    [bar(100), bar(200)]
  ]);
  const client = new TradingViewClient({ ...options, maxBars: 10 });
  client.createConnection = async () => connection;

  const history = await client.getHistory({
    symbol: 'NASDAQ:AAPL',
    interval: '5',
    bars: 3,
    chunkSize: 2,
    to: 350
  });

  assert.deepEqual(history.bars.map(({ time }) => time), [100, 200, 300]);
  assert.equal(history.to, 350);
  assert.equal(connection.sent.filter(({ method }) => method === 'request_more_data').length, 2);
});
