import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/coding-lane-foundation.test.mjs', 'tests/coding-lane-ai-json-transport.test.mjs', 'tests/api_doctor.test.mjs', 'tests/android-stable-signing.test.mjs', 'tests/company-progress-api.test.mjs', 'tests/pc01-runtime-control.test.mjs', 'tests/pc01-workforce-deployment.test.mjs', 'tests/pwa-entry.test.mjs', 'tests/workforce-status-api.test.mjs', 'tests/github-coding-intake.test.mjs', 'tests/nv02-continuity.test.mjs'],
    environment: 'node'
  }
});
