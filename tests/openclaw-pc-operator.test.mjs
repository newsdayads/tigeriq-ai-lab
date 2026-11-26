import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  nv07UserSessionPreflightIdentity,
  NV07_CANARY_STATE_DIR,
  NV07_CANARY_SANDBOX,
  NV07_CANARY_RECEIPT,
  NV07_GATEWAY_V2_JOB,
  NV07_GATEWAY_V3_JOB,
  NV07_GATEWAY_V3_RECEIPT,
  evaluateNv07GatewayV3Envelope,
  runNv07GatewayReadMetadataV3,
  NV07_GATEWAY_V2_RECEIPT,
  evaluateNv07GatewayV2Proposal,
  runNv07GatewayReadMetadataV2,
  runNv07GatewayReadMetadataCanary,
  assertShellCommandAllowed,
  assertTigerIQTaskName,
  trustedTigerIQTaskActionData,
  parseTaskListCsv,
  parseCompactTaskListCsv,
  assertWritePathAllowed,
  resolveOperatorPath,
  androidReleaseBuildFailureClass,
  assertTigerIQLive3150DeployRequest,
  reconcileCancelledCoreUiJob,
  readCoreStatus,
  readOllamaStatus,
  readClineBenchmarkPreflight,
  readCodingIssueStatus,
  coreRestartReplacementAccepted,
  taskActionSuccessStatus,
} from '../apps/openclaw-tigeriq-runtime/operator.mjs';
import { PAD_UI_ACTIONS, assertPadUiRequest, parsePadBrokerJson } from '../apps/openclaw-tigeriq-runtime/pad-ui.mjs';
import {
  EXPECTED_BRANCH,
  EXPECTED_PROJECT_ID,
  EXPECTED_REPO,
  EXPECTED_TEAM_ID,
  classifyDeployFailure,
  validateReleaseContract,
} from '../scripts/pc-worker/vercel-tigeriq-live-3150-deploy.mjs';



describe('NV07 Windows canary filesystem path regression #4783', () => {
  it('preserves drive-root absolute paths with backslash delimiters', () => {
    expect(NV07_CANARY_STATE_DIR).toBe(String.raw`D:\TigerIQ\State\NV07`);
    expect(NV07_CANARY_SANDBOX).toBe(String.raw`D:\TigerIQ\State\NV07\proposal-sandbox`);
    expect(NV07_CANARY_RECEIPT).toBe(String.raw`D:\TigerIQ\State\NV07\gateway-read-metadata-once.json`);
    for (const pathname of [NV07_CANARY_STATE_DIR,NV07_CANARY_SANDBOX,NV07_CANARY_RECEIPT]) {
      expect(pathname).toMatch(/^D:\\TigerIQ\\State\\NV07(?:\\|$)/);
      expect(pathname).not.toContain('D:TigerIQState');
    }
  });
});
describe('NV07 V3 one-shot schema-shape-only evidence #4783',()=>{
  const payload={
    job_id:NV07_GATEWAY_V3_JOB,summary:'No implementation; read-only proposal',
    proposed_files:[],risks:['No implementation performed'],
  };
  const wrap=o=>JSON.stringify({status:'SUCCESS',error:null,usage:{total_tokens:10789},...o});
  it('keeps a separate absolute receipt, no runner on non-Windows',async()=>{
    expect(NV07_GATEWAY_V3_RECEIPT).toBe(String.raw`D:\TigerIQ\State\NV07\gateway-read-metadata-v3.json`);
    expect(NV07_GATEWAY_V3_RECEIPT).not.toBe(NV07_GATEWAY_V2_RECEIPT);
    if(process.platform!=='win32'){
      expect(await runNv07GatewayReadMetadataV3()).toMatchObject({
        accepted:false,state:'DENIED_NOT_RUN',reason:'NV07_WRONG_WINDOWS_LOGON',
      });
    }
  });
  it('verifies native structured_output and never includes model content',()=>{
    const a=evaluateNv07GatewayV3Envelope({
      exitCode:0,stderr:'',stdout:wrap({structured_output:payload}),
    });
    expect(a).toMatchObject({
      accepted:true,code:'NV07_PROPOSAL_VERIFIED',source:'structured_output',
      statusSuccess:true,proposedFileCount:0,totalTokens:10789,
      structuredShape:{jobIdMatches:true,hasFiles:true,fileCount:0,hasRisks:true},
    });
    expect(a.outputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(a)).not.toContain(payload.summary);
  });
  it('permits strictly validated JSON response fallback, not raw prose',()=>{
    expect(evaluateNv07GatewayV3Envelope({
      exitCode:0,stdout:wrap({response:JSON.stringify(payload)}),
    })).toMatchObject({accepted:true,source:'response_json'});
    const malformed=evaluateNv07GatewayV3Envelope({
      exitCode:0,stdout:wrap({response:'Not a JSON object'}),
    });
    expect(malformed.accepted).toBe(false);
    expect(malformed.source).toBe('none');
  });
  it('rejects wrong job, path escape, timeout and error status',()=>{
    const wrong={...payload,job_id:'WRONG-JOB'};
    expect(evaluateNv07GatewayV3Envelope({
      exitCode:0,stdout:wrap({structured_output:wrong}),
    })).toMatchObject({accepted:false,code:'NV07_PROPOSAL_SCHEMA_INVALID',
      structuredShape:{jobIdMatches:false}});
    const forbidden={...payload,proposed_files:[{
      path:'apps/tigeriq-core/core.mjs',change:'Not allowed',rationale:'Out of scope',
    }]};
    expect(evaluateNv07GatewayV3Envelope({
      exitCode:0,stdout:wrap({structured_output:forbidden}),
    }).code).toBe('NV07_PROPOSAL_PATH_OUT_OF_SCOPE');
    expect(evaluateNv07GatewayV3Envelope({
      exitCode:0,stdout:wrap({structured_output:payload}),timedOut:true,
    }).code).toBe('NV07_CLI_TIMEOUT');
    expect(evaluateNv07GatewayV3Envelope({
      exitCode:0,stdout:JSON.stringify({status:'ERROR',structured_output:payload}),
    }).code).toBe('NV07_CLI_STATUS_NOT_SUCCESS');
  });
});

describe('NV07 separate V2 one-shot CLI proposal verification #4783',()=>{
  const sourceSha='0da30d00a4d78c35d9f0d6f168474231f9083526';
  const proposed={
    job_id:NV07_GATEWAY_V2_JOB,summary:'Read-only, no execution',
    proposed_files:[{
      path:'docs/implementation/nv07-proposal.md',
      change:'Propose only; not executed',
      rationale:'Owned canary read-only analysis',
    }],
    risks:['No source modifications permitted'],
  };
  const wrap=structured_output=>JSON.stringify({
    status:'SUCCESS',error:null,structured_output,
    usage:{total_tokens:15952},
  });
  it('uses new absolute receipt instead of replaying failed V1 and does not run on Linux',async()=>{
    expect(NV07_GATEWAY_V2_RECEIPT).toBe(String.raw`D:\TigerIQ\State\NV07\gateway-read-metadata-v2.json`);
    expect(NV07_GATEWAY_V2_RECEIPT).not.toBe(NV07_CANARY_RECEIPT);
    if(process.platform!=='win32')
      expect(await runNv07GatewayReadMetadataV2()).toMatchObject({
        accepted:false,state:'DENIED_NOT_RUN',reason:'NV07_WRONG_WINDOWS_LOGON',
      });
  });
  it('accepts bounded path-pinned textual proposals, not only proposed_files=[]',()=>{
    const answer=evaluateNv07GatewayV2Proposal({
      exitCode:0,stdout:wrap(proposed),stderr:'',timedOut:false,
    });
    expect(answer).toMatchObject({
      accepted:true,validationCode:'NV07_PROPOSAL_VERIFIED',
      proposedFileCount:1,riskCount:1,totalTokens:15952,
    });
    expect(answer.outputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(answer)).not.toContain(proposed.summary);
    expect(sourceSha).toHaveLength(40);
  });
  it('denies out-of-scope paths, wrong job, tool timeout and status errors',()=>{
    const entries=[
      [{...proposed,proposed_files:[{...proposed.proposed_files[0],path:'apps/tigeriq-core/core.mjs'}]},'NV07_PROPOSAL_PATH_OUT_OF_SCOPE'],
      [{...proposed,job_id:'WRONG-JOB'},'NV07_PROPOSAL_SCHEMA_INVALID'],
    ];
    for(const [payload,code] of entries){
      expect(evaluateNv07GatewayV2Proposal({exitCode:0,stdout:wrap(payload)}))
        .toMatchObject({accepted:false,validationCode:code});
    }
    expect(evaluateNv07GatewayV2Proposal({
      exitCode:0,stdout:wrap(proposed),timedOut:true,
    }).validationCode).toBe('NV07_CLI_TIMEOUT');
    expect(evaluateNv07GatewayV2Proposal({
      exitCode:0,stdout:JSON.stringify({status:'FAILED',structured_output:proposed}),
    }).validationCode).toBe('NV07_CLI_STATUS_NOT_SUCCESS');
  });
});

describe('NV07 user-session OpenClaw read-only preflight', () => {
  it('requires the actual wdragons12x Windows logon, never SYSTEM', () => {
    expect(nv07UserSessionPreflightIdentity({platform:'win32',windowsUser:'wdragons12x'})).toBe(true);
    expect(nv07UserSessionPreflightIdentity({platform:'win32',windowsUser:'SYSTEM'})).toBe(false);
    expect(nv07UserSessionPreflightIdentity({platform:'linux',windowsUser:'wdragons12x'})).toBe(false);
  });
  it('denies a native CLI launch on non-Windows CI without creating any receipt', async () => {
    if (process.platform !== 'win32') {
      expect(await runNv07GatewayReadMetadataCanary()).toMatchObject({
        accepted:false,state:'DENIED_NOT_RUN',reason:'NV07_WRONG_WINDOWS_LOGON',
      });
    }
  });
  it('exposes only one named PC tool action, not generalized Antigravity shell', async () => {
    const plugin = await readFile(new URL('../apps/openclaw-tigeriq-runtime/dist/index.js',import.meta.url),'utf8');
    const operator = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs',import.meta.url),'utf8');
    expect(plugin).toContain("Type.Literal('nv07_preflight')");
    expect(plugin).toContain("Type.Literal('nv07_read_metadata_canary')");
    expect(plugin).toContain("Type.Literal('nv07_read_metadata_canary_v2')");
    expect(plugin).toContain("Type.Literal('nv07_read_metadata_canary_v3')");
    expect(operator).toContain("data = await runNv07GatewayReadMetadataCanary()");
    expect(operator).toContain("fs.open(NV07_CANARY_RECEIPT, 'wx')");
    expect(operator).toContain("'--mode', 'plan', '--disable-slash-commands'");
    expect(operator).toContain("data = await nv07UserSessionPreflight()");
    expect(operator).toContain("['models']");
    const allowlist=operator.slice(operator.indexOf('const SAFE_SHELL_PATTERNS'),operator.indexOf('function normalizeWinPath'));
    expect(allowlist).not.toContain('agy');
  });
});

