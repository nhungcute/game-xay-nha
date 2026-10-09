export const CELL_SIZE_M = 2;
export const GRID = 128;
export const VERTS = GRID + 1;
export const ZONE_CELLS = 16;
export const ZONES = GRID / ZONE_CELLS;
export const HEIGHT_UNIT_DM = 1;
export const PLAYER_STEP_DM = 5;

export const cellIndex = (cx: number, cz: number): number => cz * GRID + cx;
export const vertIndex = (vx: number, vz: number): number => vz * VERTS + vx;
export const zoneOf = (cx: number, cz: number): number =>
  Math.floor(cz / ZONE_CELLS) * ZONES + Math.floor(cx / ZONE_CELLS);

export enum Surface {
  GRASS = 0, DIRT = 1, SAND = 2, ROCK_GROUND = 3, TILLED = 4,
  ROAD = 5, FOUNDATION = 6, WATER = 7,
}

export enum CellFlag {
  EMBANKED = 1 << 0, NO_BUILD = 1 << 1, ENTRY = 1 << 2, PROTECTED = 1 << 3,
}

export type Cell = [number, number];
export type Rect = [number, number, number, number];
export type MapKind = 'city' | 'farm';
export type RoadTier = 0 | 1 | 2 | 3;
export type Rotation = 0 | 1 | 2 | 3;
export type ItemId = string;
export type RecipeId = string;
