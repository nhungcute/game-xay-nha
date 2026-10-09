const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;
const CHUNK = 0x8000;

/** Pure base64 codec, identical in browsers and Node; always canonical padded data. */
export function encodeUint8(bytes: Uint8Array): string {
  const codes = new Uint16Array(Math.ceil(bytes.length / 3) * 4);
  for (let i = 0, o = 0; i < bytes.length; i += 3, o += 4) {
    const word = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    codes[o] = ALPHABET.charCodeAt((word >>> 18) & 63); codes[o + 1] = ALPHABET.charCodeAt((word >>> 12) & 63);
    codes[o + 2] = i + 1 < bytes.length ? ALPHABET.charCodeAt((word >>> 6) & 63) : 61;
    codes[o + 3] = i + 2 < bytes.length ? ALPHABET.charCodeAt(word & 63) : 61;
  }
  let output = '';
  for (let i = 0; i < codes.length; i += CHUNK) output += String.fromCharCode(...codes.subarray(i, i + CHUNK));
  return output;
}

export function decodeUint8(base64: string, expectedLength?: number): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error('Invalid base64 encoding');
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const length = base64.length / 4 * 3 - padding;
  if (expectedLength !== undefined && length !== expectedLength) throw new Error(`Layer length ${length}, expected ${expectedLength}`);
  // Canonical padding: the unused low bits of the last data sextet must be zero (4 bits for "==", 2 for "=").
  const last = padding ? LOOKUP[base64.charCodeAt(base64.length - padding - 1)]! : 0;
  if (padding === 2 ? last & 15 : last & 3) throw new Error('Noncanonical base64 padding bits');
  const bytes = new Uint8Array(length);
  for (let i = 0, j = 0; i < base64.length; i += 4) {
    const word = (LOOKUP[base64.charCodeAt(i)]! << 18) | (LOOKUP[base64.charCodeAt(i + 1)]! << 12)
      | (Math.max(0, LOOKUP[base64.charCodeAt(i + 2)]!) << 6) | Math.max(0, LOOKUP[base64.charCodeAt(i + 3)]!);
    if (j < length) bytes[j++] = word >>> 16;
    if (j < length) bytes[j++] = word >>> 8;
    if (j < length) bytes[j++] = word;
  }
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
  const view = new DataView(bytes.buffer), values = new Int16Array(bytes.length / 2);
  for (let i = 0; i < values.length; i++) values[i] = view.getInt16(i * 2, true);
  return values;
}
