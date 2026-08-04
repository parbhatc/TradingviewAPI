const PREFIX = '~m~';

export function frame(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return `${PREFIX}${Buffer.byteLength(text)}${PREFIX}${text}`;
}

export function encodeMessage({ method, params = [] }) {
  return frame({ m: method, p: params });
}

export function parseFrames(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  const messages = [];
  let offset = 0;

  while (offset < text.length) {
    const start = text.indexOf(PREFIX, offset);
    if (start === -1) break;
    const lengthEnd = text.indexOf(PREFIX, start + PREFIX.length);
    if (lengthEnd === -1) break;
    const byteLength = Number(text.slice(start + PREFIX.length, lengthEnd));
    if (!Number.isInteger(byteLength) || byteLength < 0) {
      offset = lengthEnd + PREFIX.length;
      continue;
    }

    const payloadStart = lengthEnd + PREFIX.length;
    let payloadEnd = payloadStart;
    let bytes = 0;
    while (payloadEnd < text.length && bytes < byteLength) {
      const codePoint = text.codePointAt(payloadEnd);
      const character = String.fromCodePoint(codePoint);
      bytes += Buffer.byteLength(character);
      payloadEnd += character.length;
    }
    if (bytes !== byteLength) break;
    messages.push(text.slice(payloadStart, payloadEnd));
    offset = payloadEnd;
  }
  return messages;
}
