function integer(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function loadConfig() {
  return {
    tradingView: {
      authToken: process.env.TRADINGVIEW_AUTH_TOKEN?.trim() || 'unauthorized_user_token',
      origin: process.env.TRADINGVIEW_ORIGIN ?? 'https://www.tradingview.com',
      wsUrl: process.env.TRADINGVIEW_WS_URL ?? 'wss://data.tradingview.com/socket.io/websocket',
      timeoutMs: integer('TRADINGVIEW_REQUEST_TIMEOUT_MS', 15_000, { max: 120_000 }),
      maxBars: integer('TRADINGVIEW_MAX_BARS', 5_000, { max: 50_000 })
    },
    replay: {
      ttlMs: integer('REPLAY_TTL_MS', 3_600_000),
      maxSessions: integer('REPLAY_MAX_SESSIONS', 100, { max: 10_000 })
    }
  };
}
