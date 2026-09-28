import { describe, expect, it } from 'vitest';
import '../apps/tigeriq-core/web-control-health-model.js';

const model=(globalThis as any).TigerIqHealthModel;
const NOW=Date.parse('2026-09-29T00:00:00Z');
const ago=(minutes:number)=>new Date(NOW-minutes*60_000).toISOString();
const future=(minutes:number)=>new Date(NOW+minutes*60_000).toISOString();

describe('Web Control live health model',()=>{
  it('keeps recovered/healthy resources healthy while retaining old error as history',()=>{
    const truth=model.resourceHealthTruth({status:'IDLE',last_error:'timeout',last_error_at:ago(180),last_seen_at:ago(2)},NOW);
    expect(truth).toMatchObject({status:'IDLE',current:true,historical:true});
    expect(truth.detail).toContain('Lỗi trước đó');
    expect(truth.detail).toContain('180p trước');
    expect(truth.detail).not.toContain('2p trước');
  });

  it('expires stale rate limits and preserves only current 429/cooldown as RATE_LIMITED',()=>{
    expect(model.resourceHealthTruth({status:'RATE_LIMITED',last_error:'rate_limit',last_seen_at:ago(120),cooldown_until:ago(60)},NOW).status).toBe('STALE_ERROR');
    expect(model.resourceHealthTruth({status:'RATE_LIMITED',last_error:'rate_limit',last_seen_at:ago(1),last_429_at:ago(120),cooldown_until:ago(60)},NOW).status).toBe('STALE_ERROR');
    expect(model.resourceHealthTruth({status:'RATE_LIMITED',last_error:'HTTP_429',last_seen_at:ago(2),last_429_at:ago(2),cooldown_until:future(10)},NOW).status).toBe('RATE_LIMITED');
  });

  it('classifies current auth/config/response-contract errors distinctly',()=>{
    expect(model.resourceHealthTruth({status:'ERROR',last_error:'HTTP_401 auth',last_seen_at:ago(1)},NOW).status).toBe('AUTH_ERROR');
    expect(model.resourceHealthTruth({status:'ERROR',last_error:'configuration',last_seen_at:ago(1)},NOW).status).toBe('CONFIG_ERROR');
    expect(model.resourceHealthTruth({status:'ERROR',last_error:'invalid_response',last_seen_at:ago(1)},NOW).status).toBe('CONTRACT_ERROR');
  });

  it('fails safe on missing/invalid timestamps instead of raising a false current alert',()=>{
    expect(model.resourceHealthTruth({status:'ERROR',last_error:'invalid_response',last_seen_at:null},NOW).status).toBe('STALE_ERROR');
    expect(model.resourceHealthTruth({status:'RATE_LIMITED',last_error:'rate_limit',last_seen_at:'bad-date'},NOW).status).toBe('STALE_ERROR');
  });

  it('orders owner cards by working, healthy, manual, cooldown, current errors, wait-key, stale, offline, stopped',()=>{
    const order=model.STATUS_ORDER;
    expect([order.BUSY,order.READY,order.MANUAL,order.RATE_LIMITED,order.CONTRACT_ERROR,order.WAIT_KEY,order.STALE_ERROR,order.OFFLINE,order.DISABLED])
      .toEqual([...new Set([order.BUSY,order.READY,order.MANUAL,order.RATE_LIMITED,order.CONTRACT_ERROR,order.WAIT_KEY,order.STALE_ERROR,order.OFFLINE,order.DISABLED])].sort((a,b)=>a-b));
  });

  it('renders canonical Core quota telemetry without inventing missing values',()=>{
    expect(model.quotaSummary({
      quota_state:{
        known:true,
        usable:true,
        requestRemaining:80,
        requestLimit:100,
        tokenRemaining:4000,
        tokenLimit:10000,
        remainingRatio:0.4,
        resetAt:'2026-09-29T01:00:00.000Z'
      }
    })).toBe('Request 80/100 · Token 4000/10000 · Còn 40% · reset 2026-09-29T01:00:00.000Z');
    expect(model.quotaSummary({quota_state:{known:false,usable:true}})).toBe('Quota provider chưa trả số dư');
    expect(model.quotaSummary({})).toBe('Quota chưa có dữ liệu');
  });

  it('builds 24h provider rows from real counters without inventing missing usage',()=>{
    const rows=model.performanceRows24h([
      {employee_id:'NV11',provider:'groq',calls_success_24h:9,calls_failure_24h:1,last_latency_ms:250},
      {employee_id:'NV12',provider:'gemini',calls_success_24h:0,calls_failure_24h:0,last_latency_ms:null}
    ]);
    expect(rows[0]).toMatchObject({employeeId:'NV11',success:9,errors:1,successRate:90,latencyMs:250,hasData:true});
    expect(rows[1]).toMatchObject({employeeId:'NV12',successRate:null,latencyMs:null,hasData:false});
  });

  it('excludes stale history from current alerts',()=>{
    const alerts=model.currentAlertRows([
      {employee_id:'NV10',status:'IDLE',last_error:'timeout',last_seen_at:ago(1)},
      {employee_id:'NV13',status:'RATE_LIMITED',last_error:'rate_limit',last_seen_at:ago(1),cooldown_until:future(5)},
      {employee_id:'NV15',status:'ERROR',last_error:'invalid_response',last_seen_at:ago(180)}
    ],NOW);
    expect(alerts.map((x:any)=>x.resource.employee_id)).toEqual(['NV13']);
  });
});
