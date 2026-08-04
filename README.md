# TradingviewAPI

A Node.js service that exposes TradingView symbol search, quote snapshots, OHLCV history, live quote streams, and a controllable historical-bar replay engine through a documented HTTP API.

The API uses TradingView's web data transport. It is **unofficial and not affiliated with TradingView**. TradingView can change the protocol at any time. Use it only in ways permitted by TradingView's terms and by the market-data licenses that apply to your account. Do not redistribute exchange data unless you have permission. For production trading or guaranteed availability, use a licensed market-data provider or an official broker API.

## Features

- Symbol search across TradingView exchanges and asset classes
- Quote snapshots for up to 50 symbols per request
- OHLCV history for intraday, daily, weekly, and monthly intervals
- Live quotes over Server-Sent Events (SSE)
- Automatic live-stream reconnection with exponential backoff
- Historical replay sessions with pause, resume, seek, speed (up to 100 bars/second), completion, and deletion
- Replay events over SSE
- OpenAPI document and interactive Swagger UI
- Request validation, structured errors, timeouts, graceful shutdown, replay expiry, and session limits
- Unit and HTTP integration tests

## Requirements

- Node.js 20 or newer
- Network access to `tradingview.com` and `data.tradingview.com`

## Install and run

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Open:

- API docs: <http://127.0.0.1:3000/docs>
- OpenAPI JSON: <http://127.0.0.1:3000/docs/json>
- Health check: <http://127.0.0.1:3000/health>

Environment variables are optional. The defaults run locally on `127.0.0.1:3000` with anonymous TradingView access. See [.env.example](.env.example) for every setting. Node does not automatically read `.env`; load it in your process manager or start with `node --env-file=.env src/server.js`.

## Symbol format

Use TradingView's fully qualified symbol format whenever possible:

- `NASDAQ:AAPL`
- `CME_MINI:NQ1!`
- `FX:EURUSD`
- `BINANCE:BTCUSDT`

Search first when you do not know the exchange-qualified name:

```bash
curl "http://127.0.0.1:3000/api/v1/symbols/search?q=Apple&limit=5"
```

## JavaScript class API

Import the public `TradingviewAPI` class when using this project as a Node.js library:

```js
import { TradingviewAPI } from './src/index.js';

const api = new TradingviewAPI();

const quote = await api.quotes('CME_MINI:NQ1!');
const symbol = await api.symbol('CME_MINI:NQ1!');
console.log(symbol.delaySeconds, symbol.realtime);
const history = await api.history('CME_MINI:NQ1!', {
  interval: '1D',
  bars: 300
});

const replay = await api.replay('CME_MINI:NQ1!', {
  interval: '1D',
  bars: 300,
  speed: 2
});

replay.go('2026-07-15T00:00:00Z');
replay.next();
replay.previous();
replay.setSpeed(10);

const unsubscribe = replay.onBar((bar) => {
  console.log(bar);
});

replay.play();
replay.pause();
replay.reset();

unsubscribe();
api.close();
```

`go()` accepts Unix seconds, Unix milliseconds, a `Date`, or an ISO date string. It moves to the first available bar at or after that timestamp. `seek()` is available when you want to move by zero-based bar index instead.

## API examples

### Symbol data status

Delay is reported in seconds and reflects the permissions of the configured TradingView token:

```bash
curl "http://127.0.0.1:3000/api/v1/symbols/CME_MINI%3ANQ1!"
```

Example anonymous response:

```json
{
  "symbol": "CME_MINI:NQ1!",
  "exchange": "CME",
  "delaySeconds": 600,
  "realtime": false,
  "dataStatus": "delayed"
}
```

The same symbol can return `delaySeconds: 0` with an account token that has the appropriate exchange entitlement. This reports feed status, not the account's TradingView plan name.

### Quote snapshots

```bash
curl "http://127.0.0.1:3000/api/v1/quotes?symbols=NASDAQ:AAPL,CME_MINI:NQ1!"
```

### Historical bars

```bash
curl "http://127.0.0.1:3000/api/v1/history/CME_MINI%3ANQ1!?interval=1D&bars=300&session=regular"
```

Supported intervals are `1`, `3`, `5`, `15`, `30`, `45`, `60`, `120`, `180`, `240`, `1D`, `1W`, and `1M`. Numeric values are minutes. Timestamps are Unix seconds in UTC.

### Live quote stream

```bash
curl -N "http://127.0.0.1:3000/api/v1/stream?symbols=NASDAQ:AAPL,CME_MINI:NQ1!"
```

