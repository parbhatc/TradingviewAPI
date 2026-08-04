import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

const MAX_SPEED = 100;
const MIN_DELAY_MS = 10;

function toUnixSeconds(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError('timestamp is not a valid date');
    return Math.floor(value.getTime() / 1000);
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    if (value.trim() !== '' && Number.isFinite(numeric)) return toUnixSeconds(numeric);

    const milliseconds = Date.parse(value);
    if (Number.isNaN(milliseconds)) throw new RangeError('timestamp must be a Unix timestamp, Date, or ISO date string');
    return Math.floor(milliseconds / 1000);
  }

  if (!Number.isFinite(value)) throw new RangeError('timestamp must be a Unix timestamp, Date, or ISO date string');
  return Math.floor(value > 10_000_000_000 ? value / 1000 : value);
}

export class ReplaySession extends EventEmitter {
  #timer = null;
  #onActivity;

  constructor({ symbol, interval, bars, speed = 1, startIndex = 0, onActivity = () => {} }) {
    super();

    if (!Array.isArray(bars) || bars.length === 0) throw new RangeError('bars must contain at least one bar');

    this.id = randomUUID();
    this.symbol = symbol;
    this.interval = interval;
    this.bars = [...bars].sort((left, right) => left.time - right.time);
    this.cursor = this.#validIndex(startIndex);
    this.speed = this.#validSpeed(speed);
    this.state = 'paused';
    this.createdAt = new Date();
    this.updatedAt = this.createdAt;
    this.#onActivity = onActivity;
  }

  get currentBar() {
    return this.bars[this.cursor];
  }

  get currentTimestamp() {
    return this.currentBar?.time ?? null;
  }

  get isPlaying() {
    return this.state === 'running';
  }

  snapshot() {
    return {
      id: this.id,
      symbol: this.symbol,
      interval: this.interval,
      state: this.state,
      speed: this.speed,
      cursor: this.cursor,
      totalBars: this.bars.length,
      currentBar: this.currentBar,
      currentTimestamp: this.currentTimestamp,
      progress: this.bars.length > 1 ? this.cursor / (this.bars.length - 1) : 1,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString()
    };
  }

  play() {
    if (this.state === 'completed' || this.state === 'stopped') this.cursor = 0;
    this.state = 'running';
    this.#changed('played');
    this.#schedule();
    return this;
  }

  resume() {
    return this.play();
  }

  pause() {
    if (this.state === 'stopped') return this;
    this.state = 'paused';
    this.#cancelTimer();
    this.#changed('paused');
    return this;
  }

  stop() {
    this.state = 'stopped';
    this.#cancelTimer();
    this.#changed('stopped');
    return this;
  }

  reset() {
    this.state = 'paused';
    this.#cancelTimer();
    this.#moveTo(0, 'reset');
    return this;
  }

  seek(index) {
    this.#moveTo(this.#validIndex(index), 'seeked');
    return this;
  }

  go(timestamp) {
    const target = toUnixSeconds(timestamp);
    let low = 0;
    let high = this.bars.length;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.bars[middle].time < target) low = middle + 1;
      else high = middle;
    }

    const index = Math.min(low, this.bars.length - 1);
    this.#moveTo(index, 'moved');
    return this;
  }

  next(count = 1) {
    const amount = this.#validStep(count);
    this.#moveTo(Math.min(this.cursor + amount, this.bars.length - 1), 'next');
    return this;
  }

  previous(count = 1) {
    const amount = this.#validStep(count);
    this.#moveTo(Math.max(this.cursor - amount, 0), 'previous');
    return this;
  }

  setSpeed(speed) {
    this.speed = this.#validSpeed(speed);
    this.#changed('speed_changed');
    this.#schedule();
    return this;
  }

  onBar(listener) {
    const handler = (event) => {
      if (event.type === 'bar') listener(event.bar, event);
    };
    this.on('event', handler);
    return () => this.off('event', handler);
  }

  #tick() {
    if (!this.isPlaying) return;

    if (this.cursor >= this.bars.length - 1) {
      this.state = 'completed';
      this.#changed('completed');
      return;
    }

    this.cursor += 1;
    this.#changed('bar', { bar: this.currentBar });
    this.#schedule();
  }

  #moveTo(index, eventType) {
    this.cursor = index;
    if (this.state === 'completed') this.state = 'paused';
    this.#changed(eventType, { bar: this.currentBar });
    this.#schedule();
  }

  #changed(type, data = {}) {
    this.updatedAt = new Date();
    this.#onActivity(this);
    this.emit('event', {
      type,
      at: this.updatedAt.toISOString(),
      replay: this.snapshot(),
      ...data
    });
  }

  #schedule() {
    this.#cancelTimer();
    if (!this.isPlaying) return;

    this.#timer = setTimeout(
      () => this.#tick(),
      Math.max(MIN_DELAY_MS, 1000 / this.speed)
    );
    this.#timer.unref?.();
  }

  #cancelTimer() {
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  #validIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.bars.length) {
      throw new RangeError(`index must be between 0 and ${this.bars.length - 1}`);
    }
    return index;
  }

  #validSpeed(speed) {
    if (!Number.isFinite(speed) || speed <= 0 || speed > MAX_SPEED) {
      throw new RangeError(`speed must be greater than 0 and no more than ${MAX_SPEED}`);
    }
    return speed;
  }

  #validStep(count) {
    if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer');
    return count;
  }
}
