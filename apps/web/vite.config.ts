import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: Object.fromEntries(['contracts', 'content', 'worldgen', 'sim'].map(name => [
    `@xay-nha/${name}`, fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url)),
  ])) },
  build: { target: 'es2022', sourcemap: true },
  // Online mode (`vite --mode online`): the API runs on :3217 (pnpm --filter @xay-nha/api dev).
  server: { proxy: { '/api': process.env.API_PROXY ?? 'http://127.0.0.1:3217' } },
  preview: { proxy: { '/api': process.env.API_PROXY ?? 'http://127.0.0.1:3217' } },
});
