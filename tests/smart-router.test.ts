// @ts-nocheck
import { describe,expect,it } from 'vitest';
import {
  ROUTING_PROFILES,
  createResourceId,
  deriveRoutingProfile,
  failurePolicy,
  normalizeQuota,
  quotaUsable,
  rankCandidates,
} from '../apps/tigeriq-core/smart-router.mjs';

const base=(overrides={})=>({
  resource_id:'res:groq:default',employee_id:'NV11',provider:'groq',model:'free-model',enabled:true,
  health_state:'ONLINE',cooldown_until:null,cost_tier:'FREE',capabilities:['general','reasoning','review'],rank:10,
  success_count:9,failure_count:1,last_latency_ms:900,quota_state:{known:false,usable:true},taskStats:{general:{success:9,failure:1,retry:0,failover:0}},...overrides,
});

describe('#777 Smart Router foundation',()=>{
  it('exposes every required routing profile',()=>{expect(ROUTING_PROFILES).toEqual(['AUTO','CODING','FAST','CHEAP','LOCAL','RESEARCH','REVIEW']);});
  it('keeps resource identity stable and independent from employee identity',()=>{expect(createResourceId('Ollama','default')).toBe('res:ollama:default');const a=base({resource_id:'res:ollama:default',employee_id:'NV02',provider:'ollama'});const b={...a,employee_id:'NV10'};expect(a.resource_id).toBe(b.resource_id);});
  it('derives profiles from task kind/capability without guessing unknown requests',()=>{expect(deriveRoutingProfile({capability:'coding'})).toBe('CODING');expect(deriveRoutingProfile({taskKind:'research'})).toBe('RESEARCH');expect(deriveRoutingProfile({requested:'weird'})).toBe('AUTO');});
  it('never selects paid fallback and prefers local for LOCAL',()=>{const paid=base({resource_id:'res:paid:default',provider:'paid',cost_tier:'PAID',rank:1});const local=base({resource_id:'res:ollama:default',employee_id:'NV10',provider:'ollama',cost_tier:'LOCAL',rank:90,last_latency_ms:5000});const remote=base();expect(rankCandidates([paid,local,remote],{profile:'AUTO'}).candidates.find(x=>x.resourceId==='res:paid:default')?.reasons).toContain('paid_fallback_forbidden');expect(rankCandidates([local,remote],{profile:'LOCAL'}).chosen?.resourceId).toBe('res:ollama:default');});
  it('enforces reviewer independence',()=>{const a=base();const b=base({resource_id:'res:gemini:default',employee_id:'NV12',provider:'gemini',rank:20});const d=rankCandidates([a,b],{profile:'REVIEW',capability:'review',reviewerResourceId:'res:groq:default'});expect(d.chosen?.resourceId).toBe('res:gemini:default');expect(d.candidates.find(x=>x.resourceId==='res:groq:default')?.reasons).toContain('reviewer_independence');});
  it('handles unknown quota without inventing numbers and known exhausted quota as unusable',()=>{expect(normalizeQuota({})).toMatchObject({known:false,usable:true,remainingRatio:null,sourceConfidence:'low'});expect(quotaUsable({known:true,usable:false,resetAt:'2999-01-01T00:00:00Z'},Date.parse('2026-09-15T00:00:00Z'))).toBe(false);expect(rankCandidates([base({quota_state:{known:true,usable:false,resetAt:'2999-01-01T00:00:00Z'}})],{}).chosen).toBeNull();});
  it('filters active cooldown and adds bounded performance penalties by task kind',()=>{const slow=base({resource_id:'res:slow:default',provider:'slow',last_latency_ms:7000,taskStats:{general:{success:1,failure:9,retry:3,failover:2}}});const fast=base({resource_id:'res:fast:default',provider:'fast',last_latency_ms:200,taskStats:{general:{success:9,failure:1,retry:0,failover:0}}});expect(rankCandidates([slow,fast],{profile:'FAST'}).chosen?.resourceId).toBe('res:fast:default');expect(rankCandidates([fast,{...slow,cooldown_until:'2999-01-01T00:00:00Z'}],{nowMs:Date.parse('2026-09-15T00:00:00Z')}).candidates.find(x=>x.resourceId==='res:slow:default')?.reasons).toContain('cooldown');});
  it('returns explainable decision evidence',()=>{const d=rankCandidates([base()],{profile:'AUTO',taskKind:'general',capability:'reasoning'});expect(d).toMatchObject({profile:'AUTO',taskKind:'general',capability:'reasoning'});expect(d.chosen?.reasons.length).toBeGreaterThan(0);expect(d.candidates[0]).toHaveProperty('score');});
  it('uses failure-class policies and stops automatic auth/configuration bypass',()=>{expect(failurePolicy('rate_limit')).toMatchObject({retrySameResource:false,failover:true,stop:false});expect(failurePolicy('timeout')).toMatchObject({retrySameResource:true,failover:true});expect(failurePolicy('auth')).toMatchObject({failover:false,stop:true});expect(failurePolicy('configuration')).toMatchObject({failover:false,stop:true});expect(failurePolicy('invalid_response')).toMatchObject({failover:true,stop:false});});
});
