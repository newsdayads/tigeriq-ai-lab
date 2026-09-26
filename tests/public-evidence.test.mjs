import {describe,expect,it} from 'vitest';
import {
  buildPublicEvidence,findPublicEvidenceObject,formatPublicEvidenceLine,parsePublicEvidenceKeys,sanitizePublicEvidenceValue
} from '../apps/tigeriq-core/public-evidence.mjs';

describe('bounded public pc_operator evidence',()=>{
  it('parses only the fixed supported allowlist',()=>{
    expect(parsePublicEvidenceKeys('PUBLIC_EVIDENCE_KEYS=installedSha,result,secret,changedPaths,result')).toEqual([
      'installedSha','result','changedPaths'
    ]);
    expect(parsePublicEvidenceKeys('NO_PUBLIC=true')).toEqual([]);
  });

  it('selects the nested object with the strongest requested-key match including JSON strings',()=>{
    const state={installedSha:'abc',result:'UPDATED',changedPaths:['apps/tigeriq-core/core.mjs'],updaterTaskTarget:{action:'none'}};
    const job={evidence:{agentResult:{status:'PASS',evidence:{toolResult:{content:JSON.stringify(state)},result:'wrapper'}}}};
    expect(findPublicEvidenceObject(job,['installedSha','result','changedPaths'])).toMatchObject(state);
  });

  it('redacts secret-like keys and token patterns while capping values',()=>{
    const safe=sanitizePublicEvidenceValue({
      action:'none',token:'should-not-leak',nested:{authorization:'Bearer abcdefghijklmnop',note:'ghp_abcdefghijklmnop'}
    });
    expect(safe.token).toBe('[REDACTED]');
    expect(safe.nested.authorization).toBe('[REDACTED]');
    expect(safe.nested.note).toBe('[REDACTED]');
  });

  it('publishes only requested fields and nothing when marker is absent',()=>{
    const state={installedSha:'abc',result:'UPDATED',remoteDesktopGuard:{action:'verified',credential:'x'},changedPaths:['a'],updaterTaskTarget:{action:'none'},extra:'NO'};
    const job={evidence:{agentResult:{status:'PASS',evidence:state,text:'raw'}}};
    expect(buildPublicEvidence(job,['installedSha','remoteDesktopGuard'])).toEqual({
      schema:'TIGERIQ_PUBLIC_EVIDENCE_V1',
      fields:{installedSha:'abc',remoteDesktopGuard:{action:'verified',credential:'[REDACTED]'}}
    });
    expect(formatPublicEvidenceLine(job,[])).toBe('');
    const line=formatPublicEvidenceLine(job,['result','changedPaths']);
    expect(line).toContain('PUBLIC_EVIDENCE_V1=');
    expect(line).toContain('"result":"UPDATED"');
    expect(line).not.toContain('"extra"');
    expect(line).not.toContain('"text"');
  });
});
