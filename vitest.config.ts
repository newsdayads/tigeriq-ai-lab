import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/android-stable-signing.test.mjs', 'tests/company-progress-api.test.mjs', 'tests/pc01-workforce-deployment.test.mjs', 'tests/pwa-entry.test.mjs', 'tests/workforce-status-api.test.mjs'],
    environment: 'node'
  }
});