describe('runtime Coding Lane loopback contract', () => {
  it('binds Coding Lane to loopback and keeps Web Control internal coding hop on loopback', async () => {
    const codingLauncher=await readFile(new URL('../scripts/tigeriq-core/run-coding-lane.ps1',import.meta.url),'utf8');
    const webLauncher=await readFile(new URL('../scripts/tigeriq-core/run-web-control-bundle.ps1',import.meta.url),'utf8');
    expect(codingLauncher).toContain("$env:TIGERIQ_CODING_HOST='127.0.0.1'");
    expect(codingLauncher).not.toContain("$env:TIGERIQ_CODING_HOST=if($tail)");
    expect(webLauncher).toContain("$env:TIGERIQ_CODING_LANE_URL='http://127.0.0.1:8797'");
    expect(webLauncher).toContain("$env:TIGERIQ_WEB_CONTROL_HOST=$hostIp");
  });
});

describe('typed Coding issue status read', () => {
  it('uses fixed Coding Lane loopback endpoint and numeric issue only', async () => {
    const calls=[];
    const fetchImpl=async(url,init={})=>{calls.push({url:String(url),method:init.method||'GET'});return {ok:true,status:200,async json(){return {objective:{id:'CODEOBJ-1',status:'active',summary:'MICRO_CONTEXT charsBefore=100 charsAfter=40'},job:{id:'CODE-1',status:'done',implementer:'NV17',reviewer:'NV11',prNumber:123,headSha:'a'.repeat(40),resultSummary:'MICRO_CONTEXT charsBefore=100 charsAfter=40'}};}}};
    const out=await readCodingIssueStatus({issueNumber:4190},{fetchImpl});
    expect(out).toMatchObject({status:'CODING_ISSUE_STATUS_READ',issueNumber:4190,objectiveId:'CODEOBJ-1',jobId:'CODE-1',implementer:'NV17',reviewer:'NV11',prNumber:123});
    expect(calls).toEqual([{url:'http://127.0.0.1:8797/api/issue-status?issue=4190',method:'GET'}]);
  });

  it('keeps bounded local JSON transport closed to arbitrary loopback ports', async () => {
    await expect(readCodingIssueStatus({issueNumber:4190},{
      fetchImpl:async(url)=>{
        expect(String(url)).toBe('http://127.0.0.1:8797/api/issue-status?issue=4190');
        return {ok:true,status:200,async json(){return {objective:{id:'CODEOBJ-1',status:'active'},job:{id:'CODE-1',status:'done'}};}};
      },
    })).resolves.toMatchObject({status:'CODING_ISSUE_STATUS_READ',issueNumber:4190});

    const source=await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs',import.meta.url),'utf8');
    expect(source).toContain("if(![8795,8797,8798].includes(Number(parsed.port)))throw new Error('TIGERIQ_CORE_UI_RECONCILE_PORT_INVALID');");
    expect(source).not.toContain('[8795,8796,8797,8798]');
  });
});

describe('typed Ollama status read', () => {
  const response=(body,status=200)=>({ok:status>=200&&status<300,status,async json(){return body;}});

  it('reads only fixed loopback Ollama endpoints and returns bounded sanitized model telemetry', async () => {
    const calls=[];
    const fetchImpl=async(url,init={})=>{
      calls.push({url:String(url),method:init.method||'GET'});
      if(String(url).endsWith('/api/version'))return response({version:'0.12.3',secret:'drop'});
      if(String(url).endsWith('/api/tags'))return response({models:[
        {name:'qwen3.5:9b',digest:'aaa',size:7000000000,details:{parameter_size:'9.2B',quantization_level:'Q4_K_M'},secret:'drop'},
        {name:'qwen3-coder:30b',digest:'bbb',size:18556700761,details:{parameter_size:'30.5B',quantization_level:'Q4_K_M'}},
      ]});
      if(String(url).endsWith('/api/ps'))return response({models:[
        {name:'qwen3-coder:30b',digest:'bbb',size:18556700761,size_vram:8100000000,context_length:4096,expires_at:'2026-10-07T10:00:00Z',secret:'drop'},
      ]});
      throw new Error('unexpected '+url);
    };
    await expect(readOllamaStatus({fetchImpl})).resolves.toEqual({
      status:'OLLAMA_STATUS_READ',
      endpoint:'http://127.0.0.1:11434',
      version:'0.12.3',
      installedModels:[
        {name:'qwen3.5:9b',digest:'aaa',size:7000000000,parameterSize:'9.2B',quantizationLevel:'Q4_K_M'},
        {name:'qwen3-coder:30b',digest:'bbb',size:18556700761,parameterSize:'30.5B',quantizationLevel:'Q4_K_M'},
      ],
      runningModels:[
        {name:'qwen3-coder:30b',digest:'bbb',size:18556700761,sizeVram:8100000000,contextLength:4096,expiresAt:'2026-10-07T10:00:00Z'},
      ],
    });
    expect(calls).toEqual([
      {url:'http://127.0.0.1:11434/api/version',method:'GET'},
      {url:'http://127.0.0.1:11434/api/tags',method:'GET'},
      {url:'http://127.0.0.1:11434/api/ps',method:'GET'},
    ]);
  });

  it('does not accept caller-selected endpoint inputs', async () => {
    const calls=[];
    const fetchImpl=async(url)=>{
      calls.push(String(url));
      if(String(url).endsWith('/api/version'))return response({version:'x'});
      return response({models:[]});
    };
    await readOllamaStatus({fetchImpl,baseUrl:'http://evil'});
    expect(calls.every(url=>url.startsWith('http://127.0.0.1:11434/'))).toBe(true);
  });
});

