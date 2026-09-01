import { describe, expect, it } from 'vitest';
import { workResultPresentation } from '../api/web-control-status.mjs';

describe('Web Control result presentation', () => {
  it('extracts the latest concrete result, expected evidence, evidence summary, and ref', () => {
    const comments = [
      { body: 'TIGERIQ_JOB_RESULT\nEVIDENCE_REF sha256:old\n\n## Result\nold' },
      {
        created_at: '2026-09-01T05:30:00Z',
        body: [
          'TIGERIQ_JOB_RESULT',
          'EVIDENCE_REF sha256:abc123',
          '',
          '## Expected Evidence',
          'Concrete answer plus independent gates.',
          '',
          '## Result',
          '42',
          '',
          '## Evidence Summary',
          'Executor returned the bounded computed answer.',
        ].join('\n'),
      },
    ];
    expect(workResultPresentation(comments)).toEqual({
      result: '42',
      expectedEvidence: 'Concrete answer plus independent gates.',
      evidenceSummary: 'Executor returned the bounded computed answer.',
      evidenceRef: 'sha256:abc123',
      createdAt: '2026-09-01T05:30:00Z',
    });
  });

  it('does not fabricate a result when no result comment exists', () => {
    expect(workResultPresentation([{ body: 'TIGERIQ_JOB_CLAIMED' }])).toBeNull();
  });
});
