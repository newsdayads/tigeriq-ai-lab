import { describe,it,expect } from "vitest";
import { readFileSync } from "node:fs";
import { projectOwnerLiveTruth } from "../apps/shared/owner-live-truth.mjs";
import "../public/work-center.js";
const at="2026-10-22T08:00:00.000Z";
const context={sourceFresh:true,sourceCheckedAt:at,runtimeConnected:true,now:Date.parse(at)};
const base={number:2054,status:"ĐANG XỬ LÝ",activeWorker:"NV06",activeLease:true,
 heartbeatFresh:true,updatedAt:"2026-10-22T07:59:40.000Z",
 lastActivitySource:"github_issue_comment",lastActivityAt:"2026-10-22T07:55:00Z",
 lastActivitySummary:"CI green",executionEligibility:"PARKED_DEPENDENCY",
 progressChecklistVerified:true,progressDone:6,progressTotal:9};
describe("Owner Dashboard live truth contract",()=>{
 it("never turns a GitHub comment or candidate label into a running Core job",()=>{
   const withoutLease=projectOwnerLiveTruth({...base,activeLease:false},context);
   expect(withoutLease.status).toBe("UNKNOWN");
   expect(withoutLease.runtimeVerified).toBe(false);
   expect(withoutLease.worker).toBeNull();
   expect(withoutLease.lastActivityIsExecutionReceipt).toBe(false);
   expect(globalThis.TigerIQWorkCenter.viewStatus({...base,liveTruth:withoutLease})).toBe("UNKNOWN");
   const open={...base,workKind:"WORK",liveTruth:withoutLease};
   expect(globalThis.TigerIQWorkCenter.rowsFor({openWork:[open]},"working")).toHaveLength(0);
   expect(globalThis.TigerIQWorkCenter.rowsFor({openWork:[open]},"all")).toHaveLength(1);
 });
 it("needs fresh heartbeat, live Core connection and verified source",()=>{
   expect(projectOwnerLiveTruth(base,context).status).toBe("WORKING");
   expect(projectOwnerLiveTruth(base,context).worker).toBe("NV06");
   expect(projectOwnerLiveTruth({...base,updatedAt:"2026-10-22T07:57:00Z"},context).status).toBe("UNKNOWN");
   expect(projectOwnerLiveTruth(base,{...context,runtimeConnected:false}).status).toBe("UNKNOWN");
   expect(projectOwnerLiveTruth(base,{...context,sourceFresh:false}).status).toBe("UNKNOWN");
   expect(projectOwnerLiveTruth({...base,activeWorker:"Owner"},context).status).toBe("UNKNOWN");
 });
 it("preserves blockers, next step and evidence-backed acceptance progress",()=>{
   const row={...base,status:"WAITING",activeLease:false,
     blocker:"NON_EXECUTABLE_STATE",nextStep:"R03 — Kiểm chứng sao lưu",
     executionEligibility:"PARKED_DEPENDENCY"};
   const result=projectOwnerLiveTruth(row,context);
   expect(result.status).toBe("WAITING");
   expect(result.blocker).toBe("NON_EXECUTABLE_STATE");
   expect(result.next).toContain("R03");
   expect(result.progress).toEqual({done:6,total:9,percent:67});
   expect(result.canExecuteNow).toBe(false);
   expect(result.sourceLabel).toMatch(/GITHUB/);
 });
 it("does not advertise execution while a READY source row is waiting on a dependency",()=>{
   const waiting={...base,status:"ĐANG CHỜ",activeLease:false,activeWorker:null,
     executionEligibility:"READY",waitReason:"Chờ #5185",blocker:null};
   const result=projectOwnerLiveTruth(waiting,context);
   expect(result.status).toBe("WAITING");
   expect(result.canExecuteNow).toBe(false);
   expect(result.blocker).toBe("Chờ #5185");
 });
 it("requires an actionable effective state and no blocker before showing execute-now",()=>{
   const ready={...base,status:"QUEUED",activeLease:false,activeWorker:null,
     executionEligibility:"READY",waitReason:null,blocker:null};
   expect(projectOwnerLiveTruth(ready,context).canExecuteNow).toBe(true);
   expect(projectOwnerLiveTruth({...ready,status:"OPEN"},context).canExecuteNow).toBe(true);
   expect(projectOwnerLiveTruth({...ready,status:"QUEUED",blocker:"WAIT_DEPENDENCY"},context).canExecuteNow).toBe(false);
   expect(projectOwnerLiveTruth({...ready,status:"WAITING"},context).canExecuteNow).toBe(false);
   expect(projectOwnerLiveTruth({...ready,ownerGate:true},context).canExecuteNow).toBe(false);
   expect(projectOwnerLiveTruth(ready,{...context,sourceFresh:false}).canExecuteNow).toBe(false);
 });
 it("does not show 100 percent before final acceptance or completion proof",()=>{
   const row={...base,status:"DONE",progressDone:9,progressTotal:9,completionVerified:false};
   const result=projectOwnerLiveTruth(row,context);
   expect(result.status).toBe("VERIFY");
   expect(result.progress).toEqual({done:9,total:9,percent:null});
   expect(projectOwnerLiveTruth({...row,progressChecklistVerified:false},context).progress).toBeNull();
 });
 it("the API and same Work Card consume one shared truth projection",()=>{
   const api=readFileSync(new URL("../api/live-status.mjs",import.meta.url),"utf8");
   const card=readFileSync(new URL("../public/work-center.js",import.meta.url),"utf8");
   expect(api).toContain("projectOwnerLiveTruth(localized");
   expect(card).toContain("row?.liveTruth?.status");
   expect(card).toContain("CHƯA XÁC MINH NGUỒN");
   expect(card).toContain("BƯỚC TỚI:");
 });
});
