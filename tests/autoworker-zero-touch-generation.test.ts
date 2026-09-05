import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Auto Worker zero-touch deployment generation', () => {
  it('invalidates the stale V14.2.2 v1 success left by the V13.4.9 rollback while keeping the new generation idempotent', async () => {
    const source = await readFile('scripts/pc-worker/install-autoworker-zero-touch-hook.ps1', 'utf8');
    const requestId = source.match(/\$requestId\s*=\s*'([^']+)'/)?.[1];
    expect(requestId).toBe('nv02-v14.2.2-zero-touch-57be6bcf-v2');
    expect(requestId).not.toBe('nv02-v14.2.2-zero-touch-57be6bcf-v1');
    expect(source).toContain("[string]$existing.request_id -eq $requestId -and [bool]$existing.ok");
    expect(source).toContain('subsequent Command Center restarts remain idempotent');
  });
});
