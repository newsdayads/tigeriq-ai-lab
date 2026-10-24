import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGithubForbidden } from '../api/control.mjs';

test('Owner comment 403: distinguish insufficient write permission from rate limits',()=>{
 const missing=classifyGithubForbidden({message:'Resource not accessible by personal access token'});
 assert.deepEqual(missing,{reason:'GITHUB_ISSUES_WRITE_PERMISSION',retryable:false});
 const install=classifyGithubForbidden({message:'Resource not accessible by integration'});
 assert.equal(install.reason,'GITHUB_ISSUES_WRITE_PERMISSION');
 assert.deepEqual(classifyGithubForbidden({message:'You have exceeded a secondary rate limit.'}),{reason:'GITHUB_RATE_LIMIT',retryable:true});
 assert.deepEqual(classifyGithubForbidden({}, {rateLimitRemaining:'0'}),{reason:'GITHUB_RATE_LIMIT',retryable:true});
 assert.equal(classifyGithubForbidden({message:'SAML SSO access must be authorized'}).reason,'GITHUB_ORG_AUTHORIZATION');
 const unknown=classifyGithubForbidden({message:'Forbidden'});
 assert.deepEqual(unknown,{reason:'GITHUB_FORBIDDEN_UNCLASSIFIED',retryable:false});
 assert.ok(!JSON.stringify(missing).includes('personal access token'));
});

test('Owner work request UI retains the exact draft and locks repeat submissions after GitHub 403',async()=>{
 const {readFileSync}=await import('node:fs');
 const ui=readFileSync(new URL('../apps/tigeriq-core/dashboard.html',import.meta.url),'utf8');
 assert.ok(ui.includes("if(res.status===403&&data.error==='github_403')"));
 assert.ok(ui.includes('ownerRequestWriteBlocked=true'));
 assert.ok(ui.includes('ownerRequestSend.disabled=true'));
 assert.ok(ui.includes('Nội dung vẫn giữ nguyên'));
 assert.ok(ui.includes('ownerRequestWriteBlocked||!(ownerRequestSecure()&&ownerRequestApiReady)'));
 assert.ok(ui.includes('ownerRequestCanReuseId('));
});
