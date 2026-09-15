import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const coreSource = readFileSync(new URL('../apps/tigeriq-core/core.mjs', import.meta.url), 'utf8');

describe('#775 Core Ollama identity', () => {
  it('uses NV10 as the canonical Ollama employee id', () => {
    expect(coreSource).toContain("const OLLAMA_EMPLOYEE_ID = 'NV10';");
    expect(coreSource).toContain("R(OLLAMA_EMPLOYEE_ID,'Ollama','ollama'");
    expect(coreSource).not.toContain("R('NV02','Ollama','ollama'");
  });

  it('does not write new Ollama runtime results as NV02', () => {
    expect(coreSource).not.toContain("employeeId:'NV02',provider:'ollama'");
    expect(coreSource).not.toContain("employee_id='NV02',provider='ollama'");
    expect(coreSource).toContain('employeeId:OLLAMA_EMPLOYEE_ID');
  });

  it('removes stale non-canonical Ollama resource identities without rewriting history', () => {
    expect(coreSource).toContain("where provider='ollama' and employee_id<>$1");
    expect(coreSource).toContain("event('RESOURCE_IDENTITY_MIGRATED'");
  });
});
