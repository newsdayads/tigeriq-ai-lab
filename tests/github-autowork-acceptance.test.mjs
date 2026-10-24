import { describe, expect, it } from 'vitest';
import { evaluateGithubAutoworkOutput } from '../apps/tigeriq-core/github-autowork-acceptance.mjs';

const base = {
  kind: 'github_api_autowork',
  employeeId: 'NV12',
  resourceId: 'res:gemini:gemini-3.5-flash-lite:default:core',
  resourceScope: 'TIGERIQ_CORE_NATIVE_R04_Q01_Q14_5144_20261023',
};
const fullAnswer = Array.from({ length: 14 }, (_, i) => {
  const id = 'Q' + String(i + 1).padStart(2, '0');
  return id + ' — Quan sát hiện có cần đối chiếu với biên nhận thời gian thực; kết luận chưa nghiệm thu.';
}).join('\n');

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
    const text = fullAnswer.replace(/Q14[^\n]*/, 'Q14 — chưa rõ');
    const result = evaluateGithubAutoworkOutput({ ...base, text });
    expect(result.accepted).toBe(false);
    expect(result.missingQuestions).toEqual(['Q14']);
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
