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

test('username and password login is not accepted', async (t) => {
  const api = new TradingviewAPI({ save_session: false });
  t.after(() => api.close());

  await assert.rejects(
    api.login({ username: 'user', password: 'password' }),
    { name: 'TypeError', message: 'login requires { token, expires }' }
  );
});
