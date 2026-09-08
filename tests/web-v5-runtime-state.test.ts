import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stabilizeExecutiveDataV5 } from '../apps/dashboard/src/runtime-state-v5.js';
import type { ExecutiveDashboardV4 } from '../apps/dashboard/src/executive-data-v4.js';

const empty = (): ExecutiveDashboardV4 => ({
  generatedAt:new Date().toISOString(), works:[], people:[
    {key:'VY',initials:'VY',name:'Vy (Trợ lý)',role:'Điều phối',status:'Điều phối',tone:'active',current:'Điều phối',activeCount:0},
    {key:'NV01',initials:'MI',name:'Minh (NV01)',role:'Thực thi trực tiếp',status:'Chờ việc',tone:'waiting',current:'Chưa có việc',activeCount:0},
  ], systems:[], activeCount:0,waitingCount:0,blockedCount:0,doneCount:0,pausedCount:0,progressAverage:null,ownerActionRequired:false,ownerActionText:'Không có việc cần anh Sơn',
});

describe('Web V5 runtime state',()=>{ it('keeps current command visible when GitHub data is empty',async()=>{
  const root=await mkdtemp(join(tmpdir(),'tigeriq-v5-')); const pulse=join(root,'pulse.json'); const cache=join(root,'cache.json');
  await writeFile(pulse,JSON.stringify({workId:'GH-511',issueNumber:511,title:'Web Control V5',ownerCode:'NV01',owner:'Minh (NV01)',priority:'P0',status:'active',currentStep:'Hoàn thiện một đợt',heartbeatAt:new Date().toISOString()}),'utf8');
  const data=await stabilizeExecutiveDataV5(empty(),{pulsePath:pulse,snapshotPath:cache});
  expect(data.works[0]?.workId).toBe('GH-511'); expect(data.works[0]?.tone).toBe('active'); expect(data.people.find(p=>p.key==='NV01')?.current).toBe('Web Control V5');
  expect(data.people.map(p=>p.key)).toEqual(['VY','NV01','NV02','NV03','NV04']); expect(data.people.find(p=>p.key==='NV03')?.tone).toBe('paused');
  expect(data.sourceStatus).toContain('phiên điều hành'); await rm(root,{recursive:true,force:true});
}); });
