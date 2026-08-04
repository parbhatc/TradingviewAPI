import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { TradingViewClient } from '../src/tradingview/client.js';

const config = loadConfig();
const client = new TradingViewClient(config.tradingView);
const symbols = (process.argv[2] ?? 'CME_MINI:NQ1!,NASDAQ:AAPL').split(',');
const historySymbol = process.argv[3] ?? symbols[0];
const app = await buildApp({ ...config, logLevel: 'silent' }, { client });

try {
  const healthResponse = await app.inject({ method: 'GET', url: '/health' });
  const docsResponse = await app.inject({ method: 'GET', url: '/docs/' });
  const openApiResponse = await app.inject({ method: 'GET', url: '/docs/json' });
  const symbolResponse = await app.inject({ method: 'GET', url: `/api/v1/symbols/${encodeURIComponent(historySymbol)}` });
  const quoteResponse = await app.inject({ method: 'GET', url: `/api/v1/quotes?symbols=${encodeURIComponent(symbols.join(','))}` });
  const historyResponse = await app.inject({ method: 'GET', url: `/api/v1/history/${encodeURIComponent(historySymbol)}?interval=1D&bars=5` });
  const replayResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/replays',
    payload: { symbol: historySymbol, interval: '1D', bars: 20, speed: 2 }
  });
  if ([healthResponse, docsResponse, openApiResponse, symbolResponse, quoteResponse, historyResponse, replayResponse].some((response) => response.statusCode >= 400)) {
    throw new Error(`Smoke test failed: health=${healthResponse.statusCode}, docs=${docsResponse.statusCode}, openapi=${openApiResponse.statusCode}, symbol=${symbolResponse.statusCode}, quotes=${quoteResponse.statusCode}, history=${historyResponse.statusCode}, replay=${replayResponse.statusCode}:${replayResponse.body}`);
  }
  const quotes = quoteResponse.json().quotes;
  const symbol = symbolResponse.json();
  const history = historyResponse.json();
  const replay = replayResponse.json();
  if (quotes.some((quote) => !Number.isFinite(quote.lp))) throw new Error('Smoke test received an incomplete quote snapshot');
  const nextResponse = await app.inject({ method: 'POST', url: `/api/v1/replays/${replay.id}/control`, payload: { action: 'next' } });
  const playResponse = await app.inject({ method: 'POST', url: `/api/v1/replays/${replay.id}/control`, payload: { action: 'play' } });
  const pauseResponse = await app.inject({ method: 'POST', url: `/api/v1/replays/${replay.id}/control`, payload: { action: 'pause' } });
  const deleteResponse = await app.inject({ method: 'DELETE', url: `/api/v1/replays/${replay.id}` });
  if ([nextResponse, playResponse, pauseResponse].some((response) => response.statusCode >= 400) || deleteResponse.statusCode !== 204) {
    throw new Error(`Replay controls failed: next=${nextResponse.statusCode}, play=${playResponse.statusCode}, pause=${pauseResponse.statusCode}, delete=${deleteResponse.statusCode}`);
  }
  console.log(JSON.stringify({
    service: { health: healthResponse.json().status, authenticationMode: healthResponse.json().authenticationMode, docsStatus: docsResponse.statusCode, openApiStatus: openApiResponse.statusCode },
    symbol: { symbol: symbol.symbol, dataStatus: symbol.dataStatus, realtime: symbol.realtime, delaySeconds: symbol.delaySeconds },
    replay: { created: replay.id, totalBars: replay.totalBars, controls: 'passed', deleted: true },
    quotes: quotes.map(({ symbol, lp, ch, chp, exchange, current_session: currentSession }) => ({ symbol, lp, ch, chp, exchange, currentSession })),
    history: { symbol: history.symbol, interval: history.interval, count: history.bars.length, first: history.bars[0], last: history.bars.at(-1) }
  }, null, 2));
} finally {
  await app.close();
}
