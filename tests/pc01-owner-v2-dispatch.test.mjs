import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

it('routes only a versioned Owner release comment into the existing OIDC validator',()=>{
  const core=readFileSync(fileURLToPath(new URL('../apps/tigeriq-core/core.mjs',import.meta.url)),'utf8');
  const marker="if(eventName==='issue_comment'&&";
  const begin=core.indexOf(marker,core.indexOf('// Exact manual Owner comment'));
  const end=core.indexOf('const approval=await acceptPc01OwnerApprovalEvent',begin);
  expect(begin).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(begin);
  const matchExpression=core.slice(begin,end);
  expect(matchExpression).toContain('TIGERIQ_PC01_RELEASE_APPROVE_V[12]');
  expect(matchExpression).toContain('payload?.comment?.body');
  expect(matchExpression).toContain("eventName==='issue_comment'");
  expect(matchExpression).not.toContain('V[0-9]');
  expect(core.slice(end,end+220)).toContain('identity,eventName,payload,githubToken:GITHUB_TOKEN');
});
