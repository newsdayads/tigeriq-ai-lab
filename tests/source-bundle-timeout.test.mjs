import { describe, expect, it, vi } from 'vitest';
import { SOURCE_REQUEST_TIMEOUT_MS, fetchIssue, fetchText } from '../api/source-bundle.mjs';

describe('#4427 source bundle network bounds', () => {
  it('bounds canonical raw source fetches without changing headers or response handling', async () => {
    let request;
    const fetchImpl = vi.fn(async (url, init) => {
      request = { url, init };
      return new Response('canonical-body', { status: 200 });
    });

    await expect(fetchText('https://example.test/bootstrap.md', fetchImpl)).resolves.toBe('canonical-body');
    expect(SOURCE_REQUEST_TIMEOUT_MS).toBe(12000);
    expect(request.url).toBe('https://example.test/bootstrap.md');
    expect(request.init.headers).toEqual({ 'user-agent': 'TigerIQ-Source-Bundle/1.0' });
    expect(request.init.signal).toBeInstanceOf(AbortSignal);
    expect(request.init.signal.aborted).toBe(false);
  });

  it('bounds GitHub issue fetches and preserves the canonical rendered section', async () => {
    let request;
    const fetchImpl = vi.fn(async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        title: 'Registry',
        state: 'open',
        updated_at: '2026-10-07T00:00:00Z',
        body: 'REGISTRY_BODY',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await fetchIssue(335, fetchImpl);
    expect(request.url).toBe('https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/335');
    expect(request.init.headers).toEqual({
      accept: 'application/vnd.github+json',
      'user-agent': 'TigerIQ-Source-Bundle/1.0',
    });
    expect(request.init.signal).toBeInstanceOf(AbortSignal);
    expect(request.init.signal.aborted).toBe(false);
    expect(result).toContain('# GitHub Issue #335 — Registry');
    expect(result).toContain('State: open');
    expect(result).toContain('REGISTRY_BODY');
  });

  it('preserves the existing HTTP failure mapping', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad', { status: 503 }));
    await expect(fetchText('https://example.test/bootstrap.md', fetchImpl))
      .rejects.toThrow('SOURCE_FETCH_FAILED 503 https://example.test/bootstrap.md');
    await expect(fetchIssue(335, fetchImpl))
      .rejects.toThrow('ISSUE_FETCH_FAILED #335 503');
  });
});
