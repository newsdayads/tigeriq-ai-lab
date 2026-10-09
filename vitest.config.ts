import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/bcct-v4-contract.test.mjs', 'tests/bcct-renderer.test.mjs', 'tests/bcct-release-first-call.test.mjs'],
    environment: 'node'
  }
});
