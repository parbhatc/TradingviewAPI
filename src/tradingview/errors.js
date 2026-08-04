export class TradingViewError extends Error {
  constructor(message, { code = 'TRADINGVIEW_ERROR', statusCode = 502, details } = {}) {
    super(message);
    this.name = 'TradingViewError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
