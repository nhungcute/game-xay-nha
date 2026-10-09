// Bundles the API (workspace TS packages included) into dist/server.js for the Docker image.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const pkg = name => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));
await build({
  entryPoints: ['src/main.ts'], outfile: 'dist/server.js', bundle: true, platform: 'node', target: 'node22', format: 'esm',
  sourcemap: true, external: ['pg-native'],
  alias: Object.fromEntries(['contracts', 'content', 'worldgen', 'sim'].map(n => [`@xay-nha/${n}`, pkg(n)])),
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
console.log('built dist/server.js');
