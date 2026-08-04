import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { TradingViewClient, TradingViewError } from './tradingview/client.js';
import { ReplayManager } from './replay/manager.js';

const intervals = ['1', '3', '5', '15', '30', '45', '60', '120', '180', '240', '1D', '1W', '1M'];
const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' }, code: { type: 'string' }, details: {} },
  required: ['error', 'code']
};

function sse(reply) {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  const send = (event, data) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000);
  heartbeat.unref?.();
  return { send, close: () => clearInterval(heartbeat) };
}

export async function buildApp(config, { client = new TradingViewClient(config.tradingView) } = {}) {
  const app = Fastify({ logger: { level: config.logLevel } });
  const replays = new ReplayManager(config.replay);

  await app.register(cors, { origin: true });
  await app.register(swagger, {
    openapi: {
      info: { title: 'TradingviewAPI', version: '1.0.0' },
      tags: [
        { name: 'market-data', description: 'Search, snapshots, history, and live streams' },
        { name: 'replay', description: 'Historical bar replay lifecycle' }
      ]
    }
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = error.statusCode ?? (error instanceof RangeError ? 400 : 500);
    reply.status(statusCode).send({
      error: error.message,
      code: error.code ?? (statusCode < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR'),
      ...(error.details === undefined ? {} : { details: error.details })
    });
  });

  app.get('/health', {
    schema: { summary: 'Service health', response: { 200: { type: 'object', properties: { status: { type: 'string' }, uptime: { type: 'number' }, authenticationMode: { type: 'string', enum: ['anonymous', 'token'] } } } } }
  }, async () => ({
    status: 'ok',
    uptime: process.uptime(),
    authenticationMode: client.authenticationMode ?? (config.tradingView.authToken?.trim() ? 'token' : 'anonymous')
  }));

  app.get('/api/v1/symbols/search', {
    schema: {
      tags: ['market-data'], summary: 'Search TradingView symbols',
      querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', minLength: 1 }, exchange: { type: 'string' }, type: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 } } },
      response: { 200: { type: 'object', properties: { results: { type: 'array', items: { type: 'object', additionalProperties: true } } } }, 502: errorSchema }
    }
  }, async (request) => ({ results: await client.searchSymbols({ query: request.query.q, ...request.query }) }));

  app.get('/api/v1/symbols/:symbol', {
    schema: {
      tags: ['market-data'], summary: 'Get symbol metadata and feed delay',
      params: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', minLength: 1 } } },
      querystring: { type: 'object', properties: { session: { type: 'string', enum: ['regular', 'extended'], default: 'regular' }, adjustment: { type: 'string', enum: ['splits', 'dividends', 'none'], default: 'splits' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            symbol: { type: 'string' }, proName: { type: 'string' }, description: { type: 'string' },
            exchange: { type: 'string' }, sourceId: { type: 'string' }, type: { type: 'string' },
            currency: { type: 'string' }, timezone: { type: 'string' }, session: { type: 'string' },
            delaySeconds: { type: 'number' }, realtime: { type: 'boolean' }, dataStatus: { type: 'string', enum: ['realtime', 'delayed'] }
          },
          required: ['symbol', 'delaySeconds', 'realtime', 'dataStatus']
        },
        502: errorSchema
      }
    }
  }, async (request) => client.getSymbolInfo({ symbol: request.params.symbol, ...request.query }));

  app.get('/api/v1/quotes', {
    schema: {
      tags: ['market-data'], summary: 'Get quote snapshots',
      querystring: { type: 'object', required: ['symbols'], properties: { symbols: { type: 'string', minLength: 1, description: 'Comma-separated TradingView symbols, e.g. NASDAQ:AAPL,CME_MINI:NQ1!' } } },
      response: { 200: { type: 'object', properties: { quotes: { type: 'array', items: { type: 'object', additionalProperties: true } } } }, 502: errorSchema }
    }
  }, async (request) => {
    const symbols = request.query.symbols.split(',').map((value) => value.trim()).filter(Boolean);
    if (symbols.length > 50) throw new TradingViewError('A maximum of 50 symbols is allowed', { statusCode: 400, code: 'LIMIT_EXCEEDED' });
    return { quotes: await client.getQuotes(symbols) };
  });

  app.get('/api/v1/history/:symbol', {
    schema: {
      tags: ['market-data'], summary: 'Get OHLCV history',
      params: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', minLength: 1 } } },
      querystring: { type: 'object', properties: { interval: { type: 'string', enum: intervals, default: '1D' }, bars: { type: 'integer', minimum: 1, maximum: config.tradingView.maxBars, default: 300 }, session: { type: 'string', enum: ['regular', 'extended'], default: 'regular' }, adjustment: { type: 'string', enum: ['splits', 'dividends', 'none'], default: 'splits' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 502: errorSchema }
    }
  }, async (request) => client.getHistory({ symbol: request.params.symbol, ...request.query }));

  app.get('/api/v1/stream', {
    schema: {
      tags: ['market-data'], summary: 'Stream quote updates over SSE',
      querystring: { type: 'object', required: ['symbols'], properties: { symbols: { type: 'string', minLength: 1 } } }
    }
  }, async (request, reply) => {
    const symbols = request.query.symbols.split(',').map((value) => value.trim()).filter(Boolean);
    if (symbols.length > 50) return reply.status(400).send({ error: 'A maximum of 50 symbols is allowed', code: 'LIMIT_EXCEEDED' });
    const events = sse(reply);
    events.send('ready', { symbols });
    const stop = await client.streamQuotes(symbols, {
      onQuote: (quote) => events.send('quote', quote),
      onStatus: (status) => events.send('status', status)
    });
    request.raw.on('close', () => { stop(); events.close(); });
  });

  app.post('/api/v1/replays', {
    schema: {
      tags: ['replay'], summary: 'Create a replay from historical bars',
      body: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', minLength: 1 }, interval: { type: 'string', enum: intervals, default: '1D' }, bars: { type: 'integer', minimum: 2, maximum: config.tradingView.maxBars, default: 300 }, speed: { type: 'number', exclusiveMinimum: 0, maximum: 100, default: 1 }, startIndex: { type: 'integer', minimum: 0, default: 0 }, autoStart: { type: 'boolean', default: false }, session: { type: 'string', enum: ['regular', 'extended'], default: 'regular' } } },
      response: { 201: { type: 'object', additionalProperties: true }, 502: errorSchema }
    }
  }, async (request, reply) => {
    const { autoStart, startIndex, speed, ...historyRequest } = request.body;
    const history = await client.getHistory(historyRequest);
    if (!history.bars.length) throw new TradingViewError('No bars were returned for this symbol', { code: 'NO_DATA', statusCode: 404 });
    const session = replays.create({ symbol: history.symbol, interval: history.interval, bars: history.bars, speed, startIndex });
    if (autoStart) session.play();
    return reply.status(201).send(session.snapshot());
  });

  app.get('/api/v1/replays/:id', {
    schema: { tags: ['replay'], summary: 'Get replay state', params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } }
  }, async (request, reply) => {
    const session = replays.get(request.params.id);
    if (!session) return reply.status(404).send({ error: 'Replay not found', code: 'NOT_FOUND' });
    return session.snapshot();
  });

  app.get('/api/v1/replays/:id/events', {
    schema: { tags: ['replay'], summary: 'Stream replay events over SSE', params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } }
  }, async (request, reply) => {
    const session = replays.get(request.params.id);
    if (!session) return reply.status(404).send({ error: 'Replay not found', code: 'NOT_FOUND' });
    const events = sse(reply);
    events.send('state', session.snapshot());
    const listener = (event) => events.send(event.type, event);
    session.on('event', listener);
    request.raw.on('close', () => { session.off('event', listener); events.close(); });
  });

  app.post('/api/v1/replays/:id/control', {
    schema: {
      tags: ['replay'], summary: 'Control a replay',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: { type: 'object', required: ['action'], properties: { action: { type: 'string', enum: ['play', 'resume', 'pause', 'stop', 'reset', 'seek', 'go', 'next', 'previous', 'set_speed'] }, cursor: { type: 'integer', minimum: 0 }, timestamp: { anyOf: [{ type: 'number' }, { type: 'string', minLength: 1 }] }, count: { type: 'integer', minimum: 1 }, speed: { type: 'number', exclusiveMinimum: 0, maximum: 100 } } }
    }
  }, async (request, reply) => {
    const session = replays.get(request.params.id);
    if (!session) return reply.status(404).send({ error: 'Replay not found', code: 'NOT_FOUND' });
    const { action, cursor, speed } = request.body;
    const { timestamp, count } = request.body;
    switch (action) {
      case 'play':
      case 'resume': session.play(); break;
      case 'pause': session.pause(); break;
      case 'stop': session.stop(); break;
      case 'reset': session.reset(); break;
      case 'next': session.next(count); break;
      case 'previous': session.previous(count); break;
      case 'seek':
        if (cursor === undefined) throw new RangeError('cursor is required for seek');
        session.seek(cursor);
        break;
      case 'go':
        if (timestamp === undefined) throw new RangeError('timestamp is required for go');
        session.go(timestamp);
        break;
      case 'set_speed':
        if (speed === undefined) throw new RangeError('speed is required for set_speed');
        session.setSpeed(speed);
        break;
    }
    return session.snapshot();
  });

  app.delete('/api/v1/replays/:id', {
    schema: { tags: ['replay'], summary: 'Delete a replay', params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } }
  }, async (request, reply) => replays.delete(request.params.id) ? reply.status(204).send() : reply.status(404).send({ error: 'Replay not found', code: 'NOT_FOUND' }));

  app.addHook('onClose', async () => replays.close());
  return app;
}
