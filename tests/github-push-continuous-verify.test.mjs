import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {enrichGithubPushPayload,compareChangedPaths} from '../scripts/tigeriq-core/enrich-github-push-event.mjs';
import {githubContinuousVerifyTrigger} from '../apps/tigeriq-core/continuous-verify.mjs';

const SHA_A='a'.repeat(40), SHA_B='b'.repeat(40);
const repository='newsdayads/tigeriq-ai-lab';
const payload=()=>({repository:{full_name:repository},ref:'refs/heads/main',before:SHA_A,after:SHA_B});
const respond=(files)=>vi.fn(async()=>({ok:true,json:async()=>({files})}));

describe('GH-5169 real signed GitHub main push delivery',()=>{
  it('enriches a shared-only push from authoritative GitHub compare and generates the Core trigger',async()=>{
    const fetchImpl=respond([{filename:'apps/shared/rdc-account-preflight.mjs',status:'modified'}]);
    const enriched=await enrichGithubPushPayload(payload(),{token:'test-token',fetchImpl});
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `https://api.github.com/repos/${repository}/compare/${SHA_A}...${SHA_B}`
    );
    expect(enriched.changedPaths).toEqual(['apps/shared/rdc-account-preflight.mjs']);
    expect(githubContinuousVerifyTrigger({eventName:'push',deliveryId:'run-123',
      payload:enriched})).toMatchObject({
      trigger:true,kind:'GITHUB_MAIN_PUSH',key:'github-main:'+SHA_B,
      relevantPaths:['apps/shared/rdc-account-preflight.mjs'],
    });
  });

  it('includes both old and new paths for renamed shared modules',()=>{
    const result=compareChangedPaths({files:[{
      filename:'apps/shared/renamed.mjs',
      previous_filename:'apps/shared/legacy.mjs',status:'renamed'
    }]});
    expect(result).toEqual(['apps/shared/renamed.mjs','apps/shared/legacy.mjs']);
  });

  it('denies unverified main identity, malformed before/after and missing token before network',async()=>{
    const fetchImpl=vi.fn();
    for(const bad of [
      {...payload(),ref:'refs/heads/feature'},
      {...payload(),repository:{full_name:'other/repo'}},
      {...payload(),before:'not-a-sha'},
      {...payload(),after:SHA_A},
    ]){
      await expect(enrichGithubPushPayload(bad,{token:'test-token',fetchImpl}))
        .rejects.toThrow();
    }
    await expect(enrichGithubPushPayload(payload(),{token:'',fetchImpl}))
      .rejects.toThrow('GITHUB_PUSH_TOKEN_REQUIRED');
    await expect(enrichGithubPushPayload(payload(),{token:'test-token',fetchImpl,apiUrl:'http://127.0.0.1:1234'}))
      .rejects.toThrow('GITHUB_PUSH_API_ORIGIN_DENIED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed on missing/truncated compare and GitHub API error',async()=>{
    expect(()=>compareChangedPaths({files:new Array(300).fill({filename:'shared.mjs'})}))
      .toThrow('GITHUB_PUSH_COMPARE_TOO_MANY_FILES');
    expect(()=>compareChangedPaths({})).toThrow('GITHUB_PUSH_COMPARE_FILES_MISSING');
    expect(()=>compareChangedPaths({files:[{filename:''}]}))
      .toThrow('GITHUB_PUSH_COMPARE_PATH_INVALID');
    const fetchImpl=vi.fn(async()=>({ok:false,status:403}));
    await expect(enrichGithubPushPayload(payload(),{token:'test-token',fetchImpl}))
      .rejects.toThrow('GITHUB_PUSH_COMPARE_UNAVAILABLE');
  });

  it('only dispatches canonical main push, retaining signed OIDC and a bounded local receipt',()=>{
    const workflow=readFileSync(new URL('../.github/workflows/tigeriq-core-event-dispatch.yml',import.meta.url),'utf8');
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(workflow).toContain('  push:\n    branches: [main]');
    expect(workflow).toContain("if: github.event_name == 'push'");
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('enrich-github-push-event.mjs');
    expect(workflow).toContain('--data-binary "@$payload"');
    expect(workflow).toContain('audience=tigeriq-core');
    expect(workflow).not.toMatch(/TIGERIQ_CORE_TOKEN|WEBHOOK_SECRET/);
    expect(core).toContain("url.pathname==='/api/continuous-verify-evidence'");
    expect(core).toContain("data->>'key'=$1 order by seq desc limit 12");
    expect(core).toContain("eventName==='push'");
    expect(core).toContain('GITHUB_EVENT_RECEIVED');
  });
});
