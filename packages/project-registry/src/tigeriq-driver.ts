import type { ExternalProjectSnapshot } from './index.js';

/** Audited 2026-08-29 snapshot. Runtime connectors should refresh these values before decisions. */
export const tigerIqDriverSnapshot: ExternalProjectSnapshot = {
  id: 'tigeriq-driver',
  name: 'TigerIQ Driver',
  repository: 'newsdayads/drivetrack',
  mainBranch: 'main',
  mainSha: '58cc3bfa951c4d4877c5723303bb1c1e5f327a71',
  mode: 'read-only',
  observedAt: '2026-08-29T08:47:55.000Z',
  environments: [
    {
      name: 'production',
      branch: 'main',
      commitSha: '58cc3bfa951c4d4877c5723303bb1c1e5f327a71',
      state: 'ready',
      deploymentId: 'dpl_34XgSZqNwRJ46oF7t4euMauweHKz',
      url: 'drivetrack-7gy8ys6sj-nguyn-trng-sn.vercel.app',
    },
    {
      name: 'test',
      branch: 'test',
      commitSha: '7958784944f825d14ab52c73aac15e1acbb0a71a',
      state: 'ready',
      deploymentId: 'dpl_9DLxoX9KyQZvuZcE5ghaSSRbbk1N',
      url: 'drivetrack-11vgmkr0e-nguyn-trng-sn.vercel.app',
    },
  ],
};
