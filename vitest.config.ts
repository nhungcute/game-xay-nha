import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(['contracts', 'content', 'worldgen', 'sim'].map(name => [
      `@xay-nha/${name}`, fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
    ])),
  },
  test: { include: ['packages/**/*.test.ts'], testTimeout: 30000 },
});
