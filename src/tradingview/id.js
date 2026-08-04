export function randomId(prefix = 'cs', length = 12) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  let value = `${prefix}_`;
  for (let index = 0; index < length; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}
