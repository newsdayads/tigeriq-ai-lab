import { describe, expect, it } from 'vitest';
import { ProjectRegistry } from '../packages/project-registry/src/index.js';
import { tigerIqDriverSnapshot } from '../packages/project-registry/src/tigeriq-driver.js';

describe('project registry', () => {
  it('reports TigerIQ Driver production alignment from audited evidence', () => {
    const registry = new ProjectRegistry();
    registry.register(tigerIqDriverSnapshot);
    const health = registry.health('tigeriq-driver');
    expect(health.productionAligned).toBe(true);
    expect(health.productionReady).toBe(true);
    expect(health.testReady).toBe(true);
    expect(health.drift).toEqual([]);
  });

  it('fails closed on production drift', () => {
    const registry = new ProjectRegistry();
    registry.register({ ...tigerIqDriverSnapshot, mainSha: 'new-main' });
    const health = registry.health('tigeriq-driver');
    expect(health.productionAligned).toBe(false);
    expect(health.drift).toContain('production commit differs from MAIN');
  });
});