describe('typed Core status read', () => {
  const response=(body,status=200)=>({ok:status>=200&&status<300,status,async json(){return body;}});

  it('reads only fixed loopback Core status and returns sanitized telemetry', async () => {
    const calls=[];
    const fetchImpl=async(url,init={})=>{
      calls.push({url:String(url),method:init.method||'GET'});
      return response({
        core:{host:'127.0.0.1',port:8795,pid:123,uptimeSec:456,time:'2026-10-05T07:00:00.000Z',secret:'drop'},
        apiDoctor:{lastScanAt:'2026-10-05T07:01:00.000Z',degradedProviders:[{employeeId:'NV18'}],actions:[{employeeId:'NV18',action:'wait_repair_lifecycle'}],postRepairValidations24h:3,hidden:'drop'},
        resources:[{sensitive:'drop'}],
      });
    };
    await expect(readCoreStatus({fetchImpl})).resolves.toEqual({
      status:'CORE_STATUS_READ',
      core:{host:'127.0.0.1',port:8795,pid:123,uptimeSec:456,time:'2026-10-05T07:00:00.000Z'},
      apiDoctor:{lastScanAt:'2026-10-05T07:01:00.000Z',degradedProviders:[{employeeId:'NV18'}],actions:[{employeeId:'NV18',action:'wait_repair_lifecycle'}],postRepairValidations24h:3},
    });
    expect(calls).toEqual([{url:'http://127.0.0.1:8795/api/api-doctor-status',method:'GET'}]);
  });

  it('Core exposes a lightweight API Doctor status endpoint', async () => {
    const source=await readFile(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(source).toContain("url.pathname==='/api/api-doctor-status'");
    expect(source).toContain("apiDoctor:await apiDoctorTelemetry()");
  });
});

describe('bounded Core UI cancelled-ledger reconcile', () => {
  const response=(body,status=200)=>({
    ok:status>=200&&status<300,
    status,
    async json(){return body;},
  });

  it('rejects workers outside the Core UI review/research lane', async () => {
    await expect(reconcileCancelledCoreUiJob({workerId:'NV02'},{fetchImpl:async()=>response({})}))
      .rejects.toThrow('TIGERIQ_CORE_UI_RECONCILE_WORKER_INVALID');
  });

  it('is a safe no-op when the worker has no active local UI job', async () => {
    const calls=[];
    const fetchImpl=async(url,init={})=>{
      calls.push({url:String(url),method:init.method||'GET'});
      return response({ok:true,workerId:'NV03',active:null,latest:null});
    };
    await expect(reconcileCancelledCoreUiJob({workerId:'NV03'},{fetchImpl})).resolves.toEqual({
      status:'CORE_UI_RECONCILE_NO_ACTIVE_JOB',workerId:'NV03',clearedJobId:null,nextJobId:null
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({url:'http://127.0.0.1:8798/api/utility/workers/NV03/job/status',method:'GET'});
  });

  it('fails closed without mutating the local ledger when Core does not prove CANCELLED', async () => {
    const calls=[];
    const fetchImpl=async(url,init={})=>{
      const u=String(url),method=init.method||'GET';calls.push({url:u,method,body:init.body});
      if(u.includes(':8798/api/utility/workers/NV03/job/status'))return response({ok:true,active:{jobId:'GH-3272',source:'CORE_UI',stage:'WORKING'}});
      if(u.includes(':8795/api/ui-assignment?previousJobId=GH-3272'))return response({source:'CORE',authority:'CORE',previousJob:{jobId:'GH-3272',status:'RUNNING'}});
      throw new Error('unexpected fetch '+u);
    };
    await expect(reconcileCancelledCoreUiJob({workerId:'NV03'},{fetchImpl}))
      .rejects.toThrow('TIGERIQ_CORE_UI_RECONCILE_SOURCE_NOT_CANCELLED');
    expect(calls).toHaveLength(2);
    expect(calls.some(call=>call.method==='POST')).toBe(false);
  });

  it('blocks exactly the stale local job only after Core proves the same job CANCELLED and returns the next assignment', async () => {
    const calls=[];
    const fetchImpl=async(url,init={})=>{
      const u=String(url),method=init.method||'GET';calls.push({url:u,method,body:init.body});
      if(u.includes(':8798/api/utility/workers/NV03/job/status'))return response({ok:true,active:{jobId:'GH-3272',source:'CORE_UI',stage:'WORKING'}});
      if(u.includes(':8795/api/ui-assignment?previousJobId=GH-3272'))return response({
        source:'CORE',authority:'CORE',previousJob:{jobId:'GH-3272',status:'CANCELLED'},
        nextJob:{jobId:'GH-3352-Rabc123abc123',workerId:'NV03',status:'READY',executable:true}
      });
      if(u==='http://127.0.0.1:8798/api/utility/workers/NV03/job'&&method==='POST'){
        expect(JSON.parse(init.body)).toEqual({
          jobId:'GH-3272',stage:'BLOCKED',blocker:'SOURCE_JOB_CANCELLED',
          result:'Core UI source is terminal CANCELLED; stale local ledger released for next assignment'
        });
        return response({ok:true,job:{jobId:'GH-3272',stage:'BLOCKED'}});
      }
      if(u==='http://127.0.0.1:8795/api/ui-assignment'&&method==='GET')return response({
        source:'CORE',authority:'CORE',
        nextJobs:[{jobId:'GH-3352-Rabc123abc123',workerId:'NV03',status:'READY',executable:true}]
      });
      throw new Error('unexpected fetch '+u);
    };
    await expect(reconcileCancelledCoreUiJob({workerId:'NV03'},{fetchImpl})).resolves.toEqual({
      status:'CORE_UI_CANCELLED_LEDGER_RECONCILED',
      workerId:'NV03',clearedJobId:'GH-3272',priorStatus:'CANCELLED',localStage:'BLOCKED',
      nextJobId:'GH-3352-Rabc123abc123'
    });
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });

  it('uses bounded node:http transport when no fetch implementation is injected', async () => {
    const calls=[];
    const httpRequestImpl=(url,options,onResponse)=>{
      const u=String(url),method=options.method||'GET';
      const call={url:u,method,body:''};
      calls.push(call);
      const req={
        setTimeout(){return req;},
        on(){return req;},
        write(chunk){call.body+=String(chunk);},
        destroy(){},
        end(){
          queueMicrotask(()=>{
            let payload;
            if(u.includes(':8798/api/utility/workers/NV03/job/status'))payload={ok:true,active:{jobId:'GH-3272',source:'CORE_UI',stage:'WORKING'}};
            else if(u.includes(':8795/api/ui-assignment?previousJobId=GH-3272'))payload={source:'CORE',authority:'CORE',previousJob:{jobId:'GH-3272',status:'CANCELLED'}};
            else if(u==='http://127.0.0.1:8798/api/utility/workers/NV03/job'&&method==='POST')payload={ok:true,job:{jobId:'GH-3272',stage:'BLOCKED'}};
            else if(u==='http://127.0.0.1:8795/api/ui-assignment'&&method==='GET')payload={source:'CORE',authority:'CORE',nextJobs:[{jobId:'GH-3352-Rabc123abc123',workerId:'NV03',status:'READY',executable:true}]};
            else throw new Error('unexpected request '+u);
            const handlers={};
            const res={statusCode:200,on(event,cb){handlers[event]=cb;return this;}};
            onResponse(res);
            queueMicrotask(()=>{
              handlers.data?.(Buffer.from(JSON.stringify(payload)));
              handlers.end?.();
            });
          });
        },
      };
      return req;
    };
    await expect(reconcileCancelledCoreUiJob({workerId:'NV03'},{httpRequestImpl})).resolves.toEqual({
      status:'CORE_UI_CANCELLED_LEDGER_RECONCILED',
      workerId:'NV03',clearedJobId:'GH-3272',priorStatus:'CANCELLED',localStage:'BLOCKED',
      nextJobId:'GH-3352-Rabc123abc123'
    });
    expect(calls).toHaveLength(4);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
    expect(JSON.parse(calls.find(call=>call.method==='POST').body)).toMatchObject({
      jobId:'GH-3272',stage:'BLOCKED',blocker:'SOURCE_JOB_CANCELLED'
    });
  });

  it('returns a bounded machine-safe transport error for injected fetch failures', async () => {
    const fetchImpl=async()=>{
      const error=new Error('sensitive raw transport detail');
      error.code='ECONNRESET';
      throw error;
    };
    await expect(reconcileCancelledCoreUiJob({workerId:'NV03'},{fetchImpl}))
      .rejects.toThrow('TIGERIQ_CORE_UI_RECONCILE_TRANSPORT_ECONNRESET');
  });

});

describe('OpenClaw PC01 guarded local operator', () => {
  it('allows TigerIQ/OpenClaw work roots', () => {
    expect(resolveOperatorPath('D:\\TigerIQ\\Evidence\\x.json')).toBe('D:\\TigerIQ\\Evidence\\x.json');
    expect(resolveOperatorPath('D:\\OpenClaw\\npm-global')).toBe('D:\\OpenClaw\\npm-global');
    expect(resolveOperatorPath('D:\\TigerIQ-OpenClaw\\state')).toBe('D:\\TigerIQ-OpenClaw\\state');
  });

  it('blocks paths outside operator roots and sensitive stores', () => {
    expect(() => resolveOperatorPath('C:\\Windows\\System32')).toThrow('TIGERIQ_PC_PATH_NOT_ALLOWED');
    expect(() => resolveOperatorPath('D:\\TigerIQ\\Secrets\\x.txt')).toThrow('TIGERIQ_PC_SENSITIVE_PATH_BLOCKED');
  });

  it('blocks direct source/runtime-source writes while allowing state/evidence writes', () => {
    expect(() => assertWritePathAllowed('D:\\TigerIQ\\Workspace\\tigeriq-ai-lab\\x.txt')).toThrow('TIGERIQ_PC_WRITE_PATH_NOT_ALLOWED');
    expect(() => assertWritePathAllowed('D:\\TigerIQ\\Runtime\\CoreSource\\x.txt')).toThrow('TIGERIQ_PC_WRITE_PATH_NOT_ALLOWED');
    expect(() => assertWritePathAllowed('D:\\OpenClaw\\npm-global\\openclaw.cmd')).toThrow('TIGERIQ_PC_WRITE_PATH_NOT_ALLOWED');
    expect(() => assertWritePathAllowed('D:\\TigerIQ\\State\\x.json')).not.toThrow();
    expect(() => assertWritePathAllowed('D:\\TigerIQ\\Evidence\\x.json')).not.toThrow();
  });

  it('allows only a narrow diagnostic shell command set', () => {
    expect(assertShellCommandAllowed('git status')).toBe('git status');
    expect(assertShellCommandAllowed('ollama ps')).toBe('ollama ps');
    expect(assertShellCommandAllowed('openclaw plugins inspect tigeriq-runtime --json')).toContain('tigeriq-runtime');
    for (const command of [
      'Get-Process | Select-Object -First 5',
      'Get-ChildItem C:\\',
      'echo $env:GH_TOKEN',
      'cmd /c whoami',
      'shutdown /s /t 0',
      'Remove-Item D:\\TigerIQ\\Workspace -Recurse -Force',
      'git push origin main',
      'vercel deploy --prod',
      'gh pr merge 123',
      'type D:\\TigerIQ\\Secrets\\github-command-center.token',
    ]) {
      expect(() => assertShellCommandAllowed(command)).toThrow('TIGERIQ_PC_COMMAND_NOT_ALLOWLISTED');
    }
  });

  it('limits scheduled-task actions to TigerIQ task names', () => {
    expect(assertTigerIQTaskName('TigerIQ OpenClaw Gateway')).toBe('TigerIQ OpenClaw Gateway');
    expect(() => assertTigerIQTaskName('Microsoft\\Windows\\Defrag\\ScheduledDefrag')).toThrow('TIGERIQ_PC_TASK_NOT_ALLOWED');
  });

  it('publishes deterministic success status for trusted scheduled-task actions', () => {
    expect(taskActionSuccessStatus('task_start')).toBe('TASK_START_VERIFIED');
    expect(taskActionSuccessStatus('task_stop')).toBe('TASK_STOP_VERIFIED');
    expect(taskActionSuccessStatus('task_restart')).toBe('TASK_RESTART_VERIFIED');
    expect(() => taskActionSuccessStatus('task_status')).toThrow('TIGERIQ_PC_TASK_STATUS_ACTION_NOT_ALLOWED');
  });

  it('trusts task-action data only with literal subprocess success and verified post-action state', () => {
    const taskName='TigerIQ Web Control 24x7';
    const ok={exitCode:0,timedOut:false,stdout:'',stderr:'',cwd:'D:\\TigerIQ'};
    const running={taskName,state:'Running',lastRun:'10/2/2026 6:00:00 AM',lastResult:'0',previousLastRun:'10/2/2026 5:55:00 AM'};
    const ready={taskName,state:'Ready',lastRun:'10/2/2026 6:00:00 AM',lastResult:'0',previousLastRun:'10/2/2026 5:55:00 AM'};
    expect(trustedTigerIQTaskActionData('task_start',{taskName,...ok,verification:running})).toBe(true);
    expect(trustedTigerIQTaskActionData('task_start',{taskName,...ok,verification:ready})).toBe(true);
    expect(trustedTigerIQTaskActionData('task_stop',{taskName,...ok,verification:ready})).toBe(true);
    expect(trustedTigerIQTaskActionData('task_restart',{taskName,stopped:ok,started:ok,verification:running})).toBe(true);
    expect(trustedTigerIQTaskActionData('task_restart',{taskName,stopped:{...ok,exitCode:1},started:ok,verification:running})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_restart',{taskName,stopped:ok,started:{...ok,timedOut:true},verification:running})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_start',{taskName,exitCode:null,timedOut:false,verification:running})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_start',{taskName,exitCode:false,timedOut:false,verification:running})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_start',{taskName,exitCode:0,verification:running})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_start',{taskName,...ok,verification:{...ready,previousLastRun:ready.lastRun}})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_start',{taskName,...ok})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_start',{taskName:'Not TigerIQ',...ok,verification:running})).toBe(false);
  });

  it('requires verified Core PID replacement for trusted Core task_restart evidence', () => {
    const taskName='TigerIQ Core 24x7';
    const ok={exitCode:0,timedOut:false,stdout:'',stderr:'',cwd:'D:\\TigerIQ'};
    const running={taskName,state:'Running',lastRun:'10/2/2026 6:00:00 AM',lastResult:'0',previousLastRun:'10/2/2026 5:55:00 AM'};
    const coreProcess={previousPid:4100,newPid:4200,oldPidAlive:false,oldPidGone:true,healthOk:true,replaced:true};
    expect(trustedTigerIQTaskActionData('task_restart',{taskName,stopped:ok,started:ok,verification:running,coreProcess})).toBe(true);
    expect(trustedTigerIQTaskActionData('task_restart',{taskName,stopped:ok,started:ok,verification:running,coreProcess:{...coreProcess,newPid:4100,replaced:false}})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_restart',{taskName,stopped:ok,started:ok,verification:running,coreProcess:{...coreProcess,oldPidAlive:true,replaced:false}})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_restart',{taskName,stopped:ok,started:ok,verification:running})).toBe(false);
  });

  it('evaluates Core restart PID/health acceptance without race-prone process sweeping', () => {
    expect(coreRestartReplacementAccepted({previousPid:4100,newPid:4200,oldPidAlive:false,healthOk:true})).toBe(true);
    expect(coreRestartReplacementAccepted({previousPid:null,newPid:4200,oldPidAlive:false,healthOk:true})).toBe(true);
    expect(coreRestartReplacementAccepted({previousPid:4100,newPid:4100,oldPidAlive:false,healthOk:true})).toBe(false);
    expect(coreRestartReplacementAccepted({previousPid:4100,newPid:4200,oldPidAlive:true,healthOk:true})).toBe(false);
    expect(coreRestartReplacementAccepted({previousPid:4100,newPid:4200,oldPidAlive:false,healthOk:false})).toBe(false);
    expect(coreRestartReplacementAccepted({previousPid:4100,newPid:null,oldPidAlive:false,healthOk:true})).toBe(false);
  });

  it('parses task_list CSV into a bounded TigerIQ-only inventory', () => {
    const csv = [
      String.raw`"PC01","\\TigerIQ Core 24x7","10/1/2026 12:00:00 AM","Ready","Interactive/Background","9/30/2026 5:00:00 PM","0","SYSTEM","node D:\\TigerIQ\\Runtime\\core.mjs","N/A","","Enabled","","","SYSTEM","","","Every 5 minutes","Minute","5:00:00 PM","9/30/2026"`,
      String.raw`"PC01","\\Microsoft\\Windows\\Defrag\\ScheduledDefrag","N/A","Ready","Background","N/A","0","SYSTEM","defrag.exe","","","Enabled","","","SYSTEM","","","Weekly","Weekly","3:00:00 AM","9/30/2026"`,
      String.raw`"PC01","\\TigerIQ Quote Test","N/A","Disabled","Background","N/A","1","SYSTEM","cmd /c echo ""hello,world""","","","Disabled","","","SYSTEM","","","At startup","At system startup","",""`,
    ].join('\r\n');

    expect(parseTaskListCsv(csv)).toEqual([
      {
        taskName: 'TigerIQ Core 24x7',
        state: 'Ready',
        lastRun: '9/30/2026 5:00:00 PM',
        lastResult: '0',
        action: 'node D:\\TigerIQ\\Runtime\\core.mjs',
        trigger: 'Every 5 minutes | Minute | 5:00:00 PM | 9/30/2026',
      },
      {
        taskName: 'TigerIQ Quote Test',
        state: 'Disabled',
        lastRun: 'N/A',
        lastResult: '1',
        action: 'cmd /c echo "hello,world"',
        trigger: 'At startup | At system startup',
      },
    ]);
  });

  it('parses compact task_list CSV into TigerIQ task names only', () => {
    const csv = [
      String.raw`"\\TigerIQ Core 24x7","10/3/2026 2:00:00 PM","Ready"`,
      String.raw`"\\Microsoft\\Windows\\Defrag\\ScheduledDefrag","10/4/2026 3:00:00 AM","Ready"`,
      String.raw`"\\TigerIQ OpenClaw Gateway","N/A","Running"`,
    ].join('\r\n');

    expect(parseCompactTaskListCsv(csv)).toEqual([
      { taskName: 'TigerIQ Core 24x7' },
      { taskName: 'TigerIQ OpenClaw Gateway' },
    ]);
  });

  it('surfaces only allowlisted Android release failure classes', () => {
    expect(androidReleaseBuildFailureClass({ stderr: 'Exception: APKSIGNER_MISSING: Android SDK build-tools are required' })).toBe('APKSIGNER_MISSING');
    expect(androidReleaseBuildFailureClass({ stdout: 'ANDROID_RELEASE_BUILD_FAILED' })).toBe('ANDROID_RELEASE_BUILD_FAILED');
    expect(androidReleaseBuildFailureClass({ stderr: 'GRADLE_COMMAND_MISSING: no existing Gradle runtime' })).toBe('GRADLE_COMMAND_MISSING');
    expect(androidReleaseBuildFailureClass({ stderr: 'DPAPI_SIGNER_RECEIPT_INVALID' })).toBe('DPAPI_SIGNER_RECEIPT_INVALID');
    expect(androidReleaseBuildFailureClass({ stderr: 'V020_USER_CONTEXT_ARTIFACT_READ_DENIED' })).toBe('V020_USER_CONTEXT_ARTIFACT_READ_DENIED');
    expect(androidReleaseBuildFailureClass({ stderr: 'V020_USER_CONTEXT_SIGNING_BUNDLE_READ_DENIED' })).toBe('V020_USER_CONTEXT_SIGNING_BUNDLE_READ_DENIED');
    expect(androidReleaseBuildFailureClass({ stderr: 'V020_USER_CONTEXT_RELEASE_WRITE_DENIED' })).toBe('V020_USER_CONTEXT_RELEASE_WRITE_DENIED');
    expect(androidReleaseBuildFailureClass({ stderr: 'V020_USER_CONTEXT_WRAPPER_UNCLASSIFIED' })).toBe('V020_USER_CONTEXT_WRAPPER_UNCLASSIFIED');
    expect(androidReleaseBuildFailureClass({ stderr: 'password=secret unknown failure' })).toBe('UNCLASSIFIED');
  });

  it('keeps Gate C v0.20 verification as two fixed Core-local typed actions with no caller-selected target', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    expect(source).toContain("action === 'android_worker_gate_c_v020_enqueue_10'");
    expect(source).toContain("action === 'android_worker_gate_c_v020_status'");
    expect(source).toContain("'/api/mobile/gate-c/v020/enqueue'");
    expect(source).toContain("'/api/mobile/gate-c/v020/status'");
    expect(source).toContain("action === 'android_worker_gate_c_v021_enqueue_10'");
    expect(source).toContain("action === 'android_worker_gate_c_v021_status'");
    expect(source).toContain("'/api/mobile/gate-c/v021/enqueue'");
    expect(source).toContain("'/api/mobile/gate-c/v021/status'");
    const coreSource = await readFile(new URL('../apps/tigeriq-core/core.mjs', import.meta.url), 'utf8');
    expect(source).toContain('TIGERIQ_CORE_TOKEN');
    expect(source).toContain('http://127.0.0.1:${port}${path}');
    expect(source).not.toContain('input?.host');
    expect(source).not.toContain('input?.employeeId');
    expect(coreSource).toContain("createServer(server.listeners('request')[0])");
    expect(coreSource).toContain("loopbackServer.listen(PORT,'127.0.0.1',resolve)");
    expect(coreSource).toContain("loopbackServer?.close()");
    expect(source).not.toContain('input?.prompt');
  });

  it('maps only allowlisted Gate C v0.20 blockers to fixed public statuses', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    expect(source).toContain("gate_c_v020_device_unavailable:'GATE_C_V020_DEVICE_UNAVAILABLE'");
    expect(source).toContain("gate_c_v020_device_ambiguous:'GATE_C_V020_DEVICE_AMBIGUOUS'");
    expect(source).toContain("gate_c_v020_device_stale:'GATE_C_V020_DEVICE_STALE'");
    expect(source).not.toContain("status:'GATE_C_V020_BLOCKED'");
    expect(source).not.toContain("return {status:blockedStatus,reason");
    expect(source).toContain("TIGERIQ_GATE_C_V020_REQUEST_FAILED");
    expect(source).toContain("gate_c_v021_device_unavailable:'GATE_C_V021_DEVICE_UNAVAILABLE'");
    expect(source).toContain("gate_c_v021_device_ambiguous:'GATE_C_V021_DEVICE_AMBIGUOUS'");
    expect(source).toContain("gate_c_v021_device_stale:'GATE_C_V021_DEVICE_STALE'");
    expect(source).toContain("TIGERIQ_GATE_C_V021_REQUEST_FAILED");
  });

  it('keeps Android stable release build as one fixed typed local action', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    expect(source).toContain("action === 'android_worker_release_build'");
    expect(source).toContain("scripts\\\\pc-worker\\\\build-android-worker-release.ps1");
    expect(source).toContain("D:\\\\TigerIQ\\\\Runtime\\\\CoreSource");
    expect(source).toContain("D:\\\\TigerIQ\\\\State\\\\core-runtime-updater.json");
    expect(source).toContain("D:\\\\TigerIQ\\\\Secrets\\\\AndroidSigning");
    expect(source).toContain("ANDROID_WORKER_STABLE_RELEASE_READY");
    expect(source).toContain("63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293");
    expect(source).toContain("TIGERIQ_ANDROID_RELEASE_SIGNER_MISMATCH");
    expect(source).toContain("TIGERIQ_ANDROID_RELEASE_SOURCE_SHA_MISMATCH");
    expect(source).toContain("extraEnvKeys: ['USERPROFILE','GRADLE_HOME']");
    expect(source).not.toContain("input?.script");
    expect(source).not.toContain("input?.secretsDir");
    expect(source).not.toContain("D:\\\\TigerIQ\\\\Workspace\\\\tigeriq-ai-lab");
  });

  it('keeps v0.20 CI artifact signing scoped to the reviewed artifact', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    expect(source).toContain("action === 'android_worker_sign_v020_ci_artifact'");
    expect(source).toContain("runId: '37119358164'");
    expect(source).toContain("artifactId: '11273046069'");
    expect(source).toContain("artifactName: 'tigeriq-worker-unsigned-release-apk'");
    expect(source).toContain("sourceHead: '8364e79ef5a03d5d95663e511c076f5be4f5003a'");
    expect(source).toContain("expectedUnsignedSha256: 'BDC32789297BB5304AE423476D8C4170C9D17C0B9AC2D7C5533DA42FBA82F598'");
    expect(source).toContain("expectedApkSignerJarSha256: '00EF9948F843FE395D2440AE3EF41405B8040A6D5D46493BD1902AC0EE6DEAE7'");
    expect(source).toContain("expectedVersion: '0.20.0-update-lease-guard'");
    expect(source).toContain("process.env.TIGERIQ_GITHUB_TOKEN || process.env.GITHUB_TOKEN");
    expect(source).toContain("actions/artifacts/${spec.artifactId}/zip");
    expect(source).toContain("'x-github-api-version': '2022-11-28'");
    expect(source).toContain("redirect: 'follow'");
    expect(source).toContain("[\'504b0304\',\'504b0506\',\'504b0708\']");
    expect(source).toContain("param([string]$zip,[string]$dest) Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force");
    expect(source).toContain("scripts\\\\pc-worker\\\\sign-v020-reviewed-artifact.ps1");
    expect(source).toContain("win.join(downloadDir, 'apksigner.jar')");
    expect(source).toContain("executePadV020Signer()");
    expect(source).toContain("TIGERIQ_V020_USER_SESSION_BROKER_UNAVAILABLE");
    expect(source).toContain("receipt.passwordTransport !== 'stdin-only'");
    expect(source).toContain("receipt.apksignerMode !== 'portable-pinned-jar'");
    expect(source).toContain("receipt.prealignedInput !== true");
    expect(source).toContain("TIGERIQ_ANDROID_RELEASE_SOURCE_ARTIFACT_MISMATCH");
    expect(source).not.toContain("extraEnvKeys: ['JAVA_HOME', 'TIGERIQ_JAVA']");
    expect(source).not.toContain("extraEnvKeys: ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'ANDROID_SDK_ROOT', 'ANDROID_HOME']");
    expect(source).not.toContain("gh auth login");
    expect(source).not.toContain("'gh.exe'");
  });


  it('keeps v0.21 CI artifact signing pinned to reviewed artifact and canonical user-context signer', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    const wrapper = await readFile(new URL('../scripts/pc-worker/sign-v021-reviewed-artifact.ps1', import.meta.url), 'utf8');
    const runner = await readFile(new URL('../scripts/pc-worker/invoke-v021-user-context-signer.ps1', import.meta.url), 'utf8');
    const bridge = await readFile(new URL('../scripts/pc-worker/run-v021-user-context-signer-task.ps1', import.meta.url), 'utf8');

    expect(source).toContain("action === 'android_worker_sign_v021_ci_artifact'");
    expect(source).toContain("runId: '37167530454'");
    expect(source).toContain("artifactId: '11290356482'");
    expect(source).toContain("sourceArtifactHead: '1f80bc5c86a855b7a88f13e6d6e89d8035437f4c'");
    expect(source).toContain("sourceArtifactAndroidTreeSha: '34334f3707240974ca78bad14f85935a5205f267'");
    expect(source).toContain("expectedUnsignedSha256: 'B43A938A9EDC35C20652E516BF1E476D005F8D0A42655F2BB6C55643FE65BC3F'");
    expect(source).toContain("expectedApkSignerJarSha256: '00EF9948F843FE395D2440AE3EF41405B8040A6D5D46493BD1902AC0EE6DEAE7'");
    expect(source).toContain("expectedVersion: '0.21.0-packageinstaller-stream-fix'");
    expect(source).toContain("run-v021-user-context-signer-task.ps1");
    expect(source).toContain("expectedTask = 'TigerIQ Android v0.21 OneShot Signer'");
    expect(source).toContain("TIGERIQ_ANDROID_V021_SOURCE_SHA_MISMATCH");
    expect(source).toContain("TIGERIQ_ANDROID_V021_SOURCE_ARTIFACT_MISMATCH");
    expect(source).not.toContain("input?.artifactId");
    expect(source).not.toContain("input?.sourceArtifactSha");
    expect(source).not.toContain("input?.signerUser");

    expect(wrapper).toContain("$SourceArtifactSha='1f80bc5c86a855b7a88f13e6d6e89d8035437f4c'");
    expect(wrapper).toContain("$SourceArtifactAndroidTreeSha='34334f3707240974ca78bad14f85935a5205f267'");
    expect(wrapper).toContain("rev-parse 'HEAD:apps/android-worker'");
    expect(wrapper).toContain("if($CurrentAndroidTreeSha-ne$SourceArtifactAndroidTreeSha){throw 'V021_ANDROID_SOURCE_DRIFT'}");
    expect(wrapper).toContain("sourceArtifactSha=$SourceArtifactSha");
    expect(wrapper).toContain("sourceSha=$ReleaseSourceSha");
    expect(wrapper).toContain("secretsIncluded=$false");

    expect(runner).toContain("$ExpectedUser='pc01\\wdragons12x'");
    expect(runner).toContain("$TaskName='TigerIQ Android v0.21 OneShot Signer'");
    expect(runner).toContain("sign-v021-reviewed-artifact.ps1");
    expect(runner).toContain("V021_USER_CONTEXT_SIGNING_BUNDLE_READ_DENIED");
    expect(runner).not.toMatch(/ConvertFrom-SecureString|SecureStringToBSTR|PtrToString|Clipboard|Set-Clipboard/i);

    expect(bridge).toContain("$TaskName='TigerIQ Android v0.21 OneShot Signer'");
    expect(bridge).toContain("$ExpectedUser='pc01\\wdragons12x'");
    expect(bridge).toContain('New-ScheduledTaskPrincipal -UserId $ExpectedUser -LogonType Interactive -RunLevel Highest');
    expect(bridge).toContain("Unregister-ScheduledTask -TaskName $TaskName");
    expect(bridge).toContain("taskDeleted=$true");
    expect(bridge).not.toMatch(/-Password\\b|\\/RP\\b|LogonType\\s+Password/i);
  });

  it('keeps current CI artifact signing metadata-pinned and fixed-purpose', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    const metadata = JSON.parse(await readFile(new URL('../apps/android-worker/release/current-ci-artifact.json', import.meta.url), 'utf8'));
    const wrapper = await readFile(new URL('../scripts/pc-worker/sign-current-reviewed-artifact.ps1', import.meta.url), 'utf8');
    const runner = await readFile(new URL('../scripts/pc-worker/invoke-current-user-context-signer.ps1', import.meta.url), 'utf8');
    const bridge = await readFile(new URL('../scripts/pc-worker/run-current-user-context-signer-task.ps1', import.meta.url), 'utf8');

    expect(metadata).toMatchObject({
      schema:'tigeriq.android-worker.ci-artifact.v1',
      versionCode:22,
      versionName:'0.22.0-live-worker',
      workflowRunId:'37184369356',
      artifactId:'11296700882',
      sourceArtifactHead:'8932ef56f6542ca2ccea8a178e13dc748236d61e',
      sourceArtifactAndroidTreeSha:'db3eeca87dc3078439887e11116cc18c5f3429fc',
      sourceArtifactAppTreeSha:'2d37fed9aeb7a6ea8d0d62ddde1131755e7be654',
      unsignedApkSha256:'43BA8ACEF39CF3F0AE6A791999DB9949A016698043E5D010F1BCB46D7C1EC640',
      signerSha256:'63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293',
    });
    expect(source).toContain("action === 'android_worker_sign_current_ci_artifact'");
    expect(source).toContain("apps','android-worker','release','current-ci-artifact.json");
    expect(source).toContain('actions/artifacts/${spec.artifactId}');
    expect(source).toContain('workflow_run?.head_sha');
    expect(source).toContain('TIGERIQ_ANDROID_CURRENT_CI_ARTIFACT_METADATA_MISMATCH');
    expect(source).toContain('HEAD:apps/android-worker/app');
    expect(source).toContain("merge-base','--is-ancestor',spec.sourceArtifactHead,current.installedSha");
    expect(source).not.toContain('input?.artifactId');
    expect(source).not.toContain('input?.sourceArtifactHead');
    expect(source).not.toContain('input?.signerSha256');

    expect(wrapper).toContain('current-ci-artifact.json');
    expect(wrapper).toContain("HEAD:apps/android-worker/app");
    expect(wrapper).toContain('CURRENT_CI_ANDROID_SOURCE_DRIFT');
    expect(wrapper).toContain('sourceArtifactAppTreeSha=$SourceArtifactAppTreeSha');
    expect(wrapper).toContain('sourceArtifactSha=$SourceArtifactSha');
    expect(wrapper).toContain('sourceSha=$ReleaseSourceSha');
    expect(wrapper).toContain('secretsIncluded=$false');
    expect(runner).toContain("$ExpectedUser='pc01\\wdragons12x'");
    expect(runner).toContain("$TaskName='TigerIQ Android Current CI OneShot Signer'");
    expect(runner).not.toMatch(/ConvertFrom-SecureString|SecureStringToBSTR|PtrToString|Clipboard|Set-Clipboard/i);
    expect(bridge).toContain('New-ScheduledTaskPrincipal -UserId $ExpectedUser -LogonType Interactive -RunLevel Highest');
    expect(bridge).toContain('taskDeleted=$true');
    expect(bridge).not.toMatch(/-Password\\b|\\/RP\\b|LogonType\\s+Password/i);
  });
  it('publishes the v0.20 Core release manifest only from the pinned signed APK', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    expect(source).toContain("action === 'android_worker_publish_v020_manifest'");
    expect(source).toContain("manifestPath: 'D:\\\\TigerIQ\\\\Runtime\\\\MobileWorker\\\\release.json'");
    expect(source).toContain("apkBytes: 62002");
    expect(source).toContain("F2A8F279033EC832764370A50A34B51B8D29586AF6D9AE7B8957EA81E563A04D");
    expect(source).toContain("versionCode: 20");
    expect(source).toContain("versionName: '0.20.0-update-lease-guard'");
    expect(source).toContain("1qnz93uptTfj3tpJYLU7AN5P1KCu4Z_3a");
    expect(source).toContain("TIGERIQ_ANDROID_V020_MANIFEST_APK_SHA256_MISMATCH");
    expect(source).toContain("await fs.rename(tempPath, spec.manifestPath)");
    expect(source).toContain("TIGERIQ_ANDROID_V020_MANIFEST_READBACK_MISMATCH");
    expect(source).not.toContain("input?.manifestPath");
    expect(source).not.toContain("input?.driveUrl");
  });

  it('keeps v0.20 user-context signing fixed, evidence-justified elevated, and non-generic', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    const runner = await readFile(new URL('../scripts/pc-worker/invoke-v020-user-context-signer.ps1', import.meta.url), 'utf8');
    const bridge = await readFile(new URL('../scripts/pc-worker/run-v020-user-context-signer-task.ps1', import.meta.url), 'utf8');
    expect(source).toContain("action === 'android_worker_sign_v020_user_context'");
    expect(source).toContain("run-v020-user-context-signer-task.ps1");
    expect(source).toContain("expectedUser = 'pc01\\\\wdragons12x'");
    expect(source).toContain("expectedTask = 'TigerIQ Android v0.20 OneShot Signer'");
    expect(source).toContain("taskLogonType || '') !== 'InteractiveToken'");
    expect(source).toContain("taskRunLevel || '') !== 'Highest'");
    expect(source).not.toContain("input?.userContext");
    expect(source).not.toContain("input?.signerUser");

    expect(runner).toContain("$ExpectedUser='pc01\\wdragons12x'");
    expect(runner).toContain("$Wrapper='D:\\TigerIQ\\Runtime\\CoreSource\\scripts\\pc-worker\\sign-v020-reviewed-artifact.ps1'");
    expect(runner).toContain('[Security.Principal.WindowsIdentity]::GetCurrent().Name');
    expect(runner).toContain("if($identity -ine $ExpectedUser){throw 'V020_USER_CONTEXT_IDENTITY_MISMATCH'}");
    expect(runner).toContain("passwordTransport=[string]$receipt.passwordTransport");
    expect(runner).toContain("secretsPrinted=[bool]$receipt.secretsPrinted");
    expect(runner).toContain("V020_USER_CONTEXT_ARTIFACT_READ_DENIED");
    expect(runner).toContain("V020_USER_CONTEXT_SIGNING_BUNDLE_READ_DENIED");
    expect(runner).toContain("V020_USER_CONTEXT_RELEASE_WRITE_DENIED");
    expect(runner).toContain("V020_USER_CONTEXT_WRAPPER_UNCLASSIFIED");
    expect(runner).toContain("Test-ReleaseWritable");
    expect(runner).toContain("Test-FileReadable");
    expect(bridge).toContain("V020_USER_CONTEXT_RELEASE_WRITE_DENIED");
    for (const code of [
      'STABLE_SIGNING_DIR_REQUIRED',
      'CANONICAL_SIGNING_IDENTITY_RECOVERY_REQUIRED',
      'APKSIGNER_JAR_SHA256_REQUIRED',
      'JAVA_RUNTIME_REQUIRED',
      'APK_CERTIFICATE_FINGERPRINT_NOT_FOUND',
      'APK_V2_SIGNATURE_REQUIRED',
      'APK_V3_SIGNATURE_REQUIRED',
    ]) {
      expect(runner).toContain(`'${code}'`);
      expect(bridge).toContain(`'${code}'`);
    }
    expect(runner).not.toMatch(/ConvertFrom-SecureString|SecureStringToBSTR|PtrToString|Clipboard|Set-Clipboard/i);

    expect(bridge).toContain("$TaskName='TigerIQ Android v0.20 OneShot Signer'");
    expect(bridge).toContain("$ExpectedUser='pc01\\wdragons12x'");
    expect(bridge).toContain('New-ScheduledTaskPrincipal -UserId $ExpectedUser -LogonType Interactive -RunLevel Highest');
    expect(bridge).toContain('Resolve-AccountSid');
    expect(bridge).toContain("return @('Interactive','InteractiveToken','3') -contains $value");
    expect(bridge).toContain("return @('Highest','HighestAvailable','1') -contains $value");
    expect(bridge).toContain('V020_USER_CONTEXT_TASK_USER_MISMATCH');
    expect(bridge).toContain('V020_USER_CONTEXT_TASK_LOGON_MISMATCH');
    expect(bridge).toContain('V020_USER_CONTEXT_TASK_RUNLEVEL_MISMATCH');
    expect(bridge).toContain("V020_USER_CONTEXT_UNAVAILABLE");
    expect(bridge).toContain("V020_USER_CONTEXT_TASK_COLLISION");
    expect(bridge).toContain("Unregister-ScheduledTask -TaskName $TaskName");
    expect(bridge).toContain("taskDeleted=$true");
    expect(runner).toContain("taskRunLevel='Highest'");
    expect(source).toContain("taskRunLevel: 'Highest'");
    expect(bridge).not.toMatch(/-Password\\b|\\/RP\\b|LogonType\\s+Password/i);
  });

  it('keeps v0.20 signer ACL bootstrap fixed to read-only access on exactly three canonical files', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    const aclScript = await readFile(new URL('../scripts/pc-worker/grant-v020-signer-read-acl.ps1', import.meta.url), 'utf8');
    expect(source).toContain("action === 'android_worker_grant_v020_signer_read_acl'");
    expect(source).toContain("grant-v020-signer-read-acl.ps1");
    expect(source).toContain("ANDROID_V020_SIGNER_ACL_READY");
    expect(source).toContain("String(receipt.account || '').toLowerCase() !== 'pc01\\\\wdragons12x'");
    expect(source).toContain("signerAclBootstrap: action === 'android_worker_grant_v020_signer_read_acl'");
    expect(aclScript).toContain("$ExpectedUser='pc01\\wdragons12x'");
    expect(aclScript).toContain("'tigeriq-release.jks'");
    expect(aclScript).toContain("'signing-password.dpapi.txt'");
    expect(aclScript).toContain("'key-alias.txt'");
    expect(aclScript).toContain("[Security.AccessControl.FileSystemRights]::Read");
    expect(aclScript).toContain("inheritance='None'");
    expect(aclScript).not.toMatch(/Write|Modify|FullControl/);
    expect(aclScript).not.toMatch(/Get-Content|ReadAllText|ConvertTo-SecureString|SecureStringToBSTR/);
  });

  it('keeps v0.20 signed APK export fixed, hash-pinned, and chunk-bounded', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    expect(source).toContain("action === 'android_worker_export_v020_signed_apk_chunk'");
    expect(source).toContain("TIQ Worker v0.20.apk");
    expect(source).toContain("F2A8F279033EC832764370A50A34B51B8D29586AF6D9AE7B8957EA81E563A04D");
    expect(source).toContain("chunkBytes: 3000");
    expect(source).toContain("chunkIndex > 31");
    expect(source).toContain("ANDROID_V020_EXPORT_APK_SHA256_MISMATCH");
    expect(source).toContain("chunk.toString('base64')");
    expect(source).not.toContain("exportAndroidWorkerV020SignedApkChunk(input?.path");
  });

  it('keeps v0.21 signed APK export pinned while allowing later tooling-only runtime commits', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    expect(source).toContain("action === 'android_worker_export_v021_signed_apk_chunk'");
    expect(source).toContain("versionName: '0.21.0-packageinstaller-stream-fix'");
    expect(source).toContain("sourceArtifactSha: '1f80bc5c86a855b7a88f13e6d6e89d8035437f4c'");
    expect(source).toContain("sourceArtifactAndroidTreeSha: '34334f3707240974ca78bad14f85935a5205f267'");
    expect(source).toContain("apkSha256: '1E27C82C9A8AC4ED09ADA80D3CEFBEF93303F90B0FE8F5B84337D5838CADDEF8'");
    expect(source).toContain("['rev-parse','HEAD']");
    expect(source).toContain("['rev-parse','HEAD:apps/android-worker']");
    expect(source).toContain("['-C',spec.repoRoot,'merge-base','--is-ancestor',sourceSha,installedSha]");
    expect(source).toContain('runtimeHead!==installedSha');
    expect(source).toContain('currentAndroidTree!==spec.sourceArtifactAndroidTreeSha');
    expect(source).toContain('TIGERIQ_ANDROID_V021_RUNTIME_SOURCE_SHA_MISMATCH');
    expect(source).toContain('TIGERIQ_ANDROID_V021_ANDROID_SOURCE_DRIFT');
    expect(source).toContain('TIGERIQ_ANDROID_V021_SOURCE_ARTIFACT_MISMATCH');
    expect(source).toContain('TIGERIQ_ANDROID_V021_SOURCE_ANCESTRY_MISMATCH');
    expect(source).toContain('TIGERIQ_ANDROID_V021_RELEASE_RECEIPT_MISMATCH');
    expect(source).toContain("JSON.parse(receiptRaw.replace(/^\\uFEFF/,''))");
    expect(source).toContain("JSON.parse(stateRaw.replace(/^\\uFEFF/,''))");
    expect(source).toContain('TIGERIQ_ANDROID_V021_APK_SHA256_MISMATCH');
    expect(source).toContain('chunkIndex>31');
    expect(source).not.toContain('sourceSha!==installedSha');
    expect(source).not.toContain('exportAndroidWorkerV021SignedApkChunk(input?.path');
  });

  it('exports and publishes the current Android release from dynamic version metadata with fail-closed provenance', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    expect(source).toContain("action === 'android_worker_export_current_signed_apk_chunk'");
    expect(source).toContain("action === 'android_worker_publish_current_manifest'");
    expect(source).toContain("versionCode\\s*=\\s*(\\d+)");
    expect(source).toContain("versionName\\s*=\\s*\"([^\"]+)\"");
    expect(source).toContain("TIGERIQ_ANDROID_CURRENT_RUNTIME_SOURCE_SHA_MISMATCH");
    expect(source).toContain("TIGERIQ_ANDROID_CURRENT_RELEASE_SOURCE_SHA_MISMATCH");
    expect(source).toContain("TIGERIQ_ANDROID_CURRENT_RELEASE_APP_TREE_MISSING");
    expect(source).toContain("TIGERIQ_ANDROID_CURRENT_RELEASE_APP_SOURCE_DRIFT");
    expect(source).toContain("TIGERIQ_ANDROID_CURRENT_RELEASE_SOURCE_ANCESTRY_MISMATCH");
    expect(source).toContain("['-C',spec.repoRoot,'rev-parse','HEAD:apps/android-worker/app']");
    expect(source).toContain("['-C',spec.repoRoot,'merge-base','--is-ancestor',sourceSha,spec.installedSha]");
    expect(source).not.toContain("sourceSha!==spec.installedSha");
    expect(source).toContain("TIGERIQ_ANDROID_CURRENT_APK_SHA256_MISMATCH");
    expect(source).toContain("63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293");
    expect(source).toContain("TIQ Worker v\${shortVersion}.apk");
    expect(source).toContain("spec.runtimeManifestPath+'.current.tmp'");
    expect(source).not.toContain("input?.apkPath");
    expect(source).not.toContain("input?.versionName");
    expect(source).not.toContain("input?.apkSha256");
  });

  it('publishes v0.21 runtime manifest only from verified signed release and validated Drive file id', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    expect(source).toContain("action === 'android_worker_publish_v021_manifest'");
    expect(source).toContain("driveFileId=String(input?.driveFileId||'').trim()");
    expect(source).toContain('/^[A-Za-z0-9_-]{10,200}$/');
    expect(source).toContain("'https://drive.google.com/file/d/'+driveFileId+'/view?usp=drivesdk'");
    expect(source).toContain('versionCode: 21');
    expect(source).toContain("fileName: 'TIQ Worker v0.21.apk'");
    expect(source).toContain("spec.runtimeManifestPath+'.v021.tmp'");
    expect(source).toContain('TIGERIQ_ANDROID_V021_MANIFEST_READBACK_MISMATCH');
    expect(source).not.toContain('input?.apkPath');
    expect(source).not.toContain('input?.versionName');
    expect(source).not.toContain('input?.apkSha256');
    expect(source).not.toContain('input?.driveUrl');
  });
  it('surfaces only bounded Android build-tool discovery failure classes', async () => {
    expect(androidReleaseBuildFailureClass({ stderr: 'ANDROID_APKSIGNER_DISCOVERY_NO_SDK_ROOT' })).toBe('ANDROID_APKSIGNER_DISCOVERY_NO_SDK_ROOT');
    expect(androidReleaseBuildFailureClass({ stderr: 'ANDROID_APKSIGNER_DISCOVERY_NO_BUILD_TOOLS_DIR' })).toBe('ANDROID_APKSIGNER_DISCOVERY_NO_BUILD_TOOLS_DIR');
    expect(androidReleaseBuildFailureClass({ stderr: 'ANDROID_APKSIGNER_DISCOVERY_BINARY_MISSING' })).toBe('ANDROID_APKSIGNER_DISCOVERY_BINARY_MISSING');
    expect(androidReleaseBuildFailureClass({ stderr: 'ANDROID_ZIPALIGN_DISCOVERY_NO_SDK_ROOT' })).toBe('ANDROID_ZIPALIGN_DISCOVERY_NO_SDK_ROOT');
    expect(androidReleaseBuildFailureClass({ stderr: 'ANDROID_ZIPALIGN_DISCOVERY_NO_BUILD_TOOLS_DIR' })).toBe('ANDROID_ZIPALIGN_DISCOVERY_NO_BUILD_TOOLS_DIR');
    expect(androidReleaseBuildFailureClass({ stderr: 'ANDROID_ZIPALIGN_DISCOVERY_BINARY_MISSING' })).toBe('ANDROID_ZIPALIGN_DISCOVERY_BINARY_MISSING');
    expect(androidReleaseBuildFailureClass({ stderr: 'APKSIGNER_JAR_SHA256_REQUIRED' })).toBe('APKSIGNER_JAR_SHA256_REQUIRED');
    expect(androidReleaseBuildFailureClass({ stderr: 'APKSIGNER_JAR_SHA256_MISMATCH' })).toBe('APKSIGNER_JAR_SHA256_MISMATCH');
    expect(androidReleaseBuildFailureClass({ stderr: 'JAVA_RUNTIME_REQUIRED' })).toBe('JAVA_RUNTIME_REQUIRED');
  });

  it('keeps task_list as a fixed read-only schtasks query with no delete path', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    expect(source).toContain("action === 'task_list'");
    expect(source).toContain("['/Query', '/FO', 'CSV', '/NH']");
    expect(source).not.toContain("['/Query', '/FO', 'CSV', '/V', '/NH']");
    expect(source).toContain("scope: 'TigerIQ'");
    expect(source).toContain("taskNames: tasks.map((task) => task.taskName)");
    expect(source).toContain("releaseTaskNames: tasks.map((task) => task.taskName).filter");
    expect(source).not.toContain("['/Delete'");
  });
});


