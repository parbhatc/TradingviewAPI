import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeMessage, frame, parseFrames } from '../src/tradingview/protocol/framing.js';
import { Messages } from '../src/tradingview/protocol/messages.js';

test('frames and parses protocol commands', () => {
  const encoded = encodeMessage({ method: 'set_auth_token', params: ['token'] });
  assert.deepEqual(parseFrames(encoded).map(JSON.parse), [{ m: 'set_auth_token', p: ['token'] }]);
});

test('parses concatenated frames and unicode byte lengths', () => {
  const encoded = frame('hello') + frame(JSON.stringify({ value: '€' }));
  assert.deepEqual(parseFrames(encoded), ['hello', '{"value":"€"}']);
});

test('ignores malformed data and incomplete trailing frames', () => {
  assert.deepEqual(parseFrames('junk~m~bad~m~x' + frame('ok') + '~m~10~m~short'), ['ok']);
});

test('builds historical pagination requests', () => {
  assert.deepEqual(Messages.requestMoreData('chart', 'series', 500), {
    method: 'request_more_data',
    params: ['chart', 'series', 500]
  });
});
