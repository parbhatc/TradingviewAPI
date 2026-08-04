# TradingviewAPI

A class-based Node.js library for TradingView symbol search, quote snapshots, OHLCV history, live quote streams, and controllable historical replay.

This project uses TradingView's unofficial web data transport and is not affiliated with TradingView. The protocol can change without notice. Follow TradingView's terms and the market-data licenses applicable to your account.

## Features

- Anonymous public and delayed market data by default
- Optional TradingView websocket token authentication
- Symbol search and entitlement-aware data status
- Quote snapshots and reconnecting live streams
- Intraday, daily, weekly, and monthly OHLCV history
- Class-based replay with play, pause, seek, timestamp navigation, stepping, and speed control
- Optional local token-session persistence

## Requirements

- Node.js 20 or newer
- Network access to `tradingview.com` and `data.tradingview.com`

## Install

```powershell
npm install
```

## Quick start

```js
import { TradingviewAPI } from 'tradingviewapi';

const api = new TradingviewAPI();

const quotes = await api.quotes(['NASDAQ:AAPL', 'BINANCE:BTCUSDT']);
const symbol = await api.symbol('CME_MINI:NQ1!');
const history = await api.history('NASDAQ:AAPL', {
  interval: '1D',
  bars: 300
});

console.log(quotes);
console.log(symbol.delaySeconds, symbol.realtime);
console.log(history.bars);

api.close();
```

Common symbol formats include `NASDAQ:AAPL`, `CME_MINI:NQ1!`, `FX:EURUSD`, and `BINANCE:BTCUSDT`. Use `api.search('Apple')` when you do not know the exchange-qualified name.

## Authentication

Anonymous mode uses `unauthorized_user_token` and is the default. It may receive delayed data or lack access to restricted feeds.

Supply an existing TradingView websocket token when you have one:

```js
await api.login({
  token: process.env.TRADINGVIEW_AUTH_TOKEN,
  expires: 1798761600
});
```

Session persistence is enabled by default. Tokens are saved in the gitignored `.tradingview/session.json` file. `expires` may be Unix seconds, Unix milliseconds, a `Date`, or an ISO date string. A later `TradingviewAPI` instance automatically loads a valid saved token.

Use `forceLogin()` to replace the saved token, or disable persistence entirely:

```js
const api = new TradingviewAPI({ save_session: false });
await api.forceLogin({ token, expires });
api.clearCachedLogin();
```

Tokens are stored as plaintext because the original value must be sent upstream. Protect the cache file and never commit or expose a token. Username/password login, CAPTCHA automation, and browser cookie extraction are not implemented.

### Quote token from a session ID

Exchange an existing TradingView `sessionid` cookie for a websocket quote token:

```js
const api = new TradingviewAPI({ save_session: false });
const result = await api.quoteToken(process.env.TRADINGVIEW_SESSION_ID);

console.log(result.code);  // 200
console.log(result.token); // TradingView quote token
```

The result has the shape `{ code: 200, token }`. The request sends only the supplied `sessionid` cookie and the required `grabSession=true` form field. Invalid or expired sessions throw `TradingViewAuthError`. Treat both the session ID and returned token as active credentials.

## Data status

`api.symbol()` reports the delay received from TradingView:

```js
const status = await api.symbol('CME_MINI:NQ1!');

console.log({
  realtime: status.realtime,
  delaySeconds: status.delaySeconds,
  dataStatus: status.dataStatus
});
```

An anonymous request might report `delaySeconds: 600`; an entitled token can report `0`. This reflects the symbol feed available to the connection, not the user's TradingView plan name.

## Live quotes

```js
const stop = await api.stream(['NASDAQ:AAPL', 'BINANCE:BTCUSDT'], {
  onQuote(quote) {
    console.log(quote.symbol, quote.lp);
  },
  onStatus(status) {
    console.log(status.state);
  }
});

// Later:
stop();
```

The stream reconnects with capped exponential backoff when the upstream connection closes. Whether updates are realtime or delayed depends on TradingView and exchange entitlements.

## Historical data

```js
const history = await api.history('NASDAQ:AAPL', {
  interval: '15',
  bars: 5_000,
  chunkSize: 500,
  session: 'regular',
  adjustment: 'splits'
});
```

Supported intervals are `1`, `3`, `5`, `15`, `30`, `45`, `60`, `120`, `180`, `240`, `1D`, `1W`, and `1M`. Numeric values represent minutes. Bar timestamps are Unix seconds in UTC.

History is loaded in blocks of `chunkSize` bars. After the initial series, the client sends `request_more_data` until it reaches `bars` or TradingView returns no older data. Overlapping updates are deduplicated by timestamp and returned in chronological order. The default chunk size is 500.

## Replay

```js
const replay = await api.replay('NASDAQ:AAPL', {
  interval: '1D',
  bars: 300,
  speed: 2
});

const unsubscribe = replay.onBar((bar) => console.log(bar));

replay.go('2026-07-15T00:00:00Z');
replay.next();
replay.previous();
replay.setSpeed(10);
replay.play();
replay.pause();
replay.seek(100);
replay.reset();

unsubscribe();
api.deleteReplay(replay.id);
api.close();
```

`go()` accepts Unix seconds, Unix milliseconds, a `Date`, or an ISO date string and selects the first bar at or after the timestamp. `seek()` uses a zero-based bar index. Replay state is in memory and does not survive a process restart.

## Configuration

Constructor options override these optional environment variables:

```text
TRADINGVIEW_AUTH_TOKEN
TRADINGVIEW_ORIGIN
TRADINGVIEW_WS_URL
TRADINGVIEW_REQUEST_TIMEOUT_MS
TRADINGVIEW_MAX_BARS
REPLAY_TTL_MS
REPLAY_MAX_SESSIONS
```

See `.env.example` for defaults.

## Tests

```powershell
npm test
npm run check
npm run smoke
```

Unit tests use mocked market-data clients. `npm run smoke` makes real upstream symbol, quote, history, and replay requests. Optionally pass symbols with `npm run smoke -- "BINANCE:BTCUSDT,NASDAQ:MSFT" "BINANCE:BTCUSDT"`.

## Project structure

```text
src/index.js                            Public TradingviewAPI class and exports
src/config.js                           Environment configuration
src/auth/cache.js                       Local token-session persistence
src/tradingview/client.js               Market-data client class
src/tradingview/connection.js           WebSocket connection lifecycle
src/tradingview/protocol/framing.js     Wire framing and parser
src/tradingview/protocol/messages.js    Protocol names and message builders
src/replay/session.js                   Replay state machine
src/replay/manager.js                   Replay lifecycle manager
scripts/smoke.js                        Real-upstream class API smoke test
test/                                   Unit and class integration tests
```