describe('Power Automate Desktop guarded UI contract', () => {
  it('accepts Windows PowerShell UTF-8 BOM on broker JSON files', () => {
    expect(parsePadBrokerJson('\uFEFF{"available":true}')).toEqual({ available: true });
  });

  it('exposes only the bounded PAD action set', () => {
    expect(PAD_UI_ACTIONS).toEqual([
      'pad_health', 'pad_launch', 'pad_windows', 'pad_tree',
      'pad_invoke', 'pad_set_value', 'pad_click', 'pad_keys',
    ]);
  });

  it('keeps v0.20 signing internal-only inside the existing interactive limited-user broker', async () => {
    expect(() => assertPadUiRequest({ action: 'pad_android_sign_v020' })).toThrow('TIGERIQ_PAD_ACTION_NOT_ALLOWED');
    const padModule = await readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui.mjs', import.meta.url), 'utf8');
    expect(padModule).toContain("const INTERNAL_V020_SIGNER_ACTION = 'pad_android_sign_v020'");
    expect(padModule).toContain('MAX_V020_SIGNER_WAIT_MS = 130000');
    expect(padModule).toContain('export async function executePadV020Signer()');
    const broker = await readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    const installer = await readFile(new URL('../apps/openclaw-tigeriq-runtime/Install-PadUiBroker.ps1', import.meta.url), 'utf8');
    expect(broker).toContain("'pad_android_sign_v020' { return Invoke-V020Signer }");
    expect(broker).toContain("D:\\TigerIQ\\Runtime\\CoreSource\\scripts\\pc-worker\\sign-v020-reviewed-artifact.ps1");
    expect(broker).toContain("$psi.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"'");
    expect(broker).not.toContain('ArgumentList.Add');
    expect(broker).toContain("ANDROID_WORKER_STABLE_RELEASE_READY");
    expect(broker).toContain("DPAPI_PASSWORD_DECRYPT_FAILED");
    expect(broker).not.toContain('$Request.command');
    expect(broker).not.toContain('$Request.path');
    expect(broker).not.toMatch(/Password=|Credential=/);
    expect(installer).toContain("New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited");
  });

  it('requires selectors for PAD element mutations and bounds values', () => {
    expect(assertPadUiRequest({ action: 'pad_invoke', name: 'New flow' })).toMatchObject({ action: 'pad_invoke', name: 'New flow' });
    expect(assertPadUiRequest({ action: 'pad_set_value', automationId: 'NameBox', value: 'TigerIQ_CANARY_NOTEPAD' })).toMatchObject({ value: 'TigerIQ_CANARY_NOTEPAD' });
    expect(() => assertPadUiRequest({ action: 'pad_click' })).toThrow('TIGERIQ_PAD_SELECTOR_REQUIRED');
    expect(() => assertPadUiRequest({ action: 'pad_set_value', name: 'x' })).toThrow('TIGERIQ_PAD_VALUE_REQUIRED');
    expect(() => assertPadUiRequest({ action: 'pad_keys', key: 'ALT+F4' })).toThrow('TIGERIQ_PAD_KEY_NOT_ALLOWED');
  });

  it('does not accept coordinate-style fields through the typed PAD request', () => {
    const normalized = assertPadUiRequest({ action: 'pad_windows', x: 10, y: 20 });
    expect(normalized).toEqual({ action: 'pad_windows' });
  });

  it('dispatches PAD keys with native nonblocking key events', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(source).toContain('keybd_event');
    expect(source).toContain("Method='NativeKeyEvent'");
    expect(source).not.toContain('[System.Windows.Forms.SendKeys]::Send(');
    expect(source).not.toContain('[System.Windows.Forms.SendKeys]::SendWait(');
  });

  it('avoids unavailable LegacyIAccessiblePattern on PC01 UIAutomation runtime', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(source).not.toContain('LegacyIAccessiblePattern');
  });

  it('resolves only owned modal UI when a verified PAD designer is disabled', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(source).toContain('Get-PadOwnedModalWindow');
    expect(source).toContain('[TigerIQPadNative]::GetWindow($probe, 4)');
    expect(source).toContain("TIGERIQ_PAD_UI_OWNED_MODAL_AMBIGUOUS");
    expect(source).toContain("if (-not $window.Current.IsEnabled)");
  });

  it('sanitizes non-finite UIAutomation rectangle values before JSON serialization', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(source).toContain('Convert-FiniteUiNumber');
    expect(source).toContain('[double]::IsInfinity($n)');
    expect(source).toContain('[double]::IsNaN($n)');
    expect(source).not.toContain('[math]::Round($r.');
    expect((source.match(/Convert-FiniteUiNumber \\$r\\./g) ?? []).length).toBe(8);
  });
});


