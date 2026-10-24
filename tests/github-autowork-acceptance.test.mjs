import { describe, expect, it } from 'vitest';
import { evaluateGithubAutoworkOutput, reinforceGithubAutoworkPrompt } from '../apps/tigeriq-core/github-autowork-acceptance.mjs';

const base = {
  kind: 'github_api_autowork',
  employeeId: 'NV12',
  resourceId: 'res:gemini:gemini-3.5-flash-lite:default:core',
  resourceScope: 'TIGERIQ_CORE_NATIVE_R04_Q01_Q14_5144_20261023',
};
const fullAnswer = Array.from({ length: 14 }, (_, i) => {
  const id = 'Q' + String(i + 1).padStart(2, '0');
  return [
    id + ':',
    'OBSERVATION: Core cần đối chiếu nguồn thật trước khi kết luận.',
    'REAL_EVIDENCE_SOURCE_WITH_TIMESTAMP: Synthetic test fixture 2026-10-24T05:07:51Z.',
    'EXPECTED: Có biên nhận thời gian thực và tác nhân thật.',
    'DEVIATION: UNKNOWN cho đến khi độc lập kiểm tra.',
    'CONFIDENCE: UNKNOWN.',
    'NEXT_ACTION: Đối chiếu nguồn thực, không giả đã nghiệm thu.',
  ].join('\n');
}).join('\n');

describe('native R04 prompt reinforcement without job dispatch or guessed evidence', () => {
  it('injects 14 separate six-field prompts for the canonical Core R04 scope', () => {
    const prompt=reinforceGithubAutoworkPrompt({
      kind:base.kind,resourceScope:base.resourceScope,prompt:'Read the real work order and sources.',
    });
    expect(prompt.startsWith('Read the real work order and sources.')).toBe(true);
    expect(prompt.match(/^Q(?:0[1-9]|1[0-4]):$/gm)).toHaveLength(14);
    for(const field of [
      'OBSERVATION','REAL_EVIDENCE_SOURCE_WITH_TIMESTAMP','EXPECTED','DEVIATION','CONFIDENCE','NEXT_ACTION',
    ]){
      expect(prompt.split(field+':').length-1).toBe(14);
    }
    expect(prompt).toContain('Do not invent sources, timestamps');
    expect(prompt).toContain('UNKNOWN');
    expect(prompt).not.toContain('2026-10-24T05:07:51Z');
  });
  it('keeps unrelated job prompts identical, including sibling Core scopes', () => {
    const original='Original private instruction remains unchanged';
    for(const input of [
      {kind:'github_review',resourceScope:base.resourceScope},
      {kind:'github_api_autowork',resourceScope:'TIGERIQ_CORE_FREE_API_REASONING_E2E_20261023'},
      {kind:'github_api_autowork',resourceScope:''},
    ]){
      expect(reinforceGithubAutoworkPrompt({...input,prompt:original})).toBe(original);
    }
  });
});

