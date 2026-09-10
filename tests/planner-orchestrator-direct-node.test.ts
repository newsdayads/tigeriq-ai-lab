import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const planner='apps/autonomous-planner/src/standalone.ts';
const orchestrator='apps/mission-orchestrator/src/standalone.ts';

describe('PC01 direct-node runtime defaults',()=>{
  it('uses canonical D root without legacy F defaults',async()=>{
    const [p,o]=await Promise.all([readFile(planner,'utf8'),readFile(orchestrator,'utf8')]);
    expect(p).toContain("'D:\\\\TigerIQ\\\\Workspace\\\\tigeriq-ai-lab'");
    expect(p).toContain("'D:\\\\TigerIQ\\\\Secrets\\\\pc01-primary-node.ingress-token'");
    expect(p).not.toContain("'F:\\\\TigerIQ");
    expect(o).toContain("'D:\\\\TigerIQ\\\\Runtime\\\\mission-orchestrator-v1'");
    expect(o).toContain("process.env.TIGERIQ_MISSION_MODEL??'qwen3:4b'");
    expect(o).not.toContain("'F:\\\\TigerIQ");
  });
});
