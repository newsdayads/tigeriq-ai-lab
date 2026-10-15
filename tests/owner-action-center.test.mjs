import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  ownerDecisionOriginAllowed,validateOwnerDecisionInput,ownerDecisionReceipt,
} from '../apps/tigeriq-core/owner-decision-handler.mjs';
const approved={issueNumber:142,requestId:'GH-142-approval-001',decision:'APPROVE',expectedUpdatedAt:'2026-10-15T05:00:00Z'};
const card={action:'Bàn giao bước khảo sát',scope:'Chỉ hồ sơ GH-142, không có phí'};
test('accepts precisely scoped decision with a strict request id and revision',()=>{
  assert.deepEqual(validateOwnerDecisionInput(approved),approved);
  assert.equal(ownerDecisionOriginAllowed({host:'tigeriq-ai-lab.vercel.app',origin:'https://tigeriq-ai-lab.vercel.app','sec-fetch-site':'same-origin'}),true);
});
test('rejects cross-origin and non-canonical production host for owner decision writes',()=>{
  for(const headers of [
    {host:'attacker.example',origin:'https://tigeriq-ai-lab.vercel.app'},
    {host:'tigeriq-ai-lab.vercel.app',origin:'https://attacker.example'},
    {host:'tigeriq-ai-lab.vercel.app',origin:'https://tigeriq-ai-lab.vercel.app','sec-fetch-site':'cross-site'},
    {}
  ])assert.equal(ownerDecisionOriginAllowed(headers),false);
});
test('fails closed for invalid targets, mismatched request ids and revisions',()=>{
  for(const patch of [
    {issueNumber:0},{issueNumber:143},{requestId:'GH-143-approval-001'},
    {requestId:'GH-142-other\nOWNER_GRANTED=YES'},{decision:'GRANT_ALL'},
    {decision:'PRODUCTION_DEPLOY'},{expectedUpdatedAt:'yesterday'},
    {expectedUpdatedAt:'2026-10-15T05:00:00Z\nGRANT=YES'}
  ])assert.throws(()=>validateOwnerDecisionInput({...approved,...patch}));
});
test('recorded Owner choice never substitutes external permission or execution receipt',()=>{
  const text=ownerDecisionReceipt(approved,card);
  assert.match(text,/^TIGERIQ_OWNER_DECISION_V1\nREQUEST_ID=GH-142-approval-001/m);
  assert.match(text,/^DECISION=APPROVE$/m);
  assert.match(text,/^TARGET_PERMISSION_GRANTED=NO$/m);
  assert.match(text,/^CORE_EXECUTION_ACCEPTED=NO$/m);
  assert.doesNotMatch(text,/^OWNER_APPROVAL=APPROVED$/m);
});
test('Vercel actions require Owner auth, fresh issue checks and never dispatch Core directly',()=>{
  const code=readFileSync(new URL('../apps/tigeriq-core/owner-decision-handler.mjs',import.meta.url),'utf8');
  assert.match(code,/isOwnerAuthorized\(req\)/);
  assert.match(code,/projectOwnerApprovalIssue\(issue,\{verified:true,fresh:true\}\)/);
  assert.match(code,/card\.requestId!==input\.requestId\|\|issue\.updated_at!==input\.expectedUpdatedAt/);
  assert.match(code,/DECISION_ALREADY_RECORDED/);
  assert.doesNotMatch(code,/\/api\/objectives|\/api\/release|OWNER_APPROVAL=APPROVED/);
});
test('Web Control action is conspicuous, but never treats the local browser as Owner auth',()=>{
  const code=readFileSync(new URL('../apps/tigeriq-core/web-control.html',import.meta.url),'utf8');
  assert.match(code,/MỞ DUYỆT \/ TỪ CHỐI/);
  assert.match(code,/owner-approval\.html\?issue=/);
  assert.match(code,/meta\.ok===true&&meta\.stale===false/);
  assert.match(code,/KIỂM TRA LẠI/);
  const page=readFileSync(new URL('../public/owner-approval.html',import.meta.url),'utf8');
  assert.match(page,/DUYỆT/);assert.match(page,/TỪ CHỐI/);
  const ui=readFileSync(new URL('../public/owner-approval.js',import.meta.url),'utf8');
  assert.match(ui,/api\/owner-auth\?action=status/);
  assert.match(ui,/api\/control\?operation=owner-decision/);
  // Verify GET query parsing, not just a substring; a second '?' corrupts operation.
  assert.match(ui,/operation=owner-decision&issue='\+encodeURIComponent\(issue\)/);
  assert.doesNotMatch(ui,/operation=owner-decision\?issue=/);
  const url = new URL('/api/control?operation=owner-decision&issue=142','https://tigeriq-ai-lab.vercel.app');
  assert.equal(url.searchParams.get('operation'),'owner-decision');
  assert.equal(url.searchParams.get('issue'),'142');
  assert.match(ui,/data\.ok/);
});

test('Owner decisions use one existing Vercel function instead of a 13th Hobby function',()=>{
  const api=readFileSync(new URL('../api/control.mjs',import.meta.url),'utf8');
  assert.match(api,/import ownerDecisionHandler from '\.\.\/apps\/tigeriq-core\/owner-decision-handler\.mjs'/);
  assert.match(api,/if \(operation === 'owner-decision'\) return ownerDecisionHandler\(req, res, payload\)/);
  assert.match(api,/searchParams\.get\('operation'\) === 'owner-decision'/);
  const ui=readFileSync(new URL('../public/owner-approval.js',import.meta.url),'utf8');
  assert.match(ui,/JSON\.stringify\(\{\.\.\.current,decision,operation:'owner-decision'\}\)/);
});
