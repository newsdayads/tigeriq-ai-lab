import {describe,it,expect} from 'vitest';
import {codexQuotaSnapshot,antigravityQuotaSnapshots,chooseOwnerCodingRoute} from './owner-cli-quota-routing.mjs';
const now='2026-11-21T18:10:00.000Z',nowMs=Date.parse(now);
const codex=codexQuotaSnapshot({rateLimits:{primary:{usedPercent:87,resetsAt:1795293985},secondary:{usedPercent:32,resetsAt:1795837621},rateLimitReachedType:null}},{observedAt:now});
const agy=antigravityQuotaSnapshots({status:'SUCCESS',command:{name:'usage',data:{groups:[{name:'Gemini Models',buckets:[{remaining_fraction:1,window:'weekly'},{remaining_fraction:1,window:'5h'}]},{name:'Claude and GPT models',buckets:[{remaining_fraction:1,window:'weekly'},{remaining_fraction:1,window:'5h'}]}]}}},{observedAt:now});
const job={id:'GH-5744',resourceScope:'repo:tigeriq:owner-coding',difficulty:'LOW'};
const models=['gemini-4-hydrogen-low','gemini-4-hydrogen-medium','gemini-3.8-flash-low','gemini-4-neon-high','claude-sonnet-5-5-medium'];
const args={job,snapshots:[...agy,codex],antigravityModels:models,codexModels:['gpt-5.6-codex'],auth:{antigravity:true,codex:true},nowMs};
describe('Owner CLI quota routing: fail closed',()=>{
 it('reads Codex real window minima (not sum)',()=>{expect(codex.remainingFraction).toBeCloseTo(0.13);expect(codex.windows).toHaveLength(2);});
 it('reads Antigravity group specific quotas',()=>{expect(agy).toHaveLength(2);expect(agy[0].remainingFraction).toBe(1);});
 it('uses a live lightweight available model before Codex',()=>{expect(chooseOwnerCodingRoute(args)).toMatchObject({chosen:{provider:'antigravity',model:'gemini-4-hydrogen-low'},code:'ELIGIBLE_NOT_DISPATCHED'});});
 it('does not spend a stronger model pool merely because its quota is higher',()=>{
   const lowGemini={...agy[0],remainingFraction:0.06};
   const decision=chooseOwnerCodingRoute({...args,snapshots:[lowGemini,agy[1],codex]});
   expect(decision.chosen).toMatchObject({provider:'antigravity',group:'Gemini Models',model:'gemini-4-hydrogen-low'});
 });
 it('defaults to Hydrogen Low and uses Medium only for explicit complexity',()=>{
   expect(chooseOwnerCodingRoute({...args,job:{id:job.id,resourceScope:job.resourceScope}}).chosen.model).toBe('gemini-4-hydrogen-low');
   for(const difficulty of ['MEDIUM','HIGH'])expect(chooseOwnerCodingRoute({...args,job:{...job,difficulty}}).chosen.model).toBe('gemini-4-hydrogen-medium');
 });
 it('does not silently select expensive alternatives when Hydrogen or Gemini quota is unavailable',()=>{
   expect(chooseOwnerCodingRoute({...args,antigravityModels:['gemini-4-neon-high','claude-sonnet-5-5-medium']}).chosen).toBeNull();
   expect(chooseOwnerCodingRoute({...args,snapshots:[{...agy[0],remainingFraction:0.02},agy[1]]}).chosen).toBeNull();
 });
 it('uses Sonnet Low from a separate verified quota only when the preferred Gemini route is unavailable',()=>{
   const fallback={...args,antigravityModels:[...models,'claude-sonnet-5-5-low']};
   expect(chooseOwnerCodingRoute({...fallback,snapshots:[{...agy[0],remainingFraction:0.06},agy[1]]}).chosen.model).toBe('gemini-4-hydrogen-low');
   expect(chooseOwnerCodingRoute({...fallback,snapshots:[{...agy[0],remainingFraction:0},agy[1]]}).chosen.model).toBe('claude-sonnet-5-5-low');
   expect(chooseOwnerCodingRoute({...fallback,snapshots:[]}).chosen).toBeNull();
   expect(chooseOwnerCodingRoute({...fallback,job:{...job,difficulty:'LOW'},antigravityModels:['gemini-4-hydrogen-medium']}).chosen.model).toBe('gemini-4-hydrogen-medium');
 });
 it('does not infer quota from model availability',()=>{expect(chooseOwnerCodingRoute({...args,snapshots:[]})).toMatchObject({chosen:null,code:'NO_VERIFIED_AUTHORIZED_QUOTA'});});
 it('rejects stale snapshots',()=>{expect(chooseOwnerCodingRoute({...args,nowMs:nowMs+121000}).chosen).toBeNull();});
 it('rejects unverified Antigravity authentication',()=>{expect(chooseOwnerCodingRoute({...args,auth:{antigravity:false,codex:true}}).chosen).toBeNull();});
 it('rejects blanket Codex approval without exact work scope',()=>{expect(chooseOwnerCodingRoute({...args,snapshots:[codex],auth:{antigravity:false,codex:true}}).chosen).toBeNull();});
 it('accepts only a precisely scoped Codex grant as an eligible proposal',()=>{
   const b={...args,job:{...job,codexGrant:{approved:true,jobId:job.id,resourceScope:job.resourceScope}},snapshots:[codex],auth:{antigravity:false,codex:true}};
   expect(chooseOwnerCodingRoute(b)).toMatchObject({code:'ELIGIBLE_NOT_DISPATCHED',chosen:{provider:'codex'}});
 });
 it('does not route P0 or missing work scope',()=>{expect(chooseOwnerCodingRoute({...args,job:{...job,priority:'P0'}}).chosen).toBeNull();expect(chooseOwnerCodingRoute({...args,job:{id:'x'}}).chosen).toBeNull();});
 it('rejects partial or inconsistent quota evidence',()=>{
   const bad=antigravityQuotaSnapshots({status:'SUCCESS',command:{name:'usage',data:{groups:[{name:'Gemini Models',buckets:[{remaining_fraction:0.9},{name:'unknown'}]}]}}},{observedAt:now});
   expect(bad[0].quotaKnown).toBe(false);expect(chooseOwnerCodingRoute({...args,snapshots:bad}).chosen).toBeNull();
 });
});
