import { ReplaySession } from './session.js';

export class ReplayManager {
  constructor({ ttlMs = 3_600_000, maxSessions = 100 } = {}) {
    this.ttlMs = ttlMs;
    this.maxSessions = maxSessions;
    this.sessions = new Map();

    this.cleanupTimer = setInterval(
      () => this.cleanup(),
      Math.min(this.ttlMs, 60_000)
    );
    this.cleanupTimer.unref?.();
  }

  create(options) {
    this.cleanup();
    if (this.sessions.size >= this.maxSessions) throw new Error('Replay session limit reached');

    const session = new ReplaySession(options);
    this.sessions.set(session.id, session);
    return session;
  }

  get(id) {
    return this.sessions.get(id);
  }

  has(id) {
    return this.sessions.has(id);
  }

  list() {
    return [...this.sessions.values()];
  }

  delete(id) {
    const session = this.get(id);
    if (!session) return false;

    session.stop();
    return this.sessions.delete(id);
  }

  cleanup(now = Date.now()) {
    for (const session of this.sessions.values()) {
      const inactiveFor = now - session.updatedAt.getTime();
      if (inactiveFor > this.ttlMs) this.delete(session.id);
    }
  }

  clear() {
    for (const session of this.sessions.values()) session.stop();
    this.sessions.clear();
  }

  close() {
    clearInterval(this.cleanupTimer);
    this.clear();
  }
}