describe('TigerIQ Live #3150 typed Vercel production deploy', () => {
  const sha='a'.repeat(40);
  const releaseIssue='3945';
  const releaseReason='Publish owner-authorized TigerIQ LIVE UI';
  const request={
    expectedSha:sha,
    releaseIssue,
    releaseClass:'WEB_LIVE',
    ownerAuthorized:true,
    releaseReason,
  };
  const valid={
    projectLink:{projectId:EXPECTED_PROJECT_ID,orgId:EXPECTED_TEAM_ID},
    expectedSha:sha,
    actualSha:sha,
    branch:EXPECTED_BRANCH,
    mainRefSha:sha,
    remote:'https://github.com/'+EXPECTED_REPO+'.git',
    config:{git:{deploymentEnabled:false}},
    issue:releaseIssue,
    uiHtml:'<link rel="stylesheet" href="/work-ui.css">',
    releaseClass:'WEB_LIVE',
    ownerAuthorized:'true',
    releaseReason,
    changedFiles:['public/work-ui.css'],
  };

  it('accepts only a fully attested exact-SHA typed deployment request', () => {
    expect(assertTigerIQLive3150DeployRequest(request)).toEqual(request);
    expect(() => assertTigerIQLive3150DeployRequest({...request,expectedSha:'abc'})).toThrow('TIGERIQ_VERCEL_EXPECTED_SHA_INVALID');
    expect(() => assertTigerIQLive3150DeployRequest({...request,releaseIssue:''})).toThrow('TIGERIQ_VERCEL_RELEASE_ISSUE_INVALID');
    expect(() => assertTigerIQLive3150DeployRequest({...request,releaseClass:'CORE'})).toThrow('TIGERIQ_VERCEL_RELEASE_CLASS_INVALID');
    expect(() => assertTigerIQLive3150DeployRequest({...request,ownerAuthorized:false})).toThrow('TIGERIQ_VERCEL_OWNER_AUTH_REQUIRED');
    expect(() => assertTigerIQLive3150DeployRequest({...request,releaseReason:''})).toThrow('TIGERIQ_VERCEL_RELEASE_REASON_REQUIRED');
  });

  it('hard-locks project/team/repo/exact remote-main/SHA/owner scope and UI marker', () => {
    expect(validateReleaseContract(valid)).toMatchObject({
      projectId:EXPECTED_PROJECT_ID,
      teamId:EXPECTED_TEAM_ID,
      repo:EXPECTED_REPO,
      branch:'main',
      target:'production',
      exactSha:sha,
      issue:releaseIssue,
      releaseClass:'WEB_LIVE',
      maxAttempts:1,
    });
    expect(() => validateReleaseContract({...valid,projectLink:{projectId:'prj_wrong',orgId:EXPECTED_TEAM_ID}})).toThrow('VERCEL_PROJECT_SCOPE_MISMATCH');
    expect(() => validateReleaseContract({...valid,expectedSha:'b'.repeat(40)})).toThrow('VERCEL_EXACT_SHA_MISMATCH');
    expect(() => validateReleaseContract({...valid,branch:'feature/unsafe',mainRefSha:'b'.repeat(40)})).toThrow('VERCEL_GIT_BRANCH_MISMATCH');
    expect(() => validateReleaseContract({...valid,remote:'https://github.com/newsdayads/other.git'})).toThrow('VERCEL_GIT_REPO_MISMATCH');
    expect(() => validateReleaseContract({...valid,config:{git:{deploymentEnabled:true}}})).toThrow('VERCEL_AUTO_DEPLOY_POLICY_MISMATCH');
    expect(() => validateReleaseContract({...valid,releaseClass:'CORE'})).toThrow('VERCEL_RELEASE_CLASS_INVALID');
    expect(() => validateReleaseContract({...valid,ownerAuthorized:'false'})).toThrow('VERCEL_OWNER_RELEASE_AUTH_REQUIRED');
    expect(() => validateReleaseContract({...valid,releaseReason:''})).toThrow('VERCEL_RELEASE_REASON_REQUIRED');
    expect(() => validateReleaseContract({...valid,uiHtml:'no marker'})).toThrow('VERCEL_UI_MARKER_MISSING');
  });

  it('keeps deployment one-shot, typed, dynamically issue-bound, and outside arbitrary shell allowlist', async () => {
    const operatorSource=await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs',import.meta.url),'utf8');
    const deploySource=await readFile(new URL('../scripts/pc-worker/vercel-tigeriq-live-3150-deploy.mjs',import.meta.url),'utf8');
    expect(operatorSource).toContain("action === 'tigeriq_live_3150_production_deploy'");
    expect(operatorSource).toContain("scripts\\\\pc-worker\\\\vercel-tigeriq-live-3150-deploy.mjs");
    expect(operatorSource).toContain("'--issue', releaseIssue");
    expect(operatorSource).toContain("'--release-class', releaseClass");
    expect(operatorSource).toContain("'--owner-authorized', ownerAuthorized ? 'true' : 'false'");
    expect(operatorSource).toContain("'--release-reason', releaseReason");
    expect(operatorSource).toContain("receipt.issue !== releaseIssue");
    expect(operatorSource).toContain("receipt.releaseClass !== 'WEB_LIVE'");
    expect(operatorSource).toContain("extraEnvKeys: ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME']");
    expect(operatorSource).toContain("productionMutationScope: action === 'tigeriq_live_3150_production_deploy'");
    expect(operatorSource).not.toContain("input?.command");
    expect(() => assertShellCommandAllowed('vercel deploy --prod')).toThrow('TIGERIQ_PC_COMMAND_NOT_ALLOWLISTED');

    expect(deploySource).not.toContain("AUTHORIZED_ISSUE = '3185'");
    expect(deploySource).toContain("EXPECTED_PROJECT_ID = 'prj_gg7AuV6y62TALzEpby8XUAFisLKw'");
    expect(deploySource).toContain("EXPECTED_TEAM_ID = 'team_K8HIG7zmwu0ZjCINX1VhlGiT'");
    expect(deploySource).toContain("EXPECTED_REPO = 'newsdayads/tigeriq-ai-lab'");
    expect(deploySource).toContain("EXPECTED_BRANCH = 'main'");
    expect(deploySource).toContain('REQUIRED_UI_MARKER = \'href="/work-ui.css"\'');
    expect(deploySource).toContain("'--release-class'");
    expect(deploySource).toContain("'--owner-authorized'");
    expect(deploySource).toContain("'--release-reason'");
    expect((deploySource.match(/vercel\.cmd deploy --prod --yes/g)||[]).length).toBe(1);
    expect(deploySource).not.toContain('VERCEL_TOKEN');
    expect(deploySource).not.toContain('retry');
  });

  it('classifies bounded deploy failures without leaking raw output', () => {
    expect(classifyDeployFailure('Deployment rate limited')).toBe('VERCEL_RATE_LIMIT_WAIT');
    expect(classifyDeployFailure('Please log in to Vercel')).toBe('VERCEL_AUTH_REQUIRED');
    expect(classifyDeployFailure('vercel is not recognized')).toBe('VERCEL_CLI_MISSING');
    expect(classifyDeployFailure('unexpected failure')).toBe('VERCEL_DEPLOY_FAILED');
  });
});

