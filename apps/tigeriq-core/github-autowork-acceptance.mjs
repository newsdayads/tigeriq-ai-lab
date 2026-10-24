import { createHash } from 'node:crypto';
import { nativeR04ReportContractAudit } from './public-evidence.mjs';

const R04_Q01_Q14_SCOPE = /^TIGERIQ_CORE_NATIVE_R04_Q01_Q14_5144(?:_|$)/i;
const REQUIRED_QUESTION_IDS = Object.freeze(Array.from({ length: 14 }, (_, index) => 'Q' + String(index + 1).padStart(2, '0')));
const MIN_SUBSTANTIVE_CHARS = 80;
const MIN_QUESTION_ANSWER_CHARS = 16;

const R04_REPORT_FIELDS = Object.freeze([
  'OBSERVATION', 'REAL_EVIDENCE_SOURCE_WITH_TIMESTAMP', 'EXPECTED',
  'DEVIATION', 'CONFIDENCE', 'NEXT_ACTION',
]);

/**
 * Add a compact per-question evidence template only to canonical R04 native
 * inference. A stricter output guard alone cannot make a model cite sources.
 * This helper does not dispatch jobs, change retry budgets or claim acceptance.
 */
export function reinforceGithubAutoworkPrompt({ kind = '', resourceScope = '', prompt = '' } = {}) {
  const original = typeof prompt === 'string' ? prompt : '';
  if (kind !== 'github_api_autowork' || !R04_Q01_Q14_SCOPE.test(String(resourceScope))) return original;
  const sections = REQUIRED_QUESTION_IDS.map(id =>
    [`${id}:`, ...R04_REPORT_FIELDS.map(field => `${field}: <specific factual value or explicit UNKNOWN>`)].join('\n')
  ).join('\n\n');
  return [
    original,
    '',
    '[NATIVE R04 REPORT OUTPUT CONTRACT — REQUIRED, SOURCE FIRST]',
    'Return exactly Q01 through Q14, each with six individually filled fields in the form below.',
    'REAL_EVIDENCE_SOURCE_WITH_TIMESTAMP must identify the actual source and its observed timestamp',
    '(for example an observed Core API response time or a linked GitHub run time).',
    'Do not reuse an unrelated timestamp, completion time or current date as source evidence.',
    'Do not invent sources, timestamps, employee IDs, claims, leases, or CI results.',
    'If a source or timestamp was not actually observed, write UNKNOWN and explain the blocker.',
    'UNKNOWN is safer than fabricating evidence; incomplete reports are not accepted as JOB_DONE.',
    'Use CONFIDENCE only HIGH, MEDIUM, LOW or UNKNOWN and distinguish OBSERVATION from inference.',
    'Use actual source evidence in the same Q section; do not reference evidence in another Q.',
    sections,
  ].join('\n');
}

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
      if (content.length >= MIN_QUESTION_ANSWER_CHARS && !/^Q(?:0[1-9]|1[0-4])\b/i.test(content)) sections.set(id, true);
    }
    for (const id of requiredQuestions) if (!sections.has(id)) missingQuestions.push(id);
  }
  if (missingQuestions.length)
    return { applicable: true, accepted: false, code: 'GITHUB_AUTOWORK_Q_REPORT_INCOMPLETE', missingQuestions };

  // For the canonical R04 job, fourteen headings alone are not enough.
  // Require each question's source/timestamp, expectation, deviation,
  // confidence and next action BEFORE the Core records JOB_DONE.
  // This is a structural check, never independent factual acceptance.
  if (requiredQuestions.length) {
    const audit = nativeR04ReportContractAudit(answer);
    if (!audit.structuralPass) {
      return {
        applicable: true, accepted: false,
        code: 'GITHUB_AUTOWORK_Q_REPORT_CONTRACT_INCOMPLETE',
        foundQuestionCount: audit.foundQuestionCount,
        questionsWithAllRequiredFields: audit.questionsWithAllRequiredFields,
        missingQuestions: audit.missingQuestions,
        missingFields: audit.missingFields,
      };
    }
  }

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
