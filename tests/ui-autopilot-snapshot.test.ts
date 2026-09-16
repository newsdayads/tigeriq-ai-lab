// @ts-nocheck
import { describe,expect,it } from 'vitest';
import { buildPrompt,buildUiAutopilotSnapshot,findDurableSaveReceipt,parseAutoUiIssue,readDurableSaveReceipt,readPreviousJobIdFromController } from '../apps/tigeriq-core/ui-autopilot-snapshot.mjs';

const body=(priority='P0')=>[
  'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO_UI',`PRIORITY=${priority}`,'PRIMARY_EMPLOYEE=NV02',
  'NO_DIRECT_MAIN=true','NO_PAID_COST=true','NO_CREDENTIAL_CHANGE=true','NO_DESTRUCTIVE=true','NO_PRODUCTION_RELEASE=true',
].join('\n');
const issue=(number,overrides={})=>({number,title:`Job ${number}`,state:'open',state_reason:null,html_url:`https://github.com/newsdayads/tigeriq-ai-lab/issues/${number}`,body:body(),updated_at:'2026-09-15T01:00:00Z',closed_at:null,...overrides});
function response(value,status=200){return{ok:status>=200&&status<300,status,json:async()=>value};}

describe('UI autopilot issue contract',()=>{
  it('accepts only explicit AUTO_UI NV02 P0/P1 issues',()=>{expect(parseAutoUiIssue(issue(10))).toMatchObject({number:10,jobId:'GH-10',priority:'P0'});expect(parseAutoUiIssue(issue(11,{body:body('P1')}))).toMatchObject({priority:'P1'});expect(parseAutoUiIssue(issue(12,{body:body('P2')}))).toBeNull();expect(parseAutoUiIssue(issue(13,{body:body().replace('OWNER_POLICY=AUTO_UI','OWNER_POLICY=AUTO')}))).toBeNull();});
  it('fails closed when a required safety flag or employee is wrong',()=>{expect(parseAutoUiIssue(issue(14,{body:body().replace('NO_DESTRUCTIVE=true','NO_DESTRUCTIVE=false')}))).toBeNull();expect(parseAutoUiIssue(issue(15,{body:body().replace('PRIMARY_EMPLOYEE=NV02','PRIMARY_EMPLOYEE=NV03')}))).toBeNull();});
  it('ignores pull requests',()=>{expect(parseAutoUiIssue(issue(16,{pull_request:{url:'x'}}))).toBeNull();});
  it('builds deterministic prompt without copying issue body',()=>{const spec=parseAutoUiIssue(issue(17,{title:'  Fix   safe UI\nflow '}));const prompt=buildPrompt(spec);expect(prompt).toContain('#17 - Fix safe UI flow');expect(prompt).not.toContain('OWNER_POLICY');});
});

describe('UI autopilot snapshot',()=>{
  it('supports public read-only GitHub without a token and selects P0 first',async()=>{const rows=[issue(21,{body:body('P1')}),issue(23),issue(22)];const fetchImpl=async()=>response(rows);const s=await buildUiAutopilotSnapshot({fetchImpl,token:''});expect(s.nextJob).toMatchObject({jobId:'GH-22',workerId:'NV02',status:'READY',priority:'P0'});expect(s.revision).toContain('GH-22');});
  it('correlates open previous job as RUNNING and excludes it from next',async()=>{const previous=issue(30);const rows=[previous,issue(31)];const fetchImpl=async(url)=>response(url.includes('/issues/30')?previous:rows);const s=await buildUiAutopilotSnapshot({fetchImpl,token:'x',previousJobId:'GH-30'});expect(s.previousJob).toMatchObject({jobId:'GH-30',status:'RUNNING'});expect(s.nextJob).toMatchObject({jobId:'GH-31'});});
  it('maps completed previous issue to DONE with GitHub evidence and verifiedAt',async()=>{const previous=issue(40,{state:'closed',state_reason:'completed',closed_at:'2026-09-15T02:00:00Z'});const fetchImpl=async(url)=>response(url.includes('/issues/40')?previous:[]);const s=await buildUiAutopilotSnapshot({fetchImpl,token:'x',previousJobId:'GH-40'});expect(s.previousJob).toMatchObject({jobId:'GH-40',status:'DONE',evidence:[{source:'GITHUB',ref:previous.html_url,verifiedAt:'2026-09-15T02:00:00Z'}]});expect(s.nextJob).toBeUndefined();});
  it('maps non-completed closure to CANCELLED',async()=>{const previous=issue(41,{state:'closed',state_reason:'not_planned',closed_at:'2026-09-15T02:00:00Z'});const fetchImpl=async(url)=>response(url.includes('/issues/41')?previous:[]);const s=await buildUiAutopilotSnapshot({fetchImpl,token:'x',previousJobId:'GH-41'});expect(s.previousJob.status).toBe('CANCELLED');});
  it('fails closed on invalid or unauthorized previous issue',async()=>{await expect(buildUiAutopilotSnapshot({fetchImpl:async()=>response([]),token:'x',previousJobId:'bad'})).rejects.toThrow('PREVIOUS_JOB_ID_INVALID');const bad=issue(50,{body:'TIGERIQ_EXECUTABLE=true'});await expect(buildUiAutopilotSnapshot({fetchImpl:async()=>response(bad),token:'x',previousJobId:'GH-50'})).rejects.toThrow('PREVIOUS_JOB_NOT_AUTHORIZED_AUTO_UI');});
});

