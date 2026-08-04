import { TradingviewAPI } from '../src/index.js';

const symbols = (process.argv[2] ?? 'CME_MINI:NQ1!,NASDAQ:AAPL').split(',');
const historySymbol = process.argv[3] ?? symbols[0];
const api = new TradingviewAPI({ save_session: false });

try {
  const symbol = await api.symbol(historySymbol);
  const quotes = await api.quotes(symbols);
  const history = await api.history(historySymbol, { interval: '1D', bars: 5 });
  const replay = await api.replay(historySymbol, { interval: '1D', bars: 20, speed: 2 });
  if (quotes.some((quote) => !Number.isFinite(quote.lp))) throw new Error('Smoke test received an incomplete quote snapshot');
  replay.next();
  replay.play();
  replay.pause();
  const deleted = api.deleteReplay(replay.id);
  console.log(JSON.stringify({
    authenticationMode: api.client.authenticationMode,
    symbol: { symbol: symbol.symbol, dataStatus: symbol.dataStatus, realtime: symbol.realtime, delaySeconds: symbol.delaySeconds },
    replay: { created: replay.id, totalBars: replay.totalBars, controls: 'passed', deleted },
    quotes: quotes.map(({ symbol, lp, ch, chp, exchange, current_session: currentSession }) => ({ symbol, lp, ch, chp, exchange, currentSession })),
    history: { symbol: history.symbol, interval: history.interval, count: history.bars.length, first: history.bars[0], last: history.bars.at(-1) }
  }, null, 2));
} finally {
  api.close();
}
