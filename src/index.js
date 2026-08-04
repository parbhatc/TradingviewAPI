import { loadConfig } from './config.js';
import { LoginCache } from './auth/cache.js';
import { ReplayManager } from './replay/manager.js';
import { TradingViewClient } from './tradingview/client.js';

export class TradingviewAPI {
  constructor(options = {}) {
    const defaults = loadConfig();
    const tradingView = { ...defaults.tradingView, ...options.tradingView };
    const replay = { ...defaults.replay, ...options.replay };

    this.client = options.client ?? new TradingViewClient(tradingView);
    this.replays = options.replayManager ?? new ReplayManager(replay);
    this.loginCache = options.loginCache ?? new LoginCache({
      enabled: options.save_session !== false,
      path: options.cache_path
    });
    this.cachedLogin = this.loginCache.load();
    if (this.cachedLogin) this.client.setAuthToken(this.cachedLogin.token);
  }

  search(query, options = {}) {
    return this.client.searchSymbols({ query, ...options });
  }

  async login(credentials) {
    const cached = this.loginCache.load();
    if (cached) {
      this.cachedLogin = cached;
      this.client.setAuthToken(cached.token);
      return this.#loginResult(cached, 'cache');
    }

    return this.#performLogin(credentials, 'login');
  }

  forceLogin(credentials) {
    return this.#performLogin(credentials, 'force');
  }

  clearCachedLogin() {
    this.loginCache.clear();
    this.cachedLogin = null;
    this.client.options.authToken = 'unauthorized_user_token';
  }

  async #performLogin(credentials, source) {
    if (!credentials || typeof credentials !== 'object' || credentials.token === undefined) {
      throw new TypeError('login requires { token, expires }');
    }

    const result = this.client.setAuthToken(credentials.token);

    const session = this.loginCache.save({
      token: this.client.options.authToken,
      expires: credentials.expires
    });
    this.cachedLogin = session;

    return {
      ...result,
      source,
      expiresAt: session?.expiresAt ? new Date(session.expiresAt).toISOString() : null
    };
  }

  #loginResult(session, source) {
    return {
      authenticated: true,
      authenticationMode: this.client.authenticationMode,
      source,
      expiresAt: session.expiresAt ? new Date(session.expiresAt).toISOString() : null,
      user: session.user ?? undefined
    };
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
export { LoginCache } from './auth/cache.js';
export { TradingViewAuthError, TradingViewClient, TradingViewError } from './tradingview/client.js';
