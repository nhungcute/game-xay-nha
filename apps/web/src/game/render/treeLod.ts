/**
 * D030 near/far tree LOD parameters. Mirrored in scripts/trees.config.json (written by
 * scripts/import-trees.mjs); assets.test.ts enforces that the two stay in sync.
 */
export const TREE_LOD = {
  /** Nearest instances (trees + bushes) around the camera target that use the detailed model. */
  nearCount: 160,
  /** …and never farther than this, even when the count allows. */
  nearRadiusM: 60,
  /** Re-select near/far only when the camera target moved this far or rotated this much (hysteresis). */
  recomputeMoveM: 4,
  recomputeYawDeg: 10,
} as const;
