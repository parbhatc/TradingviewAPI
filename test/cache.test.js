import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TradingviewAPI } from '../src/index.js';

function temporaryCache(t) {
  const directory = mkdtempSync(join(tmpdir(), 'tradingviewapi-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'session.json');
}

test('cached login reuses a valid saved token', async (t) => {
  const cachePath = temporaryCache(t);
  const expires = Date.now() + 60_000;
  const first = new TradingviewAPI({ cache_path: cachePath });
  await first.login({ token: 'cached-token', expires });
  first.close();

  const second = new TradingviewAPI({ cache_path: cachePath });
  t.after(() => second.close());
  const result = await second.login({ token: 'ignored-token', expires });

  assert.equal(result.source, 'cache');
  assert.equal(second.client.options.authToken, 'cached-token');
});

test('forceLogin with a token bypasses and replaces the cache', async (t) => {
  const cachePath = temporaryCache(t);
  const expires = Date.now() + 60_000;
  const api = new TradingviewAPI({ cache_path: cachePath });
  t.after(() => api.close());

  await api.login({ token: 'old-token', expires });
  const result = await api.forceLogin({ token: 'new-token', expires: expires + 60_000 });
  const saved = JSON.parse(readFileSync(cachePath, 'utf8'));

  assert.equal(result.source, 'force');
  assert.equal(api.client.options.authToken, 'new-token');
  assert.equal(saved.token, 'new-token');
  assert.equal(saved.expiresAt, expires + 60_000);
});

test('expired cached tokens are ignored', async (t) => {
  const cachePath = temporaryCache(t);
  const first = new TradingviewAPI({ cache_path: cachePath });
  await first.login({ token: 'expired-token', expires: Date.now() - 1_000 });
  first.close();

  const second = new TradingviewAPI({ cache_path: cachePath });
  t.after(() => second.close());
  const result = await second.login({ token: 'valid-token', expires: Date.now() + 60_000 });

  assert.equal(result.source, 'login');
  assert.equal(second.client.options.authToken, 'valid-token');
});

test('save_session false keeps login in memory only', async (t) => {
  const cachePath = temporaryCache(t);
  const api = new TradingviewAPI({ save_session: false, cache_path: cachePath });
  t.after(() => api.close());

  await api.login({ token: 'memory-token', expires: Date.now() + 60_000 });

  assert.equal(api.client.options.authToken, 'memory-token');
  assert.throws(() => readFileSync(cachePath, 'utf8'), { code: 'ENOENT' });
});

test('token login does not require an expiration', async (t) => {
  const cachePath = temporaryCache(t);
  const api = new TradingviewAPI({ cache_path: cachePath });
  t.after(() => api.close());

  const result = await api.login({ token: 'token-without-expiration' });
  const saved = JSON.parse(readFileSync(cachePath, 'utf8'));

  assert.equal(result.authenticated, true);
  assert.equal(result.expiresAt, null);
  assert.equal(api.client.options.authToken, 'token-without-expiration');
  assert.equal(saved.token, 'token-without-expiration');
  assert.equal(saved.expiresAt, null);
});

test('username and password login is not accepted', async (t) => {
  const api = new TradingviewAPI({ save_session: false });
  t.after(() => api.close());

  await assert.rejects(
    api.login({ username: 'user', password: 'password' }),
    { name: 'TypeError', message: 'login requires exactly one of token or sessionId' }
  );
});

test('login exchanges a session ID and caches the returned token', async (t) => {
  const cachePath = temporaryCache(t);
  const expires = Math.floor(Date.now() / 1000) + 60;
  const payload = Buffer.from(JSON.stringify({ exp: expires })).toString('base64url');
  const token = `header.${payload}.signature`;
  const client = {
    options: { authToken: 'unauthorized_user_token' },
    get authenticationMode() {
      return this.options.authToken === 'unauthorized_user_token' ? 'anonymous' : 'token';
    },
    async getQuoteToken({ sessionId }) {
      assert.equal(sessionId, 'session-value');
      return { code: 200, token };
    },
    setAuthToken(value) {
      this.options.authToken = value;
      return { authenticated: true, authenticationMode: this.authenticationMode };
    }
  };
  const api = new TradingviewAPI({ client, cache_path: cachePath });
  t.after(() => api.close());

  const result = await api.login({ sessionId: 'session-value' });
  const saved = JSON.parse(readFileSync(cachePath, 'utf8'));

  assert.equal(result.authenticated, true);
  assert.equal(result.source, 'login');
  assert.equal(client.options.authToken, token);
  assert.equal(saved.token, token);
  assert.equal(saved.expiresAt, expires * 1000);
});

test('loginBySessionId is a convenience alias', async (t) => {
  const client = {
    options: { authToken: 'unauthorized_user_token' },
    authenticationMode: 'anonymous',
    async getQuoteToken({ sessionId }) {
      return { code: 200, token: `token-for-${sessionId}` };
    },
    setAuthToken(token) {
      this.options.authToken = token;
      this.authenticationMode = 'token';
      return { authenticated: true, authenticationMode: 'token' };
    }
  };
  const api = new TradingviewAPI({ client, save_session: false });
  t.after(() => api.close());

  const result = await api.loginBySessionId('session-value');

  assert.equal(result.authenticated, true);
  assert.equal(client.options.authToken, 'token-for-session-value');
});
