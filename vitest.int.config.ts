import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Integration tests against a real Postgres (started by scripts/test-api.mjs). Standalone on purpose:
// mergeConfig would concatenate include/exclude arrays with the unit-test config.
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(['contracts', 'content', 'worldgen', 'sim'].map(name => [
      `@xay-nha/${name}`, fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
    ])),
  },
  test: { include: ['apps/**/*.int.test.ts'], testTimeout: 120000, hookTimeout: 60000, fileParallelism: false },
});
