import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const guardPath=fileURLToPath(new URL('../scripts/tigeriq-core/pc01-release-guard.ps1',import.meta.url));
const sha='1'.repeat(40), previous='2'.repeat(40);
const esc=p=>p.replaceAll("'","''");
const template=()=>({
  schema:'TIGERIQ_PC01_RELEASE_APPROVAL_V1',
  scope:'TIGERIQ_PC01_GATED_RELEASE_NO_RDC_PHASE1',
  targetSha:sha,expectedInstalledSha:previous,rollbackSha:previous,
  requestId:'PC01-RELEASE-4725-A',
  approved:true,components:['core'],
  expiresAtUtc:new Date(Date.now()+3600_000).toISOString(),
});
function run({approval=null,attempt=null,impact='@{core=$true;web=$false;coding=$false;openclaw=$false;updater=$false;liveBridge=$false}'}={}){
  const dir=mkdtempSync(join(tmpdir(),'tigeriq-guard-e2e-'));
  try{
    const approver=join(dir,'approval.json'),marker=join(dir,'attempt.json');
    if(approval!==null)writeFileSync(approver,JSON.stringify(approval));
    if(attempt!==null)writeFileSync(marker,JSON.stringify(attempt));
    const powershell=[
      ". '"+esc(guardPath)+"'",
      "$releaseApprovalPath='"+esc(approver)+"'",
      "$releaseAttemptPath='"+esc(marker)+"'",
      "$impact="+impact,
      "$result=Get-ReleaseApproval '"+sha+"' '"+previous+"' $impact",
      '$result|ConvertTo-Json -Compress -Depth 4',
    ].join('\n');
    const script=join(dir,'guard-harness.ps1');
    writeFileSync(script,powershell);
    const p=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-File',script],{encoding:'utf8'});
    expect(p.status,p.stderr||p.stdout).toBe(0);
    return JSON.parse(p.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
  }finally{rmSync(dir,{recursive:true,force:true});}
}
const pwshPresent=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command','$true'],{encoding:'utf8'}).status===0;
it.skipIf(!pwshPresent)('live PowerShell guard rejects absence of independent local ticket',()=>{
  expect(run().reason).toBe('RELEASE_LOCAL_APPROVAL_MISSING');
});
it.skipIf(!pwshPresent)('accepts only matching local release ticket (preflight, not identity proof)',()=>{
  expect(run({approval:template()}).approved).toBe(true);
});
it.skipIf(!pwshPresent)('rejects target mismatch without applying anything',()=>{
  const approval=template();approval.targetSha='3'.repeat(40);
  expect(run({approval}).reason).toBe('RELEASE_TARGET_MISMATCH');
});
it.skipIf(!pwshPresent)('rejects web/coding impact outside Phase A scope',()=>{
  expect(run({approval:template(),impact:'@{core=$true;web=$true;coding=$false;openclaw=$false;updater=$false;liveBridge=$false}'}).reason).toBe('RELEASE_IMPACT_OUT_OF_SCOPE');
});
it.skipIf(!pwshPresent)('rejects replayed release attempt even with valid ticket',()=>{
  const attempt={requestId:'PC01-RELEASE-4725-A',targetSha:sha,result:'ROLLED_BACK'};
  expect(run({approval:template(),attempt}).reason).toBe('RELEASE_ATTEMPT_ALREADY_RECORDED');
});
it.skipIf(!pwshPresent)('rejects approval after expiry',()=>{
  const approval=template();approval.expiresAtUtc=new Date(Date.now()-3600_000).toISOString();
  expect(run({approval}).reason).toBe('RELEASE_APPROVAL_EXPIRED_OR_TOO_LONG');
});
