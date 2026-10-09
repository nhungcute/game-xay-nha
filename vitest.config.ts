import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(['contracts', 'content', 'worldgen', 'sim'].map(name => [
      `@xay-nha/${name}`, fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
    ])),
  },
  // *.int.test.ts need a real Postgres: run with `pnpm test:api` (vitest.int.config.ts).
  test: { include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'], exclude: ['**/node_modules/**', '**/*.int.test.ts'], testTimeout: 30000 },
});
