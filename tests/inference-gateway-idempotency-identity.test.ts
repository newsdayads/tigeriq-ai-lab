import { describe, expect, it } from 'vitest';
import { idempotencyCacheKey } from '../apps/inference-gateway/src/server.js';

describe('Inference Gateway idempotency identity boundary', () => {
  it('keeps the same idempotency key isolated across devices on one employee/node', () => {
    const a = idempotencyCacheKey({ sub: 'EMP-1', nodeId: 'NODE-1', deviceId: 'PHONE-A' }, 'IDEMP-1');
    const b = idempotencyCacheKey({ sub: 'EMP-1', nodeId: 'NODE-1', deviceId: 'PHONE-B' }, 'IDEMP-1');
    expect(a).not.toBe(b);
  });

  it('is collision-safe for delimiter characters in identity fields', () => {
    const left = idempotencyCacheKey({ sub: 'A:B', nodeId: 'C', deviceId: 'D' }, 'K');
    const right = idempotencyCacheKey({ sub: 'A', nodeId: 'B:C', deviceId: 'D' }, 'K');
    expect(left).not.toBe(right);
  });

  it('remains stable for legitimate replay from the same device identity', () => {
    const claims = { sub: 'EMP-1', nodeId: 'NODE-1', deviceId: 'PHONE-A' };
    expect(idempotencyCacheKey(claims, 'IDEMP-1')).toBe(idempotencyCacheKey(claims, 'IDEMP-1'));
  });
});
