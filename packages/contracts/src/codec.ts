const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Pure base64 codec, identical in browsers and Node; always canonical padded data. */
export function encodeUint8(bytes: Uint8Array): string {
  const output: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const word = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    output.push(ALPHABET[(word >>> 18) & 63]!, ALPHABET[(word >>> 12) & 63]!,
      i + 1 < bytes.length ? ALPHABET[(word >>> 6) & 63]! : '=',
      i + 2 < bytes.length ? ALPHABET[word & 63]! : '=');
  }
  return output.join('');
}

export function decodeUint8(base64: string, expectedLength?: number): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error('Invalid base64 encoding');
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const length = base64.length / 4 * 3 - padding;
  if (expectedLength !== undefined && length !== expectedLength) throw new Error(`Layer length ${length}, expected ${expectedLength}`);
  const bytes = new Uint8Array(length);
  for (let i = 0, j = 0; i < base64.length; i += 4) {
    const word = (ALPHABET.indexOf(base64[i]!) << 18) | (ALPHABET.indexOf(base64[i + 1]!) << 12)
      | (Math.max(0, ALPHABET.indexOf(base64[i + 2]!)) << 6) | Math.max(0, ALPHABET.indexOf(base64[i + 3]!));
    if (j < length) bytes[j++] = word >>> 16;
    if (j < length) bytes[j++] = word >>> 8;
    if (j < length) bytes[j++] = word;
  }
  if (encodeUint8(bytes) !== base64) throw new Error('Noncanonical base64 padding bits');
  return bytes;
}

export function encodeInt16(values: Int16Array): string {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, i) => view.setInt16(i * 2, value, true));
  return encodeUint8(bytes);
}

export function decodeInt16(base64: string, expectedLength?: number): Int16Array {
  const bytes = decodeUint8(base64, expectedLength === undefined ? undefined : expectedLength * 2);
  if (bytes.length % 2) throw new Error('Int16 layer has an odd byte length');
  const view = new DataView(bytes.buffer);
  return Int16Array.from({ length: bytes.length / 2 }, (_, i) => view.getInt16(i * 2, true));
}
