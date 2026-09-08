import { describe, expect, it, vi } from 'vitest';
import {
  buildControllerV1WorkOrder,
  listTypedCapabilities,
  WorkforceControllerV1Client,
} from '../apps/dashboard/src/typed-execution.js';

describe('typed execution bridge', () => {
  it('maps safe capabilities to structured PC01 work without raw shell', () => {
    const cases = [
      ['system.resource_snapshot', undefined],
      ['repo.status', undefined],
      ['repo.diff', undefined],
      ['repo.test', undefined],
      ['repo.typecheck', undefined],
      ['repo.build', undefined],
      ['file.read', { path: 'package.json', maxBytes: 4096 }],
      ['http.get', { url: 'http://127.0.0.1:11434/api/tags' }],
    ] as const;
    for (const [capability, input] of cases) {
      const body = buildControllerV1WorkOrder({ capability, input, idempotencyKey: `case-${capability.replaceAll('.', '-')}` });
      const raw = JSON.stringify(body).toLowerCase();
      expect(body.targetEmployeeId).toBe('EMP-PC01-NATIVE');
      expect(body.allowedWorkerKinds).toEqual(['pc01']);
      expect(body.expectedEvidence).toEqual(['json']);
      expect(raw).not.toContain('powershell');
      expect(raw).not.toContain('cmd.exe');
      expect(raw).not.toContain('shell:');
    }
  });

  it('rejects unregistered capability and unsafe controller boundary', () => {
    expect(() => buildControllerV1WorkOrder({ capability: 'shell.exec' as never, idempotencyKey: 'bad-capability-001' })).toThrow('CAPABILITY_UNREGISTERED');
    expect(() => new WorkforceControllerV1Client('https://example.com', 'x'.repeat(32))).toThrow('CONTROLLER_URL_MUST_BE_PRIVATE_HTTP');
    expect(() => new WorkforceControllerV1Client('http://8.8.8.8:8790', 'x'.repeat(32))).toThrow('CONTROLLER_URL_OUTSIDE_PRIVATE_BOUNDARY');
    expect(() => new WorkforceControllerV1Client('http://127.0.0.1:8790', 'short')).toThrow('WORKFORCE_INGRESS_TOKEN_NOT_CONFIGURED');
  });

  it('submits exactly one controller-v1 work order and returns a bounded receipt', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://100.97.23.87:8790/api/v1/work-orders');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${'s'.repeat(32)}`);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.idempotencyKey).toBe('typed-canary-001');
      expect(body.payload).toEqual({ route: 'deterministic', action: 'resource_snapshot' });
      return new Response(JSON.stringify({ ok: true, workOrder: { job: { jobId: body.jobId }, stage: 'queued' } }), { status: 201, headers: { 'content-type': 'application/json' } });
    });
    const client = new WorkforceControllerV1Client('http://100.97.23.87:8790', 's'.repeat(32), fetcher as typeof fetch);
    await expect(client.submit({ capability: 'system.resource_snapshot', idempotencyKey: 'typed-canary-001', priority: 'P0' })).resolves.toEqual({ jobId: 'TYPED-typed-canary-001', stage: 'queued', protocol: 'controller-v1' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('exposes only the explicit safe capability registry', () => {
    expect(listTypedCapabilities()).toEqual([
      'system.resource_snapshot', 'repo.status', 'repo.diff', 'repo.test',
      'repo.typecheck', 'repo.build', 'file.read', 'http.get',
    ]);
  });
});
