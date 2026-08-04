export class TradingViewError extends Error {
  constructor(message, { code = 'TRADINGVIEW_ERROR', statusCode = 502, details } = {}) {
    super(message);
    this.name = 'TradingViewError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class TradingViewAuthError extends TradingViewError {
  constructor(message, { code = 'AUTHENTICATION_FAILED', statusCode = 401, details } = {}) {
    super(message, { code, statusCode, details });
    this.name = 'TradingViewAuthError';
  }
}
