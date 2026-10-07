import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('#4419 Web Control GitHub transport bound',()=>{
  const source=readFileSync(new URL('../api/control.mjs',import.meta.url),'utf8');

  it('uses a bounded default signal for GitHub control requests',()=>{
    expect(source).toContain('const GITHUB_REQUEST_TIMEOUT_MS = 12000;');
    const start=source.indexOf('async function gh(');
    const end=source.indexOf('export function normalizeInstruction',start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const segment=source.slice(start,end);
    expect(segment).toContain('signal: init.signal || AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS)');
    expect(segment).not.toContain('{ ...init, headers });');
  });

  it('preserves an explicit caller signal override',()=>{
    expect(source).toContain('signal: init.signal || AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS)');
  });
});
