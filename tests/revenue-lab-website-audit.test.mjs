import { describe, it, expect } from 'vitest';
import { auditWebsite } from '../apps/tigeriq-revenue-lab/apify-website-audit.mjs';

describe('Revenue Lab Website Audit Apify Actor', () => {
  it('audits a valid website URL successfully', async () => {
    const result = await auditWebsite('https://example.com');
    expect(result.success).toBe(true);
    expect(result.targetUrl).toBe('https://example.com');
    expect(result.summary.totalPagesAudited).toBeGreaterThan(0);
    expect(result.metrics.costUsd).toBe(0.0);
  });

  it('throws on invalid URL', async () => {
    await expect(auditWebsite('not-a-url')).rejects.toThrow();
  });
});
