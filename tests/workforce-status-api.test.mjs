import { afterEach, describe, expect, it } from 'vitest';
import { fetchWorkforceStatus, sanitizeWorkforceSnapshot } from '../api/workforce-status.mjs';
import {
  fetchRegistryIssue,
  refreshRegistryWorkforce,
  resetWorkforceRegistryForTests,
} from '../apps/tigeriq-core/workforce-registry.mjs';
import {
  resetGithubSharedClientForTests,
} from '../apps/tigeriq-core/github-shared-client.mjs';

afterEach(() => {
  delete process.env.TIGERIQ_WORKFORCE_STATUS_URL;
  delete process.env.TIGERIQ_WORKFORCE_STATUS_TOKEN;
  resetWorkforceRegistryForTests();
  resetGithubSharedClientForTests();
});

describe('Workforce status ingress', () => {
  it('reports an honest disconnected state when no controller ingress is configured', async () => {
    const result = await fetchWorkforceStatus();
    expect(result.connected).toBe(false);
    expect(result.mode).toBe('not-configured');
    expect(result.workforce).toBeNull();
  });

  it('requires HTTPS for any configured controller ingress', async () => {
    process.env.TIGERIQ_WORKFORCE_STATUS_URL = 'http://127.0.0.1:8787/api/workforce/status';
    await expect(fetchWorkforceStatus()).rejects.toThrow('workforce_status_url_must_use_https');
  });

  it('uses an environment-only bearer token and sanitizes the remote snapshot', async () => {
    process.env.TIGERIQ_WORKFORCE_STATUS_URL = 'https://controller.example.test/api/workforce/status';
    process.env.TIGERIQ_WORKFORCE_STATUS_TOKEN = 'secret-status-token';
    let seenAuthorization = '';
    const result = await fetchWorkforceStatus(async (_url, init) => {
      seenAuthorization = String(init?.headers?.authorization || '');
      return new Response(JSON.stringify({
        ok: true,
        workforce: {
          generatedAt: '2026-08-31T00:00:00.000Z',
          nodes: { total: 2, byStatus: { online: 2, unexpected: 99 }, byKind: { android: 2 } },
          employees: {
            total: 2,
            byAvailability: { idle: 1, busy: 1 },
            activeTasks: 1,
            concurrencyCapacity: 2,
            utilization: 0.5,
            departments: { Operations: 2 },
            providers: { local: 2 },
          },
          tasks: { total: 3, byStage: { queued: 1, running: 1, completed: 1 }, active: 2, terminal: 1, failed: 0 },
          privateSecret: 'must-not-pass-through',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    expect(seenAuthorization).toBe('Bearer secret-status-token');
    expect(result.connected).toBe(true);
    expect(result.workforce.nodes.byStatus).toEqual({ online: 2, degraded: 0, offline: 0 });
    expect(result.workforce.privateSecret).toBeUndefined();
  });

  it('clamps malformed counters rather than reflecting arbitrary controller data', () => {
    const sanitized = sanitizeWorkforceSnapshot({
      nodes: { total: -3, byStatus: { online: -1 } },
      employees: { utilization: 42, providers: { x: -2 } },
      tasks: { failed: Number.NaN },
    });
    expect(sanitized.nodes.total).toBe(0);
    expect(sanitized.nodes.byStatus.online).toBe(0);
    expect(sanitized.employees.utilization).toBe(1);
    expect(sanitized.employees.providers.x).toBe(0);
    expect(sanitized.tasks.failed).toBe(0);
  });
});


describe('Core workforce registry transport', () => {
  const registryBody = (version='99') => `REGISTRY_ROOT_VERSION=${version}\n| NV11 | Groq | READY |`;

  it('uses authenticated GitHub transport for registry #335 on a 200 response', async () => {
    let authorization = '';
    let apiVersion = '';
    const issue = await fetchRegistryIssue({
      token:'abc',
      fetchImpl:async (_url, init={}) => {
        authorization=String(init?.headers?.authorization||'');
        apiVersion=String(init?.headers?.['x-github-api-version']||'');
        return new Response(JSON.stringify({number:335,body:registryBody()}),{
          status:200,
          headers:{'content-type':'application/json','etag':'"v99"','x-ratelimit-remaining':'4999','x-ratelimit-reset':'1999999999'}
        });
      },
    });
    expect(authorization).toBe('Bearer abc');
    expect(apiVersion).toBe('2022-11-28');
    expect(issue.number).toBe(335);
  });

  it('never forwards the GitHub token to a non-GitHub registry override', async () => {
    let authorization = 'unset';
    await fetchRegistryIssue({
      token:'secret-repo-token',
      url:'https://registry.example.test/issue/335',
      fetchImpl:async (_url, init={}) => {
        authorization=String(init?.headers?.authorization||'');
        return new Response(JSON.stringify({number:335,body:registryBody()}),{
          status:200,
          headers:{'content-type':'application/json','x-ratelimit-remaining':'4999','x-ratelimit-reset':'1999999999'}
        });
      },
    });
    expect(authorization).toBe('');
  });

  it('revalidates with ETag/304 after the outer registry cache is bypassed', async () => {
    let calls=0;
    let conditional='';
    const fetchImpl=async (_url,init={})=>{
      calls++;
      conditional=String(init?.headers?.['if-none-match']||'');
      if(calls===1){
        return new Response(JSON.stringify({number:335,body:registryBody('100')}),{
          status:200,
          headers:{'content-type':'application/json','etag':'"registry-100"','x-ratelimit-remaining':'4999','x-ratelimit-reset':'1999999999'}
        });
      }
      return new Response(null,{
        status:304,
        headers:{'etag':'"registry-100"','x-ratelimit-remaining':'4998','x-ratelimit-reset':'1999999999'}
      });
    };
    const first=await refreshRegistryWorkforce(true,{fetchImpl,token:'abc'});
    expect(first.workforceMeta).toMatchObject({version:'100',stale:false,error:null});
    const cached=await refreshRegistryWorkforce(false,{fetchImpl,token:'abc'});
    expect(cached.workforceMeta.version).toBe('100');
    expect(calls).toBe(1);
    const revalidated=await refreshRegistryWorkforce(true,{fetchImpl,token:'abc'});
    expect(calls).toBe(2);
    expect(conditional).toBe('"registry-100"');
    expect(revalidated.workforceMeta).toMatchObject({version:'100',stale:false,error:null});
  });

  it('fails/degrades closed on a non-rate-limit 403 and preserves fallback truth', async () => {
    const result=await refreshRegistryWorkforce(true,{
      token:'abc',
      fetchImpl:async()=>new Response(JSON.stringify({message:'forbidden'}),{
        status:403,
        headers:{'content-type':'application/json','x-ratelimit-remaining':'100','x-ratelimit-reset':'1999999999'}
      }),
    });
    expect(result.workforceMeta.source).toBe('registry-335-fallback-v52');
    expect(result.workforceMeta.stale).toBe(true);
    expect(result.workforceMeta.error).toContain('GITHUB_HTTP_403');
  });

  it('never promotes a rate-limit stale cache return to current registry truth', async () => {
    let calls=0;
    const fetchImpl=async ()=>{
      calls++;
      if(calls===1){
        return new Response(JSON.stringify({number:335,body:registryBody('101')}),{
          status:200,
          headers:{'content-type':'application/json','etag':'"registry-101"','x-ratelimit-remaining':'1','x-ratelimit-reset':String(Math.floor(Date.now()/1000)+60)}
        });
      }
      return new Response(JSON.stringify({message:'API rate limit exceeded'}),{
        status:403,
        headers:{'content-type':'application/json','x-ratelimit-remaining':'0','x-ratelimit-reset':String(Math.floor(Date.now()/1000)+60)}
      });
    };
    const live=await refreshRegistryWorkforce(true,{fetchImpl,token:'abc'});
    expect(live.workforceMeta).toMatchObject({version:'101',stale:false,error:null});
    const stale=await refreshRegistryWorkforce(true,{fetchImpl,token:'abc'});
    expect(stale.workforceMeta.version).toBe('101');
    expect(stale.workforceMeta.stale).toBe(true);
    expect(stale.workforceMeta.error).toMatch(/GITHUB_HTTP_403|GITHUB_RATE_LIMIT_BACKOFF_ACTIVE/);
  });

  it('respects a caller timeout while joining an existing strict in-flight registry request', async () => {
    let release;
    const fetchImpl=async()=>new Promise(resolve=>{
      release=()=>resolve(new Response(JSON.stringify({number:335,body:registryBody('102')}),{
        status:200,
        headers:{'content-type':'application/json','x-ratelimit-remaining':'4999','x-ratelimit-reset':'1999999999'}
      }));
    });
    const first=fetchRegistryIssue({fetchImpl,token:'abc',signal:AbortSignal.timeout(1000)});
    await Promise.resolve();
    const controller=new AbortController();
    const second=fetchRegistryIssue({fetchImpl,token:'abc',signal:controller.signal});
    controller.abort(new Error('registry_caller_timeout'));
    await expect(second).rejects.toThrow('registry_caller_timeout');
    release();
    const issue=await first;
    expect(issue.body).toContain('REGISTRY_ROOT_VERSION=102');
  });

  it('recovers from stale fallback to a fresh current registry result', async () => {
    const failed=await refreshRegistryWorkforce(true,{
      token:'abc',
      fetchImpl:async()=>new Response(JSON.stringify({message:'forbidden'}),{
        status:403,
        headers:{'content-type':'application/json','x-ratelimit-remaining':'100','x-ratelimit-reset':'1999999999'}
      }),
    });
    expect(failed.workforceMeta.stale).toBe(true);

    resetGithubSharedClientForTests();
    const recovered=await refreshRegistryWorkforce(true,{
      token:'abc',
      fetchImpl:async()=>new Response(JSON.stringify({number:335,body:registryBody('103')}),{
        status:200,
        headers:{'content-type':'application/json','x-ratelimit-remaining':'4999','x-ratelimit-reset':'1999999999'}
      }),
    });
    expect(recovered.workforceMeta).toMatchObject({source:'registry-335-live',version:'103',stale:false,error:null});
  });
});
