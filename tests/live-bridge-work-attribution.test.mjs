import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifiedActiveUiWorkOrder} from '../apps/tigeriq-live-bridge/ui-worker-attribution.mjs';
const task={workerId:'NV02',jobId:'GH-4625',stage:'WORKING',title:'DeXCam'};
test('attribution requires active stage, exact worker and canonical job identity',()=>{
 assert.deepEqual(verifiedActiveUiWorkOrder(task,'NV02'),{jobId:'GH-4625',title:'DeXCam'});
 for(const stage of ['DONE','BLOCKED','CANCELLED','QUEUED',null])assert.equal(verifiedActiveUiWorkOrder({...task,stage},'NV02'),null);
 assert.equal(verifiedActiveUiWorkOrder({...task,workerId:'NV03'},'NV02'),null);
 assert.equal(verifiedActiveUiWorkOrder({...task,jobId:'UI-NV02-old'},'NV02'),null);
 assert.equal(verifiedActiveUiWorkOrder(null,'NV02'),null);
});
test('NV02 last dispatched job never overrides actual status',()=>{
 const source=readFileSync(new URL('../apps/tigeriq-live-bridge/server.mjs',import.meta.url),'utf8');
 assert.ok(source.includes('verifiedActiveUiWorkOrder(activeJob,id)'));
 assert.ok(source.includes('currentJobId:attributedJob?.jobId||null'));
 assert.ok(!source.includes('controller?.autopilot?.lastDispatchedJobId'));
});
test('PC01 local services are bridge defaults; env may override',()=>{
 const source=readFileSync(new URL('../apps/tigeriq-live-bridge/server.mjs',import.meta.url),'utf8');
 assert.ok(source.includes("TIGERIQ_CORE_STATUS_URL||'http://127.0.0.1:8795/api/status'"));
 assert.ok(source.includes("TIGERIQ_CODING_STATUS_URL||'http://127.0.0.1:8797/api/status'"));
});
