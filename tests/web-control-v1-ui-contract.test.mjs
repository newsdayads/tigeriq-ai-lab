import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

describe('TIG Owner Cockpit V3 UI contract',()=>{
  it('uses TIG branding and exactly five owner-facing destinations',async()=>{
    const html=await read('public/web-v1/index.html');
    const manifest=JSON.parse(await read('public/manifest.webmanifest'));
    expect(html).toContain('TIG · TigerIQ AI Lab · Owner Cockpit');
    expect(html).toContain('<div class="brand-mark">TIG</div>');
    expect(html).toContain('<b>TIG</b>');
    expect(html).not.toContain('>TQ<');
    expect(manifest.short_name).toBe('TIG');
    const nav=[...html.matchAll(/<button[^>]*data-view="([^"]+)"[^>]*>.*?<span>([^<]+)<\/span><\/button>/gs)].map(match=>match[2]);
    expect(nav).toEqual(['Tổng quan','CẦN SẾP','Công việc','Công ty','Hệ thống']);
  });

  it('keeps the executive home business-first and technical detail secondary',async()=>{
    const html=await read('public/web-v1/index.html');
    const overviewStart=html.indexOf('data-section="overview"');
    const ownerStart=html.indexOf('id="homeOwnerActions"',overviewStart);
    const kpiStart=html.indexOf('id="homeKpis"',overviewStart);
    const missionStart=html.indexOf('id="homeMissions"',overviewStart);
    const outcomeStart=html.indexOf('id="homeOutcomes"',overviewStart);
    const runtimeStart=html.indexOf('id="runtimeSummary"',overviewStart);
    expect(overviewStart).toBeGreaterThan(0);
    expect(ownerStart).toBeGreaterThan(overviewStart);
    expect(kpiStart).toBeGreaterThan(ownerStart);
    expect(missionStart).toBeGreaterThan(kpiStart);
    expect(outcomeStart).toBeGreaterThan(missionStart);
    expect(runtimeStart).toBeGreaterThan(outcomeStart);
    expect(html.slice(overviewStart,html.indexOf('data-section="owner-actions"'))).not.toContain('SHA & CI');
    const system=html.slice(html.indexOf('data-section="technical"'));
    for(const label of ['SHA & CI','LEASE / PORT','Workforce Controller','RUNTIME JOBS','AI PROVIDERS','PROMPT ARCHITECT','RESULT / EVIDENCE'])expect(system).toContain(label);
  });

  it('maps existing functionality into Công việc/Công ty/Hệ thống without deleting renderer targets',async()=>{
    const html=await read('public/web-v1/index.html');
    for(const id of ['workCoordinationSummary','goalGrid','goalForm','missionBoard','outcomeBoard','processBoard','departmentGrid','employeeGrid','buildFacts','runtimeFacts','deviceTechnical','jobBoard','providerGrid','promptGrid','technicalResults'])expect(html).toContain(`id="${id}"`);
  });

  it('preserves reviewed truth and authority boundaries',async()=>{
    const adapter=await read('public/web-v1/company-control-tower-adapter.js');
    const mock=await read('public/web-v1/mock-data.js');
    const app=await read('public/web-v1/app.js');
    expect(adapter).toContain('4bccf71d73c8d8cf100c65b935b3474f97f24459');
    expect(adapter).toContain('0f673f92b703c8c67e8a89cb23a0c5f7307db3f2');
    expect(adapter).toContain("['OPEN','AWAITING_OWNER']");
    expect(adapter).toContain('decision_ref_is_not_owner_approval_ref');
    expect(adapter).toContain('BLOCKED_PENDING_OWNER_DECISION');
    expect(adapter).toContain('tigeriq.work-coordination.trello-readonly.v1');
    expect(adapter).toContain("readOnly:true");
    expect(mock).toContain('authoritative:false');
    expect(mock).toContain("source_system:'web-preview-mock'");
    expect(app).not.toContain('api.github.com');
  });

  it('keeps iPhone safe-area, five-column bottom navigation and touch targets',async()=>{
    const html=await read('public/web-v1/index.html');
    const css=await read('public/web-v1/cockpit-v3.css');
    expect(html).toContain('width=device-width,initial-scale=1,viewport-fit=cover');
    expect(css).toContain('@media(max-width:820px)');
    expect(css).toContain('grid-template-columns:repeat(5,minmax(0,1fr))');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('env(safe-area-inset-top)');
    expect(css).toContain('min-height:50px');
    expect(css).toContain('overflow-x:hidden');
  });
});
