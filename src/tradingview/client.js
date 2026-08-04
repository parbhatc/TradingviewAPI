import { TradingViewConnection } from './connection.js';
import { TradingViewError } from './errors.js';
import { InboundMessage, Messages } from './protocol/messages.js';
import { randomId } from './id.js';

function normalizeBar(row) {
  const values = Array.isArray(row) ? row : row?.v;
  if (!Array.isArray(values) || values.length < 6) return null;
  const offset = values.length >= 7 ? 1 : 0;
  return { time: Number(values[offset]), open: Number(values[offset + 1]), high: Number(values[offset + 2]), low: Number(values[offset + 3]), close: Number(values[offset + 4]), volume: Number(values[offset + 5] ?? 0) };
}

export class TradingViewClient {
  constructor(options) {
    this.options = {
      ...options,
      authToken: options.authToken?.trim() || 'unauthorized_user_token'
    };
  }

  get authenticationMode() {
    return this.options.authToken === 'unauthorized_user_token' ? 'anonymous' : 'token';
  }
  async createConnection() { return new TradingViewConnection(this.options).connect(); }

  async getSymbolInfo({ symbol, session = 'regular', adjustment = 'splits' }) {
    const connection = await this.createConnection();
    const chartSession = randomId('cs');
    const symbolId = 'symbol_1';

    try {
      connection.send(Messages.createChartSession(chartSession));
      const resolved = connection.waitFor((incoming) => (
        incoming.type === InboundMessage.SYMBOL_RESOLVED &&
        incoming.params[0] === chartSession &&
        incoming.params[1] === symbolId
      ));
      connection.send(Messages.resolveSymbol(chartSession, symbolId, {
        symbol,
        adjustment,
        session
      }));

      const incoming = await resolved;
      const metadata = incoming.params[2];
      const delaySeconds = Number(metadata.delay ?? 0);

      return {
        symbol,
        proName: metadata.pro_name ?? metadata.full_name ?? symbol,
        description: metadata.description,
        exchange: metadata.exchange ?? metadata.source2?.name,
        sourceId: metadata.source_id,
        type: metadata.type,
        currency: metadata.currency_code,
        timezone: metadata.timezone,
        session: metadata.session,
        delaySeconds,
        realtime: delaySeconds === 0,
        dataStatus: delaySeconds === 0 ? 'realtime' : 'delayed'
      };
    } finally {
      connection.close();
    }
  }

  async getHistory({ symbol, interval = '1D', bars = 300, session = 'regular', adjustment = 'splits' }) {
    if (bars > this.options.maxBars) throw new TradingViewError(`bars cannot exceed ${this.options.maxBars}`, { code: 'LIMIT_EXCEEDED', statusCode: 400 });
    const connection = await this.createConnection();
    const chartSession = randomId('cs');
    const symbolId = 'symbol_1';
    const seriesId = 'series_1';
    try {
      connection.send(Messages.createChartSession(chartSession));
      connection.send(Messages.switchTimezone(chartSession));
      connection.send(Messages.resolveSymbol(chartSession, symbolId, { symbol, adjustment, session }));
      const result = connection.waitFor((incoming) => incoming.type === InboundMessage.TIMESCALE_UPDATE && incoming.params[0] === chartSession && Boolean(incoming.params?.[1]?.[seriesId]?.s));
      connection.send(Messages.createSeries(chartSession, seriesId, 's1', symbolId, interval, bars));
      const incoming = await result;
      const series = incoming.params[1][seriesId];
      return { symbol, interval, timezone: 'Etc/UTC', status: series.status ?? 'ok', bars: series.s.map(normalizeBar).filter(Boolean) };
    } finally { connection.close(); }
  }

  async getQuotes(symbols) {
    const connection = await this.createConnection();
    const quoteSession = randomId('qs');
    const values = new Map();
    const onMessage = (incoming) => {
      if (incoming.type !== InboundMessage.QUOTE_DATA || incoming.params[0] !== quoteSession) return;
      const data = incoming.params[1];
      if (data?.n) values.set(data.n, { symbol: data.n, ...data.v });
    };
    connection.on('message', onMessage);
    try {
      connection.send(Messages.createQuoteSession(quoteSession));
      connection.send(Messages.setQuoteFields(quoteSession));
      const completed = connection.waitFor((incoming) => incoming.type === InboundMessage.QUOTE_COMPLETED && incoming.params[0] === quoteSession);
      connection.send(Messages.addQuoteSymbols(quoteSession, symbols));
      await completed;
      // quote_completed can arrive just ahead of the final qsd payload. Keep the
      // connection open briefly, but finish immediately when every symbol lands.
      if (values.size < symbols.length) {
        await new Promise((resolve) => {
          const finish = () => { clearTimeout(timer); connection.off('message', onLateQuote); resolve(); };
          const onLateQuote = (incoming) => {
            if (incoming.type === InboundMessage.QUOTE_DATA && values.size >= symbols.length) finish();
          };
          const timer = setTimeout(finish, 750);
          connection.on('message', onLateQuote);
        });
      }
      return symbols.map((symbol) => values.get(symbol) ?? { symbol, status: 'unavailable' });
    } finally { connection.off('message', onMessage); connection.close(); }
  }

  async streamQuotes(symbols, { onQuote, onStatus }) {
    let stopped = false;
    let connection;
    let attempt = 0;
    const run = async () => {
      while (!stopped) {
        try {
          connection = await this.createConnection();
          attempt = 0;
          const quoteSession = randomId('qs');
          connection.on('message', (incoming) => {
            const data = incoming.params?.[1];
            if (incoming.type === InboundMessage.QUOTE_DATA && incoming.params[0] === quoteSession && data?.n) onQuote({ symbol: data.n, ...data.v });
          });
          connection.send(Messages.createQuoteSession(quoteSession));
          connection.send(Messages.setQuoteFields(quoteSession));
          connection.send(Messages.addQuoteSymbols(quoteSession, symbols));
          onStatus({ state: 'connected' });
          await new Promise((resolve) => connection.once('closed', resolve));
        } catch (error) { if (!stopped) onStatus({ state: 'disconnected', error: error.message }); }
        if (!stopped) {
          attempt += 1;
          const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
          onStatus({ state: 'reconnecting', attempt, delayMs: delay });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    };
    void run();
    return () => { stopped = true; connection?.close(); };
  }

  async searchSymbols({ query, exchange = '', type = '', limit = 30 }) {
    const url = new URL('https://symbol-search.tradingview.com/symbol_search/');
    url.searchParams.set('text', query); url.searchParams.set('hl', '1'); url.searchParams.set('exchange', exchange);
    url.searchParams.set('lang', 'en'); url.searchParams.set('domain', 'production');
    if (type) url.searchParams.set('type', type);
    const response = await fetch(url, { headers: { Origin: this.options.origin, 'User-Agent': 'Mozilla/5.0 TradingviewAPI/1.0' }, signal: AbortSignal.timeout(this.options.timeoutMs) });
    if (!response.ok) throw new TradingViewError(`Symbol search failed with HTTP ${response.status}`);
    const results = await response.json();
    return results.slice(0, limit).map((item) => ({ symbol: item.symbol, fullName: item.exchange ? `${item.exchange}:${item.symbol}` : item.symbol, description: item.description, exchange: item.exchange, type: item.type, currency: item.currency_code, country: item.country }));
  }
}

export { TradingViewError } from './errors.js';
