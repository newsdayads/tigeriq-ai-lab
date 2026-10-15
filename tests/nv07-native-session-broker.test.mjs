import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {probeNv07NativeUserSession} from '../apps/openclaw-tigeriq-runtime/pad-ui.mjs';

const src=(name)=>readFileSync(new URL('../apps/openclaw-tigeriq-runtime/'+name,import.meta.url),'utf8');

describe('P0 #4783 real interactive Windows user-session IPC prerequisite',()=>{
  it('registers a typed Core-to-interactive-broker action without shell or credential scope',()=>{
    const operator=src('operator.mjs'),plugin=src('dist/index.js'),broker=src('pad-ui-broker.ps1');
    expect(operator).toContain("action === 'nv07_native_session_probe'");
    expect(plugin).toContain("Type.Literal('nv07_native_session_probe')");
    expect(broker).toContain("'nv07_native_session_ping'");
    expect(broker).toContain('[System.Security.Principal.WindowsIdentity]::GetCurrent()');
    expect(broker).toContain('source=\'WINDOWS_INTERACTIVE_BROKER\'');
    expect(broker).toContain("authority='OBSERVATION_ONLY'");
    expect(broker).toContain("nonce=$nonce");
    expect(broker).not.toContain('nv07_native_session_ping\' { return Invoke-V020Signer');
  });
  it('fails closed on unavailable user broker without claiming Core lease or activation',async()=>{
    // Linux GitHub CI has no PC01 broker; no Windows impersonation or mocked PASS.
    if(process.platform==='win32')return;
    const result=await probeNv07NativeUserSession();
    expect(result).toMatchObject({
      ready:false,code:'NV07_NATIVE_SESSION_BROKER_UNAVAILABLE',
      attestationVerified:false,coreLeaseVerified:false,nv07Active:false,
    });
  });
  it('keeps session presence distinct from host attestation and Core authority',()=>{
    const code=src('pad-ui.mjs');
    expect(code).toContain("result?.nonce===nonce");
    expect(code).toContain("Number(broker?.sessionId)===sessionId");
    expect(code).toContain("String(broker?.user||'').toLowerCase()==='wdragons12x'");
    expect(code).toContain('attestationVerified:false,coreLeaseVerified:false,nv07Active:false');
    expect(code).not.toContain('attestationVerified:true');
  });
});
