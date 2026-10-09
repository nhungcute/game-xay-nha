/** FNV-1a over UTF-8, without platform-specific text APIs. */
export function hash32(seed: number, zone: number, categoryIndex: number, generatorVersion: string): number {
  let hash = 0x811c9dc5;
  const byte = (value: number) => { hash = Math.imul(hash ^ value, 0x01000193) >>> 0; };
  for (const char of `${seed}:${zone}:${categoryIndex}:${generatorVersion}`) {
    const cp = char.codePointAt(0)!;
    if (cp < 128) byte(cp);
    else if (cp < 2048) { byte(192 | (cp >>> 6)); byte(128 | (cp & 63)); }
    else if (cp < 65536) { byte(224 | (cp >>> 12)); byte(128 | ((cp >>> 6) & 63)); byte(128 | (cp & 63)); }
    else { byte(240 | (cp >>> 18)); byte(128 | ((cp >>> 12) & 63)); byte(128 | ((cp >>> 6) & 63)); byte(128 | (cp & 63)); }
  }
  return hash;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
