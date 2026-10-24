import { createHash } from 'node:crypto';

const R04_Q01_Q14_SCOPE = /^TIGERIQ_CORE_NATIVE_R04_Q01_Q14_5144(?:_|$)/i;
const REQUIRED_QUESTION_IDS = Object.freeze(Array.from({ length: 14 }, (_, index) => 'Q' + String(index + 1).padStart(2, '0')));
const MIN_SUBSTANTIVE_CHARS = 80;
const MIN_QUESTION_ANSWER_CHARS = 16;

/**
 * Source quality gate, not an owner/product acceptance receipt. Never publish
 * the model's response or claim an independently verified Q01-Q14 finding.
 */
export function evaluateGithubAutoworkOutput({
  kind = '', text = '', resourceScope = '', employeeId = '', resourceId = '',
} = {}) {
  if (kind !== 'github_api_autowork') return { applicable: false, accepted: false, code: 'NOT_GITHUB_AUTOWORK' };
  const answer = typeof text === 'string' ? text.trim() : '';
  if (!employeeId || !resourceId) return { applicable: true, accepted: false, code: 'GITHUB_AUTOWORK_WORKER_UNVERIFIED' };
  if (!answer) return { applicable: true, accepted: false, code: 'GITHUB_AUTOWORK_OUTPUT_EMPTY' };
  if (answer.length < MIN_SUBSTANTIVE_CHARS)
    return { applicable: true, accepted: false, code: 'GITHUB_AUTOWORK_OUTPUT_TOO_SHORT' };

  const requiredQuestions = R04_Q01_Q14_SCOPE.test(String(resourceScope)) ? REQUIRED_QUESTION_IDS : [];
  const missingQuestions = [];
  if (requiredQuestions.length) {
    const markers = [...answer.matchAll(/(?:^|\n)\s*(?:\d{1,2}[.)]\s*)?(?:[-*]\s*)?(?:#{1,6}\s*)?(?:\*{1,2})?(Q(?:0[1-9]|1[0-4]))\b(?:\*{1,2})?\s*[:\u2013\u2014-]?\s*/gi)];
    const sections = new Map();
    for (let i = 0; i < markers.length; i++) {
      const id = String(markers[i][1]).toUpperCase();
      const from = markers[i].index + markers[i][0].length;
      const until = i + 1 < markers.length ? markers[i + 1].index : answer.length;
      const content = answer.slice(from, until).trim().replace(/^[:\u2013\u2014-]\s*/, '');
      if (content.length >= MIN_QUESTION_ANSWER_CHARS) sections.set(id, true);
    }
    for (const id of requiredQuestions) if (!sections.has(id)) missingQuestions.push(id);
  }
  if (missingQuestions.length)
    return { applicable: true, accepted: false, code: 'GITHUB_AUTOWORK_Q_REPORT_INCOMPLETE', missingQuestions };

  return {
    applicable: true, accepted: true, code: 'GITHUB_AUTOWORK_SOURCE_OUTPUT_ACCEPTED',
    receipt: {
      code: 'GITHUB_AUTOWORK_SOURCE_OUTPUT_ACCEPTED',
      textSha256: createHash('sha256').update(answer).digest('hex'),
      characterCount: answer.length,
      questionCount: requiredQuestions.length,
      resourceScope: String(resourceScope).slice(0, 160),
      employeeId: String(employeeId).slice(0, 24),
      // A digest of model output is not independent product acceptance.
      productAccepted: false,
    },
  };
}