describe('github_api_autowork output acceptance (fail closed)', () => {
  it('does not apply to unrelated jobs', () => {
    expect(evaluateGithubAutoworkOutput({ ...base, kind: 'github_review', text: fullAnswer })).toMatchObject({
      applicable: false, accepted: false,
    });
  });
  it('rejects empty and short model text before JOB_DONE', () => {
    expect(evaluateGithubAutoworkOutput({ ...base, text: '' }).code).toBe('GITHUB_AUTOWORK_OUTPUT_EMPTY');
    expect(evaluateGithubAutoworkOutput({ ...base, text: 'OK' }).code).toBe('GITHUB_AUTOWORK_OUTPUT_TOO_SHORT');
  });
  it('requires a real worker resource identity', () => {
    expect(evaluateGithubAutoworkOutput({ ...base, resourceId: '', text: fullAnswer }).code).toBe('GITHUB_AUTOWORK_WORKER_UNVERIFIED');
  });
  it('does not accept unstructured one-line repetition as Q01-Q14 evidence', () => {
    const text = 'Q01 Q02 Q03 Q04 Q05 Q06 Q07 Q08 Q09 Q10 Q11 Q12 Q13 Q14 ' + 'no proof '.repeat(12);
    const result = evaluateGithubAutoworkOutput({ ...base, text });
    expect(result.accepted).toBe(false);
    expect(result.code).toBe('GITHUB_AUTOWORK_Q_REPORT_INCOMPLETE');
    expect(result.missingQuestions).toHaveLength(14);
  });
  it('fails when one required Q answer is missing or too short', () => {
    const text = fullAnswer.replace(/Q14:[\s\S]*$/, 'Q14 — chưa rõ');
    const result = evaluateGithubAutoworkOutput({ ...base, text });
    expect(result.accepted).toBe(false);
    expect(result.missingQuestions).toEqual(['Q14']);
  });
  it('rejects an actual 4-of-14 timestamp completeness signature before JOB_DONE', () => {
    const report = fullAnswer.split(/\n(?=Q\d{2}:)/).map((section, index) =>
      [0, 1, 2, 12].includes(index)
        ? section : section.replace('2026-10-24T05:07:51Z', 'UNKNOWN')
    ).join('\n');
    const result = evaluateGithubAutoworkOutput({ ...base, text: report });
    expect(result).toMatchObject({
      accepted: false,
      code: 'GITHUB_AUTOWORK_Q_REPORT_CONTRACT_INCOMPLETE',
      foundQuestionCount: 14,
      questionsWithAllRequiredFields: 4,
    });
    expect(result.missingFields.Q04).toContain('evidenceTimestamp');
    expect(result.missingFields.Q14).toContain('evidenceTimestamp');
    expect(JSON.stringify(result)).not.toContain('Synthetic test fixture');
  });
  it('rejects missing required source report fields even when all 14 Q sections exist', () => {
    const result = evaluateGithubAutoworkOutput({
      ...base, text: fullAnswer.replace('OBSERVATION:', 'FIELD_REMOVED:'),
    });
    expect(result.accepted).toBe(false);
    expect(result.code).toBe('GITHUB_AUTOWORK_Q_REPORT_CONTRACT_INCOMPLETE');
    expect(result.missingFields.Q01).toContain('observation');
  });
  it('blocks JOB_DONE when R04 timestamps and confidence leak from other fields', () => {
    const misplaced=fullAnswer
      .replace('OBSERVATION: Core cần đối chiếu nguồn thật trước khi kết luận.',
        'OBSERVATION: Một ghi chú 2026-10-24T05:07:51Z; nguồn cụ thể chưa được xác minh.')
      .replace('REAL_EVIDENCE_SOURCE_WITH_TIMESTAMP: Synthetic test fixture 2026-10-24T05:07:51Z.',
        'REAL_EVIDENCE_SOURCE_WITH_TIMESTAMP: UNKNOWN')
      .replace('CONFIDENCE: UNKNOWN.', 'CONFIDENCE: không được khai báo giá trị.');
    const result=evaluateGithubAutoworkOutput({...base,text:misplaced});
    expect(result).toMatchObject({
      applicable:true,accepted:false,
      code:'GITHUB_AUTOWORK_Q_REPORT_CONTRACT_INCOMPLETE',
      questionsWithAllRequiredFields:13,
    });
    expect(result.missingFields.Q01).toContain('evidenceTimestamp');
    expect(result.missingFields.Q01).toContain('confidenceValue');
    expect(JSON.stringify(result)).not.toContain('Một ghi chú');
  });
  it('fails closed before JOB_DONE when a present R04 field has no value', () => {
    for (const [original, replacement, missingKey] of [
      ['OBSERVATION: Core cần đối chiếu nguồn thật trước khi kết luận.', 'OBSERVATION: ', 'observation'],
      ['EXPECTED: Có biên nhận thời gian thực và tác nhân thật.', 'EXPECTED: ', 'expected'],
      ['NEXT_ACTION: Đối chiếu nguồn thực, không giả đã nghiệm thu.', 'NEXT_ACTION: <specific factual value or explicit UNKNOWN>', 'nextAction'],
    ]) {
      const text=fullAnswer.replace(original,replacement);
      const result=evaluateGithubAutoworkOutput({...base,text});
      expect(result).toMatchObject({
        applicable:true,accepted:false,
        code:'GITHUB_AUTOWORK_Q_REPORT_CONTRACT_INCOMPLETE',
        foundQuestionCount:14,questionsWithAllRequiredFields:13,
      });
      expect(result.missingFields.Q01).toContain(missingKey);
      expect(result.receipt).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('Core cần đối chiếu');
    }
  });
  it('accepts structured 14-section source output and persists only a digest and provenance', () => {
    const result = evaluateGithubAutoworkOutput({ ...base, text: fullAnswer });
    expect(result).toMatchObject({
      accepted: true, receipt: { questionCount: 14, employeeId: 'NV12', productAccepted: false },
    });
    expect(result.receipt.textSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.receipt)).not.toContain('Quan sát hiện có');
    expect(result.receipt.characterCount).toBe(fullAnswer.length);
  });
  it('accepts a useful ordinary non-R04 answer without a Q01-Q14 template', () => {
    const result = evaluateGithubAutoworkOutput({
      ...base, resourceScope: 'TIGERIQ_CORE_FREE_API_REASONING_E2E_20261023',
      text: 'Kiểm tra nhóm NV11 đang rảnh và đủ hạn mức. Nếu resource đã có lease thì giữ chờ, không vượt khóa, không tạo công việc trùng. Theo dõi đầu ra có biên nhận.',
    });
    expect(result.accepted).toBe(true);
    expect(result.receipt.questionCount).toBe(0);
  });
  it('requires real new output rather than relying on a previous done status', () => {
    const result = evaluateGithubAutoworkOutput({ ...base, text: undefined });
    expect(result.code).toBe('GITHUB_AUTOWORK_OUTPUT_EMPTY');
  });
});
