import { loadConfig } from './config.js';
import { ReplayManager } from './replay/manager.js';
import { TradingViewClient } from './tradingview/client.js';

export class TradingviewAPI {
  constructor(options = {}) {
    const defaults = loadConfig();
    const tradingView = { ...defaults.tradingView, ...options.tradingView };
    const replay = { ...defaults.replay, ...options.replay };

    this.client = options.client ?? new TradingViewClient(tradingView);
    this.replays = options.replayManager ?? new ReplayManager(replay);
  }

  search(query, options = {}) {
    return this.client.searchSymbols({ query, ...options });
  }

  quotes(symbols) {
    const list = Array.isArray(symbols) ? symbols : [symbols];
    return this.client.getQuotes(list);
  }

  history(symbol, options = {}) {
    return this.client.getHistory({ symbol, ...options });
  }

  symbol(symbol, options = {}) {
    return this.client.getSymbolInfo({ symbol, ...options });
  }

  stream(symbols, handlers) {
    const list = Array.isArray(symbols) ? symbols : [symbols];
    return this.client.streamQuotes(list, handlers);
  }

  async replay(symbol, options = {}) {
    const {
      speed = 1,
      startIndex = 0,
      startTimestamp,
      autoStart = false,
      ...historyOptions
    } = options;

    const history = await this.history(symbol, historyOptions);
    const replay = this.replays.create({
      symbol: history.symbol,
      interval: history.interval,
      bars: history.bars,
      speed,
      startIndex
    });

    if (startTimestamp !== undefined) replay.go(startTimestamp);
    if (autoStart) replay.play();
    return replay;
  }

  getReplay(id) {
    return this.replays.get(id);
  }

  deleteReplay(id) {
    return this.replays.delete(id);
  }

  close() {
    this.replays.close();
  }
}

export { ReplayManager } from './replay/manager.js';
export { ReplaySession } from './replay/session.js';
export { TradingViewClient, TradingViewError } from './tradingview/client.js';
