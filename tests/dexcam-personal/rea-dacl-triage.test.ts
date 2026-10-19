import { describe, expect, it } from 'vitest';
// @ts-ignore Standalone dependency-free JS source (no generated declarations).
import { triageReaDacl } from '../../projects/dexcam-personal/rea-dacl-triage.mjs';

const dacl = 'REA Windows native self-test failed: Private DACL contains unexpected trustees [REDACTED] (Win32 5)';
const deletion = 'REA Windows native self-test failed: Delete owned object by handle failed [REDACTED] (Win32 5)';

describe('DeXCam P01 REA diagnostic classification is source-only and fail-closed', () => {
  it('classifies strict DACL ACE-count gate, never as APK success', () => {
    const r = triageReaDacl({ errorText: dacl, reaVersion: '6.5.0' });
    expect(r.status).toBe('BLOCKED_NATIVE_DACL');
    expect(r.failureClass).toBe('DACL_ACE_COUNT_GUARD');
    expect(r.p01Accepted).toBe(false);
    expect(r.androidApkInspected).toBe(false);
    expect(r.safeToRetryUnchanged).toBe(false);
  });

  it('flags LocalSystem SID collision as hypothesis only, not a root cause', () => {
    const r = triageReaDacl({ errorText: dacl, processContext: 'LOCAL_SYSTEM' });
    expect(r.systemSidOverlapHypothesis).toBe('POSSIBLE_NOT_CONFIRMED');
    expect(r.p01Accepted).toBe(false);
  });

  it('does not invent a SID overlap for normal or unknown accounts', () => {
    expect(triageReaDacl({ errorText: dacl, processContext: 'INTERACTIVE_USER' })
      .systemSidOverlapHypothesis).toBe('NOT_ASSESSED');
    expect(triageReaDacl({ errorText: dacl }).systemSidOverlapHypothesis)
      .toBe('NOT_ASSESSED');
  });

  it('rejects contradictory caller-reported ACE count = 2', () => {
    const r = triageReaDacl({ errorText: dacl, observedAceCount: 2 });
    expect(r.status).toBe('CONTRADICTORY_OBSERVATIONS');
    expect(r.next).toBe('CHECK_ARTIFACT_PROVENANCE_AND_OBSERVATION_CONTEXT');
  });

  it('does not treat caller ACE count as independent proof', () => {
    const r = triageReaDacl({ errorText: dacl, observedAceCount: 3 });
    expect(r.status).toBe('BLOCKED_NATIVE_DACL');
    expect(r.p01Accepted).toBe(false);
  });

  it('never conflates the separate Win32 5 delete-by-handle error', () => {
    const r = triageReaDacl({ errorText: deletion, reaVersion: '6.4.0' });
    expect(r.failureClass).toBe('HANDLE_DELETE_SHARE_FAILURE');
    expect(r.status).toBe('BLOCKED_NATIVE_CLEANUP');
  });

  it('does not call a mixed multi-run log one root cause', () => {
    const r = triageReaDacl({ errorText: dacl + '\n' + deletion });
    expect(r.status).toBe('AMBIGUOUS_MULTIPLE_FAILURES');
    expect(r.failureClass).toBe('UNVERIFIED');
  });

  it('treats new provider errors as unknown rather than fixed', () => {
    const r = triageReaDacl({ errorText: 'unsupported_provider: jadx unavailable' });
    expect(r.status).toBe('UNCLASSIFIED');
    expect(r.p01Accepted).toBe(false);
  });

  it('rejects private-path and credential fields, never echoes raw error', () => {
    const secret = 'D:/private/OWNER_SECRETS/untrusted.apk';
    const r = triageReaDacl({ errorText: dacl, apkPath: secret });
    expect(r.status).toBe('INVALID_INPUT');
    expect(JSON.stringify(r)).not.toContain(secret);
    const redacted = triageReaDacl({ errorText: dacl + ' ' + secret });
    expect(JSON.stringify(redacted)).not.toContain(secret);
  });

  it('rejects missing error, malformed package version, and unsafe ACE count', () => {
    for (const x of [
      {},
      { errorText: dacl, reaVersion: 'latest' },
      { errorText: dacl, observedAceCount: -1 },
      { errorText: dacl, observedAceCount: 1.5 },
      { errorText: dacl, processContext: 'ROOT' },
      { errorText: 'x'.repeat(5000) }
    ]) {
      const r = triageReaDacl(x);
      expect(r.status).toBe('INVALID_INPUT');
      expect(r.p01Accepted).toBe(false);
    }
  });
});
