// Central catalog for every protocol message used or handled by this project.
// Keeping raw method names here makes upstream protocol changes easy to audit.
export const OutboundMessage = Object.freeze({
  SET_AUTH_TOKEN: 'set_auth_token',
  CHART_CREATE_SESSION: 'chart_create_session',
  CHART_DELETE_SESSION: 'chart_delete_session',
  SWITCH_TIMEZONE: 'switch_timezone',
  RESOLVE_SYMBOL: 'resolve_symbol',
  CREATE_SERIES: 'create_series',
  MODIFY_SERIES: 'modify_series',
  REMOVE_SERIES: 'remove_series',
  REQUEST_MORE_DATA: 'request_more_data',
  QUOTE_CREATE_SESSION: 'quote_create_session',
  QUOTE_DELETE_SESSION: 'quote_delete_session',
  QUOTE_SET_FIELDS: 'quote_set_fields',
  QUOTE_ADD_SYMBOLS: 'quote_add_symbols',
  QUOTE_REMOVE_SYMBOLS: 'quote_remove_symbols',
  QUOTE_FAST_SYMBOLS: 'quote_fast_symbols'
});

export const InboundMessage = Object.freeze({
  PROTOCOL_ERROR: 'protocol_error',
  CRITICAL_ERROR: 'critical_error',
  SYMBOL_RESOLVED: 'symbol_resolved',
  SYMBOL_ERROR: 'symbol_error',
  SERIES_LOADING: 'series_loading',
  SERIES_COMPLETED: 'series_completed',
  TIMESCALE_UPDATE: 'timescale_update',
  DU: 'du',
  QUOTE_DATA: 'qsd',
  QUOTE_COMPLETED: 'quote_completed',
  QUOTE_ERROR: 'quote_error'
});

export const QUOTE_FIELDS = Object.freeze([
  'base-currency-logoid', 'ch', 'chp', 'currency_code', 'current_session', 'description',
  'exchange', 'format', 'fractional', 'is_tradable', 'language', 'local_description',
  'logoid', 'lp', 'lp_time', 'minmov', 'minmove2', 'original_name', 'pricescale',
  'pro_name', 'short_name', 'type', 'update_mode', 'volume', 'bid', 'ask',
  'bid_size', 'ask_size', 'currency-logoid'
]);

const message = (method, params) => ({ method, params });

export class Messages {
  static authToken(token) { return message(OutboundMessage.SET_AUTH_TOKEN, [token]); }
  static createChartSession(id) { return message(OutboundMessage.CHART_CREATE_SESSION, [id, '']); }
  static deleteChartSession(id) { return message(OutboundMessage.CHART_DELETE_SESSION, [id]); }
  static switchTimezone(id, timezone = 'Etc/UTC') { return message(OutboundMessage.SWITCH_TIMEZONE, [id, timezone]); }
  static resolveSymbol(chartId, symbolId, descriptor) { return message(OutboundMessage.RESOLVE_SYMBOL, [chartId, symbolId, `=${JSON.stringify(descriptor)}`]); }
  static createSeries(chartId, seriesId, alias, symbolId, interval, bars) { return message(OutboundMessage.CREATE_SERIES, [chartId, seriesId, alias, symbolId, interval, bars, '']); }
  static modifySeries(chartId, seriesId, alias, symbolId, interval) { return message(OutboundMessage.MODIFY_SERIES, [chartId, seriesId, alias, symbolId, interval, '']); }
  static removeSeries(chartId, seriesId) { return message(OutboundMessage.REMOVE_SERIES, [chartId, seriesId]); }
  static requestMoreData(chartId, seriesId, bars) { return message(OutboundMessage.REQUEST_MORE_DATA, [chartId, seriesId, bars]); }
  static createQuoteSession(id) { return message(OutboundMessage.QUOTE_CREATE_SESSION, [id]); }
  static deleteQuoteSession(id) { return message(OutboundMessage.QUOTE_DELETE_SESSION, [id]); }
  static setQuoteFields(id, fields = QUOTE_FIELDS) { return message(OutboundMessage.QUOTE_SET_FIELDS, [id, ...fields]); }
  static addQuoteSymbols(id, symbols) { return message(OutboundMessage.QUOTE_ADD_SYMBOLS, [id, ...symbols]); }
  static removeQuoteSymbols(id, symbols) { return message(OutboundMessage.QUOTE_REMOVE_SYMBOLS, [id, ...symbols]); }
  static fastQuoteSymbols(id, symbols) { return message(OutboundMessage.QUOTE_FAST_SYMBOLS, [id, ...symbols]); }
}
