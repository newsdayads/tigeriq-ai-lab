import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-expect-error runtime module is JavaScript and intentionally has no declaration file.
import {buildManagerHistoryContext,normalizeManagerHistoryRow} from '../apps/tigeriq-core/context-gateway.mjs';

describe('Context Gateway',()=>{
  it('preserves status, ownership, provider/resource and evidence references',()=>{
    const history=[{
      title:'Verify release evidence',
      status:'done',
      employee_id:'NV11',
      resource_id:'res:groq:test',
      provider:'groq',
      result:{summary:'Checks passed',evidenceUrl:'https://example.test/evidence/123',commitSha:'abcdef1234567890'},
      failure:null
    }];
    const out=buildManagerHistoryContext(history,{budgetBytes:4096,headroomBytes:1024});
    expect(out.text).toContain('Verify release evidence');
    expect(out.text).toContain('done');
    expect(out.text).toContain('NV11');
    expect(out.text).toContain('groq');
    expect(out.text).toContain('res:groq:test');
    expect(out.text).toContain('https://example.test/evidence/123');
    expect(out.text).toContain('abcdef1234567890');
    expect(out.metrics.itemsIn).toBe(1);
    expect(out.metrics.itemsOut).toBe(1);
  });

  it('enforces hard byte budget and reserves headroom',()=>{
    const history=Array.from({length:8},(_,i)=>({
      title:`job-${i}`,status:'done',employee_id:'NV12',provider:'gemini',
      result:{summary:'x'.repeat(5000),evidence:`https://example.test/${i}`}
    }));
    const out=buildManagerHistoryContext(history,{budgetBytes:2400,headroomBytes:600});
    expect(out.metrics.effectiveBudgetBytes).toBe(1800);
    expect(Buffer.byteLength(out.text,'utf8')).toBeLessThanOrEqual(1800);
    expect(out.metrics.bytesAfter).toBeLessThanOrEqual(1800);
    expect(out.metrics.droppedCount+out.metrics.truncatedCount).toBeGreaterThan(0);
  });

  it('materially reduces noisy synthetic history while retaining useful rows',()=>{
    const history=Array.from({length:8},(_,i)=>({
      title:`job-${i}`,status:i%2?'done':'failed',employee_id:'NV12',resource_id:'res:test',provider:'gemini',
      result:{summary:'repeated-noise '.repeat(500),evidenceUrl:`https://example.test/e/${i}`,raw:'z'.repeat(8000)},
      failure:i%2?null:{message:'rate limit '.repeat(300),code:'HTTP_429'}
    }));
    const out=buildManagerHistoryContext(history,{budgetBytes:8000,headroomBytes:2000});
    expect(out.metrics.bytesBefore).toBeGreaterThan(out.metrics.bytesAfter*2);
    expect(out.metrics.bytesAfter).toBeLessThanOrEqual(6000);
    expect(out.metrics.itemsOut).toBeGreaterThan(0);
  });

  it('fails safe for malformed and circular history values',()=>{
    const circular:any={summary:'circular result'};circular.self=circular;
    expect(()=>buildManagerHistoryContext(null)).not.toThrow();
    const out=buildManagerHistoryContext([{title:'circular',status:'done',result:circular}]);
    expect(out.text).toContain('circular');
    expect(out.metrics.bytesAfter).toBeLessThanOrEqual(out.metrics.effectiveBudgetBytes);
  });

  it('normalizes one row deterministically without random ids or timestamps',()=>{
    const row={title:'same',status:'done',employee_id:'NV10',provider:'ollama',result:{summary:'ok'}};
    expect(normalizeManagerHistoryRow(row,2)).toEqual(normalizeManagerHistoryRow(row,2));
  });

  it('Core uses compact history while goal and guardrails remain outside the compact block',()=>{
    const core=readFileSync('apps/tigeriq-core/core.mjs','utf8');
    expect(core).toContain('buildManagerHistoryContext(history)');
    expect(core).toContain("CONTEXT_GATEWAY_BUILT");
    expect(core).toContain("CONTEXT_GATEWAY_FAIL_SAFE");
    expect(core).toContain('Goal: ${goal}');
    expect(core).toContain('Recent work for this phase: ${historyContext.text}');
    expect(core).toContain('terminalHandoffInstruction');
    expect(core).not.toContain('JSON.stringify(history).slice(0,10000)');
  });

  it('keeps both verified context skills ACTIVE after contextual loading promotion',()=>{
    const registry=readFileSync('docs/skills/registry.yaml','utf8');
    const contextBlock=registry.slice(registry.indexOf('- id: contextual-skill-loading'),registry.indexOf('- id: spec-first-tdd'));
    expect(contextBlock).toMatch(/id: contextual-skill-loading[\s\S]*?state: ACTIVE/);
    expect(contextBlock).toMatch(/id: context-budget-compaction[\s\S]*?state: ACTIVE/);
  });
});
