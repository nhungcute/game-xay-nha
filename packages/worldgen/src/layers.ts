import type { WorldTemplate } from '@xay-nha/contracts';
import { decodeInt16, decodeUint8, encodeInt16, encodeUint8 } from './codec';

export interface DecodedLayers {
  heightsDm: Int16Array;
  surface: Uint8Array;
  flags: Uint8Array;
  roadTier: Uint8Array;
  biome: Uint8Array;
}

export function decodeLayers(template: WorldTemplate): DecodedLayers {
  return {
    heightsDm: decodeInt16(template.layers.heightsDm, 129 * 129),
    surface: decodeUint8(template.layers.surface, 128 * 128),
    flags: decodeUint8(template.layers.flags, 128 * 128),
    roadTier: decodeUint8(template.layers.roadTier, 128 * 128),
    biome: decodeUint8(template.layers.biome, 128 * 128),
  };
}

export function encodeLayers(layers: DecodedLayers): WorldTemplate['layers'] {
  return {
    heightsDm: encodeInt16(layers.heightsDm), surface: encodeUint8(layers.surface),
    flags: encodeUint8(layers.flags), roadTier: encodeUint8(layers.roadTier), biome: encodeUint8(layers.biome),
  };
}
