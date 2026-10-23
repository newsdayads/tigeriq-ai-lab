import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error The production ESM helper is intentionally untyped JS; exercise its runtime exports.
import { ownerWorkRequestReplayPlan, validateOwnerWorkRequest } from '../apps/shared/owner-work-request.mjs';

const uuid='c6b90d64-b49c-4bb9-becb-d696a043ab74';
const request={issueNumber:5252,requestId:uuid,message:'Ưu tiên sửa lỗi bảo vệ nội dung Owner.'};
const old={...request,status:'PLAN_SHOWN',receiptUrl:'https://github.com/newsdayads/tigeriq-ai-lab/issues/5252#issuecomment-111'};

test('never treat a different Owner instruction with the same UUID as a successful retry',()=>{
  expect(ownerWorkRequestReplayPlan([old],request)).toEqual({kind:'REPLAY',request:old});
  expect(ownerWorkRequestReplayPlan([old],{...request,message:'Xóa toàn bộ dữ liệu'}))
    .toEqual({kind:'CONFLICT',request:null});
  expect(ownerWorkRequestReplayPlan([old],{...request,issueNumber:5253}))
    .toEqual({kind:'CONFLICT',request:null});
});

test('an independent Owner request still creates a new receipt and invalid IDs are rejected',()=>{
  const newRequest={...request,requestId:'de49827e-9f2c-4f31-a202-5097cd35504e'};
  expect(ownerWorkRequestReplayPlan([old],newRequest)).toEqual({kind:'NEW',request:null});
  expect(ownerWorkRequestReplayPlan([],request)).toEqual({kind:'NEW',request:null});
  expect(ownerWorkRequestReplayPlan(null,request)).toEqual({kind:'NEW',request:null});
  expect(()=>validateOwnerWorkRequest({...request,message:'  '})).toThrow('invalid_owner_request_message');
  expect(()=>ownerWorkRequestReplayPlan([old],{...request,requestId:'forged'}))
    .toThrow('invalid_owner_request_id');
});

test('actual server API must reject UUID-content conflict, not create or deduplicate a different message',()=>{
  const control=readFileSync(new URL('../api/control.mjs',import.meta.url),'utf8');
  const start=control.indexOf('async function ownerRequestApi(');
  const end=control.indexOf('\nexport default async function handler(',start);
  expect(start).toBeGreaterThan(0);
  const handler=control.slice(start,end);
  const replayAt=handler.indexOf('const replay=ownerWorkRequestReplayPlan(history,request);');
  const newCommentAt=handler.indexOf('const saved=await gh(');
  expect(replayAt).toBeGreaterThan(0);
  expect(newCommentAt).toBeGreaterThan(replayAt);
  expect(handler).toContain("if(replay.kind==='CONFLICT')return json(res,409,{ok:false,error:'owner_request_id_content_conflict'});");
  expect(handler).toContain("if(replay.kind==='REPLAY')return json(res,200,{ok:true,deduplicated:true,request:replay.request});");
  expect(handler).toContain('const request=validateOwnerWorkRequest(payload);');
});

test('comment page boundary fails closed instead of allowing hidden older UUIDs to be submitted again',()=>{
  const control=readFileSync(new URL('../api/control.mjs',import.meta.url),'utf8');
  const start=control.indexOf('async function ownerRequestComments(');
  const end=control.indexOf('async function ownerRequestApi(',start);
  expect(start).toBeGreaterThan(0);
  const reader=control.slice(start,end);
  expect(reader).toContain('for(let page=1;page<=5;page++)');
  expect(reader).toContain("if(page===5&&batch.length===100){const error=new Error('owner_request_history_incomplete');error.status=409;throw error;}");
});
