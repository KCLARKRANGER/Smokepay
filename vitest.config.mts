import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60000, hookTimeout: 60000 },
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
});
