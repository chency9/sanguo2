import { defineConfig } from 'vitest/config';
export default defineConfig({
  // The source-oracle suites run thousands of real battle updates. Bound
  // workers so parallel suites do not exhaust the desktop's CPU/memory.
  test: { include: ['packages/**/*.test.ts'], environment: 'node', maxWorkers:4 },
});
