import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_CACHE_PATH = '.tradingview/session.json';

export function normalizeExpiration(value) {
  if (value === undefined || value === null || value === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError('expires is not a valid date');
    return value.getTime();
  }

  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) throw new RangeError('expires must be Unix seconds, Unix milliseconds, a Date, or an ISO date string');
    return parsed;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new RangeError('expires must be a positive timestamp');
  }

  return Math.floor(numeric < 100_000_000_000 ? numeric * 1000 : numeric);
}

export class LoginCache {
  constructor({ enabled = false, path = DEFAULT_CACHE_PATH, now = () => Date.now() } = {}) {
    this.enabled = enabled;
    this.path = resolve(path);
    this.now = now;
  }

  load() {
    if (!this.enabled) return null;

    try {
      const session = JSON.parse(readFileSync(this.path, 'utf8'));
      if (typeof session.token !== 'string' || session.token.trim() === '') return null;
      if (session.expiresAt !== null && session.expiresAt <= this.now()) return null;
      return session;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  save({ token, expires, user }) {
    if (!this.enabled) return null;

    const session = {
      version: 1,
      token,
      expiresAt: normalizeExpiration(expires),
      user: user ?? null,
      savedAt: this.now()
    };
    const directory = dirname(this.path);
    const temporaryPath = `${this.path}.tmp`;

    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(temporaryPath, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, this.path);
    try { chmodSync(this.path, 0o600); } catch { /* Windows may not apply POSIX modes. */ }
    return session;
  }

  clear() {
    if (!this.enabled) return;
    rmSync(this.path, { force: true });
  }
}
