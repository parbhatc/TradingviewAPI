import { TradingViewConnection } from './connection.js';
import { TradingViewAuthError, TradingViewError } from './errors.js';
import { InboundMessage, Messages } from './protocol/messages.js';
import { randomId } from './id.js';

function normalizeBar(row) {
  const values = Array.isArray(row) ? row : row?.v;
  if (!Array.isArray(values) || values.length < 6) return null;
  const offset = values.length >= 7 ? 1 : 0;
  return { time: Number(values[offset]), open: Number(values[offset + 1]), high: Number(values[offset + 2]), low: Number(values[offset + 3]), close: Number(values[offset + 4]), volume: Number(values[offset + 5] ?? 0) };
}

function normalizeHistoryEnd(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new TradingViewError('to must be a positive Unix timestamp', {
      code: 'INVALID_HISTORY_END',
      statusCode: 400
    });
  }
  return Math.floor(number > 1e12 ? number / 1000 : number);
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

  setAuthToken(token) {
    if (typeof token !== 'string' || token.trim() === '') {
      throw new TradingViewAuthError('A non-empty TradingView auth token is required', {
        code: 'TOKEN_REQUIRED',
        statusCode: 400
      });
    }

    this.options.authToken = token.trim();
    return {
      authenticated: true,
      authenticationMode: this.authenticationMode
    };
  }

  async getQuoteToken({ sessionId }) {
    if (typeof sessionId !== 'string' || sessionId.trim() === '') {
      throw new TradingViewAuthError('A non-empty TradingView sessionid is required', {
        code: 'SESSION_ID_REQUIRED',
        statusCode: 400
      });
    }

    const normalizedSessionId = sessionId.trim();
    if (/[\u0000-\u0020\u007f;,]/.test(normalizedSessionId)) {
      throw new TradingViewAuthError('TradingView sessionid contains invalid cookie characters', {
        code: 'INVALID_SESSION_ID',
        statusCode: 400
      });
    }

    const url = new URL('/quote_token/', this.options.origin);
    const request = this.options.fetch ?? globalThis.fetch;
    if (typeof request !== 'function') {
      throw new TradingViewError('A Fetch API implementation is required', {
        code: 'FETCH_UNAVAILABLE',
        statusCode: 500
      });
    }

    let response;
    try {
      response = await request(url, {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: `sessionid=${normalizedSessionId}`,
          Origin: this.options.origin,
          Referer: `${this.options.origin.replace(/\/$/, '')}/`,
          'User-Agent': 'Mozilla/5.0 TradingviewAPI/1.0',
          'X-Language': 'en',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: 'grabSession=true',
        signal: AbortSignal.timeout(this.options.timeoutMs)
      });
    } catch (error) {
      throw new TradingViewError('TradingView quote-token request failed', {
        code: 'QUOTE_TOKEN_REQUEST_FAILED',
        details: error.message
      });
    }

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new TradingViewError('TradingView returned an invalid quote-token response', {
        code: 'INVALID_QUOTE_TOKEN_RESPONSE',
        details: text
      });
    }

    if (!response.ok) {
      const ErrorType = response.status === 401 || response.status === 403
        ? TradingViewAuthError
        : TradingViewError;
      throw new ErrorType(payload?.detail || `Quote-token request failed with HTTP ${response.status}`, {
        code: payload?.code || 'QUOTE_TOKEN_REQUEST_FAILED',
        statusCode: response.status,
        details: payload
      });
    }

    if (typeof payload !== 'string' || payload.trim() === '') {
      throw new TradingViewError('TradingView returned an empty quote token', {
        code: 'INVALID_QUOTE_TOKEN_RESPONSE',
        details: payload
      });
    }

    return {
      code: 200,
      token: payload
    };
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

  async getHistory({ symbol, interval = '1D', bars = 300, chunkSize = 500, session = 'regular', adjustment = 'splits', to }) {
    if (!Number.isInteger(bars) || bars < 1 || bars > this.options.maxBars) {
      throw new TradingViewError(`bars must be an integer between 1 and ${this.options.maxBars}`, { code: 'LIMIT_EXCEEDED', statusCode: 400 });
    }
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
      throw new TradingViewError('chunkSize must be a positive integer', { code: 'INVALID_CHUNK_SIZE', statusCode: 400 });
    }
    const endTimestamp = normalizeHistoryEnd(to);

    const connection = await this.createConnection();
    const chartSession = randomId('cs');
    const symbolId = 'symbol_1';
    const seriesId = 'series_1';
    const barsByTime = new Map();
    let status = 'ok';

    const addSeries = (series) => {
      if (series?.status) status = series.status;
      for (const row of series?.s ?? []) {
        const bar = normalizeBar(row);
        if (bar && Number.isFinite(bar.time)) barsByTime.set(bar.time, bar);
      }
    };

    try {
      connection.send(Messages.createChartSession(chartSession));
      connection.send(Messages.switchTimezone(chartSession));
      connection.send(Messages.resolveSymbol(chartSession, symbolId, { symbol, adjustment, session }));
      const initialSize = Math.min(bars, chunkSize);
      const initialSeries = await this.#requestSeriesChunk(connection, chartSession, seriesId, () => {
        connection.send(Messages.createSeries(chartSession, seriesId, 's1', symbolId, interval, initialSize));
      });
      initialSeries.forEach(addSeries);

      const eligibleCount = () => {
        if (endTimestamp === null) return barsByTime.size;
        let count = 0;
        for (const timestamp of barsByTime.keys()) {
          if (timestamp <= endTimestamp) count += 1;
        }
        return count;
      };

      while (eligibleCount() < bars && barsByTime.size < this.options.maxBars) {
        const before = barsByTime.size;
        const requested = Math.min(
          chunkSize,
          endTimestamp === null ? bars - before : this.options.maxBars - before
        );
        const seriesUpdates = await this.#requestSeriesChunk(connection, chartSession, seriesId, () => {
          connection.send(Messages.requestMoreData(chartSession, seriesId, requested));
        });
        seriesUpdates.forEach(addSeries);
        if (barsByTime.size === before) break;
      }

      const loadedBars = [...barsByTime.values()]
        .sort((left, right) => left.time - right.time)
        .filter((bar) => endTimestamp === null || bar.time <= endTimestamp)
        .slice(-bars);
      return {
        symbol,
        interval,
        timezone: 'Etc/UTC',
        status,
        bars: loadedBars,
        to: endTimestamp,
        historyExhausted: loadedBars.length < bars && barsByTime.size < this.options.maxBars
      };
    } finally { connection.close(); }
  }

  async #requestSeriesChunk(connection, chartSession, seriesId, send) {
    const updates = [];
    const onMessage = (incoming) => {
      if (incoming.type !== InboundMessage.TIMESCALE_UPDATE || incoming.params[0] !== chartSession) return;
      const series = incoming.params?.[1]?.[seriesId];
      if (series) updates.push(series);
    };

    connection.on('message', onMessage);
    try {
      const completed = connection.waitFor((incoming) => (
        incoming.type === InboundMessage.SERIES_COMPLETED &&
        incoming.params[0] === chartSession &&
        incoming.params[1] === seriesId
      ));
      send();
      await completed;
      return updates;
    } finally {
      connection.off('message', onMessage);
    }
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
    return results.slice(0, limit).map((item) => {
      const continuous = item.type === 'futures'
        ? item.contracts?.find((contract) => contract.typespecs?.includes('continuous'))
        : null;
      const symbol = continuous?.symbol || item.symbol;
      const prefix = continuous?.prefix || item.source_id || item.exchange;
      return {
        symbol: item.symbol,
        fullName: prefix ? `${prefix}:${symbol}` : symbol,
        description: item.description,
        exchange: item.exchange,
        type: item.type,
        currency: item.currency_code,
        country: item.country
      };
    });
  }
}

export { TradingViewAuthError, TradingViewError } from './errors.js';