describe('durable save receipt',()=>{
  const saveToken='123e4567-e89b-42d3-a456-426614174000';
  const receiptBody=[
    'TIGERIQ_SAVE_RECEIPT_V1',`TIGERIQ_SAVE_TOKEN=${saveToken}`,'TIGERIQ_SAVE_WORKER=NV02','TIGERIQ_SAVE_STATUS=DURABLE','TIGERIQ_SAVE_REF=https://github.com/newsdayads/tigeriq-ai-lab/issues/788#issuecomment-1',
    'TIGERIQ_SAVE_STATE=idle','TIGERIQ_SAVE_FOCUS=durable save gate','TIGERIQ_SAVE_DECISIONS=archive only after receipt','TIGERIQ_SAVE_DONE=source checkpointed','TIGERIQ_SAVE_PENDING=runtime deploy','TIGERIQ_SAVE_BLOCKERS=none','TIGERIQ_SAVE_NEXT=verify runtime','TIGERIQ_SAVE_EVIDENCE=PR and CI',
  ].join('\n');
  it('accepts only a complete matching receipt created after dispatch',()=>{const comments=[{created_at:'2026-09-16T07:00:01Z',html_url:'https://github.com/x/1',body:receiptBody}];expect(findDurableSaveReceipt(comments,{saveToken,workerId:'NV02',after:'2026-09-16T07:00:00Z'})).toMatchObject({ok:true,status:'DURABLE'});expect(findDurableSaveReceipt(comments,{saveToken,workerId:'NV02',after:'2026-09-16T07:00:02Z'})).toEqual({ok:false,status:'SAVE_NOT_DURABLE'});});
  it('rejects stale, wrong-worker, incomplete, or invalid-token receipts',()=>{const fresh={created_at:'2026-09-16T07:00:01Z',html_url:'x',body:receiptBody};expect(findDurableSaveReceipt([fresh],{saveToken,workerId:'NV03',after:'2026-09-16T07:00:00Z'})).toEqual({ok:false,status:'SAVE_NOT_DURABLE'});expect(findDurableSaveReceipt([{...fresh,body:receiptBody.replace('TIGERIQ_SAVE_NEXT=verify runtime','')}],{saveToken,workerId:'NV02',after:'2026-09-16T07:00:00Z'})).toEqual({ok:false,status:'SAVE_NOT_DURABLE'});expect(()=>findDurableSaveReceipt([fresh],{saveToken:'bad',workerId:'NV02',after:'2026-09-16T07:00:00Z'})).toThrow('SAVE_TOKEN_INVALID');});
  it('reads the last ledger page and returns the verified receipt',async()=>{const calls=[];const fetchImpl=async(url)=>{calls.push(url);return response(url.includes('/comments?')?[{created_at:'2026-09-16T07:00:01Z',html_url:'receipt',body:receiptBody}]:{comments:101});};const value=await readDurableSaveReceipt({fetchImpl,token:'x',saveToken,workerId:'NV02',after:'2026-09-16T07:00:00Z'});expect(value).toMatchObject({ok:true,status:'DURABLE',receiptRef:'receipt'});expect(calls.some((url)=>url.includes('page=2'))).toBe(true);});
});

describe('controller correlation',()=>{
  it('reads only a valid GH job id from loopback controller state',async()=>{const fetchImpl=async()=>response({state:{lastDispatchedJobId:'GH-765'}});await expect(readPreviousJobIdFromController({fetchImpl})).resolves.toBe('GH-765');});
  it('returns undefined when controller has no prior job',async()=>{const fetchImpl=async()=>response({state:{}});await expect(readPreviousJobIdFromController({fetchImpl})).resolves.toBeUndefined();});
  it('fails closed when controller state is unavailable or non-loopback',async()=>{await expect(readPreviousJobIdFromController({fetchImpl:async()=>{throw new Error('down')}})).rejects.toThrow('CONTROLLER_STATE_UNAVAILABLE');await expect(readPreviousJobIdFromController({fetchImpl:async()=>response({},500)})).rejects.toThrow('CONTROLLER_STATE_HTTP_500');await expect(readPreviousJobIdFromController({stateUrl:'http://8.8.8.8/state'})).rejects.toThrow('CONTROLLER_STATE_URL_MUST_BE_LOOPBACK');});
});
