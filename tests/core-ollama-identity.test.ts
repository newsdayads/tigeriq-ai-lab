import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const coreSource=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
describe('#775/#777 Core Ollama identity',()=>{
  it('uses NV10 as canonical Ollama identity',()=>{expect(coreSource).toContain("const OLLAMA_EMPLOYEE_ID = 'NV10';");expect(coreSource).toContain("R(OLLAMA_EMPLOYEE_ID,'Ollama','ollama'");expect(coreSource).not.toContain("R('NV02','Ollama','ollama'");});
  it('does not write new Ollama/SurfSense runtime records as NV02',()=>{expect(coreSource).not.toContain("employeeId:'NV02',provider:'ollama'");expect(coreSource).not.toContain("employee_id='NV02',provider='ollama'");expect(coreSource).toContain('employeeId:OLLAMA_EMPLOYEE_ID');expect(coreSource).toContain('resourceId:ollama?.resourceId||null');});
  it('fails closed on busy stale identity before current-row migration',()=>{expect(coreSource).toContain("where provider='ollama' and employee_id<>$1");expect(coreSource).toContain('STALE_OLLAMA_IDENTITY_BUSY');expect(coreSource).toContain("event('RESOURCE_IDENTITY_MIGRATED'");});
});