describe('#4532 isolated Cline benchmark preflight',()=>{
  const f=(data)=>({ok:true,status:200,async json(){return data;}});
  const lstatImpl=async(path)=>{
    if(String(path).endsWith('cline.cmd'))return {isFile:()=>true,isSymbolicLink:()=>false};
    throw Object.assign(new Error('not found'),{code:'ENOENT'});
  };
  it('reads fixed loopback endpoints, does not execute code or claim benchmark pass',async()=>{
    const urls=[];
    const result=await readClineBenchmarkPreflight({
      lstatImpl,
      fetchImpl:async(url)=>{urls.push(String(url));if(String(url).endsWith('11434/api/tags'))return f({models:[{name:'qwen3:8b',digest:'sha256-fixture'}]});return f({ok:true,service:'tigeriq-coding-lane'});},
      env:{},
    });
    expect(urls).toEqual(['http://127.0.0.1:11434/api/tags','http://127.0.0.1:8797/health']);
    expect(result).toMatchObject({clineCliInstalled:true,ollamaAvailable:true,nv09CodingLaneOnline:true,dockerIsolationAttested:false,benchmarkRunAuthorized:false,readyForLiveBenchmark:false,gate:'ISOLATED_EXECUTOR_NOT_ATTESTED',cloudApiCalls:0,sourceMutations:0});
    expect(JSON.stringify(result)).not.toMatch(/secret|password|access.token/i);
  });
  it('fails closed without any installed CLI or Ollama and never fabricates results',async()=>{
    const result=await readClineBenchmarkPreflight({
      lstatImpl:async()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});},
      fetchImpl:async()=>{throw new Error('OFFLINE');},
      env:{},
    });
    expect(result).toMatchObject({clineCliInstalled:false,ollamaAvailable:false,nv09CodingLaneOnline:false,readyForLiveBenchmark:false,gate:'CLINE_CLI_NOT_INSTALLED_OR_UNDETECTED'});
    expect(result.installedLocalModels).toEqual([]);
  });
});


