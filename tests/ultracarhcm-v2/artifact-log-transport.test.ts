import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  shouldExportGh5135ArtifactViaCiLog,
  writeArtifactToCiLog,
} from './artifact-log-transport.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, {recursive:true, force:true});
});

describe('GH-5135 CI log artifact transport', () => {
  it('exports only from workflow CI for GH-5135 PR or relevant main push', () => {
    expect(shouldExportGh5135ArtifactViaCiLog(
      'CI','pull_request',{},'nv02/gh5135-exact-main-artifact-20261104',
    )).toBe(true);
    expect(shouldExportGh5135ArtifactViaCiLog(
      'WO-012/013 Vercel Online Verify','pull_request',{},'nv02/gh5135-x',
    )).toBe(false);
    expect(shouldExportGh5135ArtifactViaCiLog('CI','push',{
      ref:'refs/heads/main',
      commits:[{modified:['apps/ultracarhcm-v2/app/build.gradle']}],
    },undefined)).toBe(true);
    expect(shouldExportGh5135ArtifactViaCiLog('CI','push',{
      ref:'refs/heads/main',
      commits:[{modified:['README.md']}],
    },undefined)).toBe(false);
  });

  it('emits ordered bounded base64 chunks that reconstruct exact bytes and hash', () => {
    const root=mkdtempSync(join(tmpdir(),'gh5135-log-'));
    roots.push(root);
    const file=join(root,'x.apk');
    const payload=Buffer.from('0123456789abcdef'.repeat(900));
    writeFileSync(file,payload);
    const lines:string[]=[];
    const receipt=writeArtifactToCiLog(file,'UltraCar_TEST.apk',line=>lines.push(line),4000);
    expect(lines[0]).toMatch(/^GH5135_ARTIFACT_B64_BEGIN\|/);
    expect(lines.at(-1)).toMatch(/^GH5135_ARTIFACT_B64_END\|/);
    const reconstructed=Buffer.from(
      lines.slice(1,-1).map(line=>line.split('|',3)[2]).join(''),
      'base64',
    );
    expect(reconstructed.equals(payload)).toBe(true);
    expect(receipt.bytes).toBe(payload.length);
    expect(receipt.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.chunks).toBe(lines.length-2);
  });

  it('rejects unsafe names and unbounded chunk sizes', () => {
    const root=mkdtempSync(join(tmpdir(),'gh5135-log-invalid-'));
    roots.push(root);
    const file=join(root,'x.apk');
    writeFileSync(file,'x');
    expect(()=>writeArtifactToCiLog(file,'../x.apk',()=>{})).toThrow('GH5135_ARTIFACT_NAME_INVALID');
    expect(()=>writeArtifactToCiLog(file,'x.apk',()=>{},1000)).toThrow(
      'GH5135_ARTIFACT_CHUNK_SIZE_INVALID',
    );
  });
});
