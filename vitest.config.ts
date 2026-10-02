import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.ts',
      'tests/coding-lane-ai-json-transport.test.mjs',
      'tests/api-doctor-supervisor.test.mjs',
      'tests/android-stable-signing.test.mjs',
      'tests/company-progress-api.test.mjs',
      'tests/owner-facing-vietnamese.test.mjs',
      'tests/pc01-runtime-control.test.mjs',
      'tests/pc01-workforce-deployment.test.mjs',
      'tests/pwa-entry.test.mjs',
      'tests/workforce-status-api.test.mjs',
      'tests/github-coding-intake.test.mjs',
      'tests/nv02-continuity.test.mjs',
      'tests/remote-desktop-guard.test.mjs',
      'tests/coding-lane-foundation.test.mjs',
      'tests/coding-lane-policy.test.mjs',
      'tests/coding-lane-scope.test.mjs',
      'tests/work-routing-policy.test.mjs',
      'tests/nv02-local-self-pull.test.mjs',
      'tests/control-plane-mutation-guard.test.mjs',
      'tests/coding-autonomy-supervisor.test.mjs',
      'tests/autonomy-supervisor.test.mjs',
      'tests/routing-fault-recovery.test.mjs',
      'tests/continuous-capability-verify.test.mjs',
      'apps/tigeriq-core/github-intake.test.mjs',
    ],
    environment: 'node'
  }
});
