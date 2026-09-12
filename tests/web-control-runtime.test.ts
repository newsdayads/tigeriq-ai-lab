import { describe, it, expect } from 'vitest';

describe('Web Control Runtime Integration Tests', () => {
  it('validates truth model structure for UI consumption', async () => {
    const { getPipelineTruth } = await import('../apps/tigeriq-core/web-control-truth.js');
    const truth = await getPipelineTruth();
    expect(truth).toBeTypeOf('object');
    expect(truth.nodes.length).toBeGreaterThan(0);
  });
});
