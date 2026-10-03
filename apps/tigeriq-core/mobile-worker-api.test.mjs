import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mobileTaskTerminalDecision, normalizeMobileProvider, readMobileReleaseManifest, verifyMobilePairingProof } from './mobile-worker-api.mjs';

let tempPath='';
afterEach(()=>{if(tempPath)rmSync(tempPath,{recursive:true,force:true});tempPath='';});

describe('mobile worker api helpers',()=>{
  it('verifies Android-compatible P256 challenge proof',()=>{
    const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    const challenge='tigeriq-mobile-proof';
    const proof=sign('sha256',Buffer.from(challenge),privateKey).toString('base64url');
    const publicKeyBase64=publicKey.export({type:'spki',format:'der'}).toString('base64');
    expect(verifyMobilePairingProof({publicKey:publicKeyBase64,challenge,proof})).toBe(true);
    expect(verifyMobilePairingProof({publicKey:publicKeyBase64,challenge:'tampered',proof})).toBe(false);
  });

  it('normalizes the two pilot providers',()=>{
    expect(normalizeMobileProvider('Gemini')).toBe('Gemini');
    expect(normalizeMobileProvider('anything-else')).toBe('ChatGPT');
  });

  it('keeps terminal mobile task commits exactly-once across retries',()=>{
    for(let i=1;i<=10;i++){
      const result={status:'completed',output:{token:`TIGERIQ_GATE_C_OK_${i}`},seq:i};
      const first=mobileTaskTerminalDecision({status:'leased',currentDigest:'',incomingResult:result});
      expect(first).toMatchObject({accept:true,idempotent:false,conflict:false});
      const retry=mobileTaskTerminalDecision({status:'completed',currentDigest:first.digest,incomingResult:result});
      expect(retry).toMatchObject({accept:false,idempotent:true,conflict:false});
      const conflict=mobileTaskTerminalDecision({
        status:'completed',
        currentDigest:first.digest,
        incomingResult:{...result,output:{token:'DIFFERENT'}},
      });
      expect(conflict).toMatchObject({accept:false,idempotent:false,conflict:true});
    }
  });

  it('reads a local release manifest without exposing implicit defaults',()=>{
    tempPath=mkdtempSync(join(tmpdir(),'tigeriq-mobile-'));
    const path=join(tempPath,'release.json');
    writeFileSync(path,JSON.stringify({
      versionCode:7,versionName:'0.7.0-core-mobile',sha256:'aa'.repeat(32),
      signerSha256:'11:22',fileName:'TIQ Worker v0.7.apk',channel:'DEV',
      apkPath:'D:\\TigerIQ\\Releases\\AndroidWorker\\TIQ Worker v0.7.apk',
      driveUrl:'https://drive.google.com/file/d/test/view',publishedAt:'2026-10-03T00:00:00Z'
    }));
    const manifest=readMobileReleaseManifest(path);
    expect(manifest.available).toBe(true);
    expect(manifest.versionCode).toBe(7);
    expect(manifest.downloadPath).toBe('/api/mobile/update/apk');
    expect(manifest.driveUrl).toContain('drive.google.com');
  });
});
