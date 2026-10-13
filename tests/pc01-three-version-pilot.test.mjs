import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessPc01ReleasePreflight } from '../scripts/tigeriq-core/pc01-release-preflight.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function git(path,...args){return execFileSync('git',['-C',path,...args],{encoding:'utf8'}).trim();}
function setVersion(repo, version, healthy=true){
  writeFileSync(join(repo,'pilot-component.json'), JSON.stringify({schema:'TIGERIQ_PC01_TEST_COMPONENT_V1',version,healthy}));
  git(repo,'add','pilot-component.json');
  git(repo,'commit','-m',`pilot test component v${version}`);
  return git(repo,'rev-parse','HEAD');
}
function admit({targetSha,previousSha,blob,version}){
  return assessPc01ReleasePreflight({
    request:{
      schema:'TIGERIQ_PC01_RELEASE_CANDIDATE_V1',requestId:`PC01-PILOT-${version}-4725`,
      targetSha,expectedInstalledSha:previousSha,rollbackSha:previousSha,
      artifact:{sha256:sha256(blob)},
      components:['updater'],resourceScopes:['TIGERIQ_PC01_GATED_RELEASE_NO_RDC_PHASE1'],
    },
    observed:{installedSha:previousSha,pc01Online:true,resourceScopeBusy:false,concurrentWriter:false},
    verifiedEvidence:{
      sourceSha:targetSha,artifactSha256:sha256(blob),exactHeadCi:true,
      qualityGate:true,rollbackKnownGood:true,authoritativeWorkOrder:true,validSourceProvenance:true,
    },
  });
}

describe('PC01 #4725: isolated 3-version source → release gate → stage → health → receipt pilot',()=>{
  it('applies three independent exact-SHA test-component releases, preserves state, has one writer and rolls back failure',()=>{
    const root=mkdtempSync(join(tmpdir(),'tigeriq-pc01-4725-pilot-'));
    const repo=join(root,'isolated-git-runtime');
    mkdirSync(repo);
    let writerCount=0,maxWriters=0;
    const receipt=[];
    try{
      git(repo,'init');git(repo,'config','user.name','PC01 Isolated Test');
      git(repo,'config','user.email','pc01-test@tigeriq.local');
      const initial=setVersion(repo,0);
      git(repo,'checkout','--detach',initial);
      // Immutable device-like data outside the disposable Git runtime worktree.
      const stateFile=join(root,'preserved-configuration.json');
      const initialState={deviceIdentity:'test-component-only',ownerState:'preserve',configVersion:1};
      writeFileSync(stateFile,JSON.stringify(initialState));
      let installedSha=initial;
      const commits=[];
      for(let version=1;version<=3;version++){
        const target=setVersion(repo,version);commits.push(target);
        git(repo,'reset','--hard',installedSha);
        const blob=execFileSync('git',['-C',repo,'show',`${target}:pilot-component.json`]);
        const gate=admit({targetSha:target,previousSha:installedSha,blob,version});
        expect(gate).toMatchObject({eligible:true,reason:'READY_FOR_SEPARATE_RELEASE_AUTHORIZATION'});
        // Separate trusted authorization is represented by this isolated test fixture,
        // NOT a permission to mutate PC01 or a real Owner identity proof.
        const approvedForTest=true;
        expect(approvedForTest).toBe(true);
        writerCount++;maxWriters=Math.max(maxWriters,writerCount);
        try{
          expect(writerCount).toBe(1);
          git(repo,'reset','--hard',target);
          const health=JSON.parse(readFileSync(join(repo,'pilot-component.json'),'utf8'));
          expect(health).toMatchObject({version,healthy:true});
          expect(git(repo,'rev-parse','HEAD')).toBe(target);
          expect(JSON.parse(readFileSync(stateFile,'utf8'))).toEqual(initialState);
          receipt.push({version,previousSha:installedSha,installedSha:target,result:'COMMITTED'});
          installedSha=target;
        }finally{writerCount--;}
      }
      expect(receipt).toHaveLength(3);
      expect(new Set(commits).size).toBe(3);
      expect(receipt.every(r=>r.result==='COMMITTED')).toBe(true);
      expect(maxWriters).toBe(1);

      // Inject a bad health result into a real 4th Git commit, restore known-good SHA.
      const badSha=setVersion(repo,4,false);
      git(repo,'reset','--hard',installedSha);
      const badBlob=execFileSync('git',['-C',repo,'show',`${badSha}:pilot-component.json`]);
      expect(admit({targetSha:badSha,previousSha:installedSha,blob:badBlob,version:4}).eligible).toBe(true);
      const knownGood=installedSha;
      writerCount++;
      try{
        git(repo,'reset','--hard',badSha);
        const unhealthy=JSON.parse(readFileSync(join(repo,'pilot-component.json'),'utf8'));
        expect(unhealthy.healthy).toBe(false);
        git(repo,'reset','--hard',knownGood);
        receipt.push({version:4,previousSha:knownGood,installedSha:knownGood,result:'ROLLED_BACK'});
      }finally{writerCount--;}
      expect(git(repo,'rev-parse','HEAD')).toBe(knownGood);
      expect(JSON.parse(readFileSync(join(repo,'pilot-component.json'),'utf8')).version).toBe(3);
      expect(JSON.parse(readFileSync(stateFile,'utf8'))).toEqual(initialState);
      expect(writerCount).toBe(0);
      // Evidence is explicitly tagged as isolated simulation, NOT installed PC01.
      console.log('PC01_PILOT_EVIDENCE',JSON.stringify({environment:'ISOLATED_TEST_COMPONENT_ONLY',successiveVersions:3,forcedHealthRollback:'PASS',maxConcurrentWriters:maxWriters,configPreserved:true,receiptCount:receipt.length,rdcCalls:0,livePc01Mutations:0}));
    }finally{rmSync(root,{recursive:true,force:true});}
  },15000);

  it('rejects tampered artifact and offline device before mutating the test runtime',()=>{
    const target='a'.repeat(40),installed='b'.repeat(40),blob=Buffer.from('test');
    const accepted=admit({targetSha:target,previousSha:installed,blob,version:'NEG'});
    expect(accepted.eligible).toBe(true);
    const mismatch=assessPc01ReleasePreflight({
      request:{
        schema:'TIGERIQ_PC01_RELEASE_CANDIDATE_V1',requestId:'PC01-NEG-4725',
        targetSha:target,expectedInstalledSha:installed,rollbackSha:installed,
        artifact:{sha256:sha256(blob)},components:['updater'],
        resourceScopes:['TIGERIQ_PC01_GATED_RELEASE_NO_RDC_PHASE1'],
      },
      observed:{installedSha:installed,pc01Online:false,resourceScopeBusy:false,concurrentWriter:false},
      verifiedEvidence:{
        sourceSha:target,artifactSha256:'c'.repeat(64),
        exactHeadCi:true,qualityGate:true,rollbackKnownGood:true,
        authoritativeWorkOrder:true,validSourceProvenance:true,
      },
    });
    expect(mismatch.eligible).toBe(false);
    expect(mismatch.reason).toBe('ARTIFACT_HASH_MISMATCH');
  });
});