The stream emits `ready`, `status`, and `quote` events. It sends a comment heartbeat every 15 seconds and reconnects to TradingView with capped exponential backoff when the upstream connection drops. Clients should also reconnect to this API if their HTTP connection drops; browser `EventSource` does this automatically.

### Create a replay

```bash
curl -X POST "http://127.0.0.1:3000/api/v1/replays" \
  -H "content-type: application/json" \
  -d '{"symbol":"CME_MINI:NQ1!","interval":"1D","bars":300,"speed":2,"autoStart":false}'
```

Save the returned `id`, then subscribe before resuming so no bar events are missed:

```bash
curl -N "http://127.0.0.1:3000/api/v1/replays/REPLAY_ID/events"
```

Control it from another terminal:

```bash
# Start or resume
curl -X POST "http://127.0.0.1:3000/api/v1/replays/REPLAY_ID/control" -H "content-type: application/json" -d '{"action":"play"}'

# Pause
curl -X POST "http://127.0.0.1:3000/api/v1/replays/REPLAY_ID/control" -H "content-type: application/json" -d '{"action":"pause"}'

# Seek by zero-based bar index
curl -X POST "http://127.0.0.1:3000/api/v1/replays/REPLAY_ID/control" -H "content-type: application/json" -d '{"action":"seek","cursor":100}'

# Go to a timestamp
curl -X POST "http://127.0.0.1:3000/api/v1/replays/REPLAY_ID/control" -H "content-type: application/json" -d '{"action":"go","timestamp":"2026-07-15T00:00:00Z"}'

# Change speed (bars per second)
curl -X POST "http://127.0.0.1:3000/api/v1/replays/REPLAY_ID/control" -H "content-type: application/json" -d '{"action":"set_speed","speed":10}'

# Delete
curl -X DELETE "http://127.0.0.1:3000/api/v1/replays/REPLAY_ID"
```

Replay state is held in memory. Sessions expire after `REPLAY_TTL_MS` of inactivity and do not survive a service restart. Put Redis or a database behind `ReplayManager` if durable or multi-instance replay is required.

## Authentication and data entitlements

Anonymous mode uses `unauthorized_user_token` and is intentionally the default. It is appropriate for public/delayed data but may not have access to premium or real-time feeds.

Missing, empty, and whitespace-only `TRADINGVIEW_AUTH_TOKEN` values all select anonymous mode. Check `GET /health`; its `authenticationMode` field returns either `anonymous` or `token` without exposing the credential.

If you have an authorized TradingView websocket token, set `TRADINGVIEW_AUTH_TOKEN` through your secret manager. Never commit it or expose it to API callers. This project does not scrape browser cookies, passwords, or login storage. A normal TradingView session cookie is not the same value as a websocket auth token.

Market status, delay, exchange entitlement, and availability are decided upstream. A successful API response does not grant redistribution rights.

## Error format

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE",
  "details": null
}
```

Common HTTP codes are `400` for validation/limits, `404` for missing replay data, `502` for upstream TradingView errors, and `504` for upstream timeouts.

## Test

```powershell
npm test
npm run check
npm run smoke
```

The tests mock the market-data client; they do not consume TradingView data. `npm run smoke` makes real quote and five-bar history requests for `CME_MINI:NQ1!` and `NASDAQ:AAPL`. Optionally pass a comma-separated quote list and a history symbol: `npm run smoke -- "BINANCE:BTCUSDT,NASDAQ:MSFT" "BINANCE:BTCUSDT"`.

## Production checklist

- Bind to a private interface or put the service behind an authenticated reverse proxy. The service intentionally has no end-user authentication built in.
- Restrict CORS instead of using the development-friendly reflected origin setting.
- Add rate limiting per user/IP and request-size limits at the proxy.
- Store `TRADINGVIEW_AUTH_TOKEN` in a secret manager.
- Review TradingView and exchange licensing terms for your use case.
- Add shared replay storage and coordination before running multiple instances.
- Monitor upstream timeout, reconnect, and error rates.
- Pin dependency versions and run a security scanner in CI.

## Project structure

```text
src/app.js                              HTTP routes, validation, SSE, and API docs
src/config.js                           Environment configuration
src/index.js                            Public TradingviewAPI class and exports
src/tradingview/client.js               Public market-data client class
src/tradingview/connection.js           WebSocket connection lifecycle class
src/tradingview/protocol/framing.js     Wire framing and parser
src/tradingview/protocol/messages.js    All protocol names and message builders
src/replay/session.js                   Replay state machine class
src/replay/manager.js                   Replay lifecycle manager class
src/server.js                           Process startup and graceful shutdown
scripts/smoke.js                        Real-upstream protocol smoke test
test/                                   Protocol, replay, and route tests
```
