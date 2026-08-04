import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { encodeMessage, frame, parseFrames } from './protocol/framing.js';
import { InboundMessage, Messages } from './protocol/messages.js';
import { TradingViewError } from './errors.js';

export class TradingViewConnection extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.socket = null;
    this.closed = false;
  }

  async connect() {
    const url = new URL(this.options.wsUrl);
    url.searchParams.set('from', 'chart/');
    url.searchParams.set('date', new Date().toISOString());
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(url, {
        headers: { Origin: this.options.origin, 'User-Agent': 'Mozilla/5.0 TradingviewAPI/1.0' },
        handshakeTimeout: this.options.timeoutMs
      });
      this.socket = socket;
      const timer = setTimeout(() => reject(new TradingViewError('TradingView connection timed out')), this.options.timeoutMs);
      socket.once('open', () => {
        clearTimeout(timer);
        socket.on('message', (data) => this.#onMessage(data));
        socket.on('error', (error) => this.emit('connection_error', error));
        socket.on('close', (code, reason) => {
          this.closed = true;
          this.emit('closed', { code, reason: reason.toString() });
        });
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(new TradingViewError(`Unable to connect to TradingView: ${error.message}`));
      });
    });
    this.send(Messages.authToken(this.options.authToken));
    return this;
  }

  #onMessage(data) {
    for (const payload of parseFrames(data)) {
      if (payload.startsWith('~h~')) {
        this.socket?.send(frame(payload));
        continue;
      }
      try {
        const raw = JSON.parse(payload);
        if (raw.m) this.emit('message', { type: raw.m, params: raw.p ?? [], raw });
      } catch {
        this.emit('unparsed', payload);
      }
    }
  }

  send(protocolMessage) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new TradingViewError('TradingView connection is not open');
    this.socket.send(encodeMessage(protocolMessage));
  }

  waitFor(predicate, timeoutMs = this.options.timeoutMs) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.off('message', onMessage);
        this.off('closed', onClose);
        this.off('connection_error', onError);
      };
      const onMessage = (incoming) => {
        if ([InboundMessage.PROTOCOL_ERROR, InboundMessage.CRITICAL_ERROR, InboundMessage.SYMBOL_ERROR, InboundMessage.QUOTE_ERROR].includes(incoming.type)) {
          cleanup();
          reject(new TradingViewError('TradingView rejected the request', { details: incoming.params }));
        } else if (predicate(incoming)) {
          cleanup();
          resolve(incoming);
        }
      };
      const onClose = ({ code, reason }) => { cleanup(); reject(new TradingViewError(`TradingView closed the connection (${code}): ${reason}`)); };
      const onError = (error) => { cleanup(); reject(new TradingViewError(`TradingView connection failed: ${error.message}`)); };
      const timer = setTimeout(() => {
        cleanup();
        reject(new TradingViewError('TradingView request timed out', { code: 'UPSTREAM_TIMEOUT', statusCode: 504 }));
      }, timeoutMs);
      this.on('message', onMessage);
      this.once('closed', onClose);
      this.once('connection_error', onError);
    });
  }

  close() {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close(1000, 'request complete');
  }
}