describe('Agent Desktop bridge in existing TigerIQ MCP lane', () => {
  it('routes the bounded public UI actions through agent-desktop while keeping internal signatures isolated', async () => {
    const broker = await readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(broker).toContain(". (Join-Path $PSScriptRoot 'agent-desktop-ui.ps1')");
    for (const action of PAD_UI_ACTIONS.filter((name) => name !== 'pad_health')) {
      expect(broker).toContain("'" + action + "' { return Invoke-AgentDesktopAction $Request }");
    }
    expect(broker).toContain("'pad_android_sign_v020' { return Invoke-V020Signer }");
    expect(broker).toContain("'nv07_native_session_ping' {");
  });

  it('pins a local launcher and does not create a second MCP listener or use arbitrary coordinates', async () => {
    const src = await readFile(new URL('../apps/openclaw-tigeriq-runtime/agent-desktop-ui.ps1', import.meta.url), 'utf8');
    expect(src).toContain("'D:\\TigerIQ\\Tools\\agent-desktop\\node_modules\\.bin\\agent-desktop.cmd'");
    expect(src).toContain("Invoke-TigerIQAgentDesktopCli -Arguments @('snapshot','--window-id'");
    expect(src).toContain("Invoke-TigerIQAgentDesktopCli -Arguments @('click',$ref)");
    expect(src).toContain("Invoke-TigerIQAgentDesktopCli -Arguments @('set-value',$ref,'--stdin') -StdinText $value");
    expect(src).toContain('TIGERIQ_AGENT_DESKTOP_WINDOW_AMBIGUOUS');
    expect(src).toContain('TIGERIQ_AGENT_DESKTOP_ELEMENT_AMBIGUOUS');
    expect(src).toContain('TIGERIQ_AGENT_DESKTOP_CLASS_SELECTOR_UNSUPPORTED');
    expect(src).toContain("'notepad.exe','calc.exe','mspaint.exe'");
    expect(src).not.toMatch(/SetCursorPos|mouse_event|mouse-click|127\.0\.0\.1:\d+|mcpServers/);
  });

  it('preserves the strict pre-existing bounded selectors and disallowed key combinations', () => {
    expect(() => assertPadUiRequest({ action: 'pad_click', name: 'Launch', x: 100, y: 200 })).not.toThrow();
    expect(assertPadUiRequest({ action: 'pad_click', name: 'Launch', x: 100, y: 200 })).toEqual({ action: 'pad_click', name: 'Launch' });
    expect(() => assertPadUiRequest({ action: 'pad_keys', key: 'ALT+TAB' })).toThrow('TIGERIQ_PAD_KEY_NOT_ALLOWED');
    expect(() => assertPadUiRequest({ action: 'pad_set_value', name: 'Input', value: 'ok' })).not.toThrow();
  });
});
