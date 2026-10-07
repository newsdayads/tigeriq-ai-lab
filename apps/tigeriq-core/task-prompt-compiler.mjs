import { createHash } from 'node:crypto';

export const EXECUTION_PACKET_VERSION = 'EXECUTION_PACKET_V1';
export const EXECUTION_RESULT_VERSION = 'EXECUTION_RESULT_V1';

const DEFAULT_FORBIDDEN = Object.freeze([
  'direct main mutation',
  'production release without an explicit gate',
  'paid action',
  'credential or secret mutation',
  'security-boundary mutation',
  'destructive or irreversible action',
  'App Chrome mutation',
]);

function list(value, fallback = []) {
  const raw = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];
  const cleaned = raw.map(item => String(item ?? '').trim()).filter(Boolean);
  return cleaned.length ? cleaned : [...fallback];
}

function text(value, fallback = '') {
  const out = String(value ?? '').trim();
  return out || fallback;
}

function stableRevision(packet) {
  const source = JSON.stringify({
    taskId: packet.task_id,
    objectiveId: packet.objective_id,
    sourceRevision: packet.source_revision,
    capability: packet.capability,
    skillIds: packet.skill_ids,
    goal: packet.goal,
    contextRefs: packet.context_refs,
    allowedScope: packet.allowed_scope,
    forbiddenActions: packet.forbidden_actions,
    steps: packet.steps,
    acceptance: packet.acceptance,
    evidenceRequired: packet.evidence_required,
    outputSchema: packet.output_schema,
    retryPolicy: packet.retry_policy,
    blockConditions: packet.block_conditions,
  });
  return `pc-v1-${createHash('sha256').update(source).digest('hex').slice(0, 16)}`;
}

export function validateExecutionPacket(packet) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw new Error('EXECUTION_PACKET_INVALID');
  const requiredText = ['task_id','objective_id','source_revision','capability','goal','output_schema','prompt_revision'];
  for (const key of requiredText) if (!text(packet[key])) throw new Error(`EXECUTION_PACKET_MISSING:${key}`);
  const requiredArrays = ['skill_ids','context_refs','allowed_scope','forbidden_actions','steps','acceptance','evidence_required','block_conditions'];
  for (const key of requiredArrays) {
    if (!Array.isArray(packet[key])) throw new Error(`EXECUTION_PACKET_INVALID_ARRAY:${key}`);
  }
  if (!packet.steps.length) throw new Error('EXECUTION_PACKET_STEPS_EMPTY');
  if (!packet.acceptance.length) throw new Error('EXECUTION_PACKET_ACCEPTANCE_EMPTY');
  if (!packet.evidence_required.length) throw new Error('EXECUTION_PACKET_EVIDENCE_EMPTY');
  if (!packet.retry_policy || typeof packet.retry_policy !== 'object' || Array.isArray(packet.retry_policy)) throw new Error('EXECUTION_PACKET_RETRY_POLICY_INVALID');
  return packet;
}

export function buildExecutionPacket(input = {}) {
  const packet = {
    packet_version: EXECUTION_PACKET_VERSION,
    task_id: text(input.taskId || input.task_id),
    objective_id: text(input.objectiveId || input.objective_id),
    source_revision: text(input.sourceRevision || input.source_revision, 'unknown'),
    capability: text(input.capability, 'general'),
    skill_ids: list(input.skillIds || input.skill_ids),
    goal: text(input.goal),
    context_refs: list(input.contextRefs || input.context_refs),
    allowed_scope: list(input.allowedScope || input.allowed_scope, ['read/use only the task context and explicitly authorized scope']),
    forbidden_actions: list(input.forbiddenActions || input.forbidden_actions, DEFAULT_FORBIDDEN),
    steps: list(input.steps, input.goal ? [String(input.goal)] : []),
    acceptance: list(input.acceptance, ['Produce a concrete result that directly satisfies the stated goal.']),
    evidence_required: list(input.evidenceRequired || input.evidence_required, ['At least one concrete evidence item supporting the claimed result.']),
    output_schema: text(input.outputSchema || input.output_schema, EXECUTION_RESULT_VERSION),
    retry_policy: input.retryPolicy || input.retry_policy || { max_output_retries: 1, failover_on_invalid_output: true },
    block_conditions: list(input.blockConditions || input.block_conditions, [
      'required credential or secret is unavailable',
      'paid action is required',
      'security-boundary change is required',
      'destructive or irreversible action is required',
      'authorized scope is insufficient',
    ]),
    prompt_revision: '',
  };
  packet.prompt_revision = text(input.promptRevision || input.prompt_revision) || stableRevision(packet);
  return validateExecutionPacket(packet);
}

function numbered(title, values) {
  return [title, ...values.map((value, index) => `${index + 1}. ${value}`)].join('\n');
}

export function compileTaskPrompt(input = {}) {
  const packet = buildExecutionPacket(input);
  const prompt = [
    'You are a TigerIQ execution worker. Execute exactly the authorized task packet below.',
    'Do not broaden scope. Do not infer permission from missing fields. Evidence is mandatory.',
    '',
    `PACKET_VERSION: ${packet.packet_version}`,
    `TASK_ID: ${packet.task_id}`,
    `OBJECTIVE_ID: ${packet.objective_id}`,
    `SOURCE_REVISION: ${packet.source_revision}`,
    `PROMPT_REVISION: ${packet.prompt_revision}`,
    `CAPABILITY: ${packet.capability}`,
    `SKILLS: ${packet.skill_ids.length ? packet.skill_ids.join(', ') : 'none'}`,
    '',
    `GOAL:\n${packet.goal}`,
    '',
    numbered('CONTEXT_REFS:', packet.context_refs.length ? packet.context_refs : ['none']),
    '',
    numbered('ALLOWED_SCOPE:', packet.allowed_scope),
    '',
    numbered('FORBIDDEN_ACTIONS:', packet.forbidden_actions),
    '',
    numbered('STEPS:', packet.steps),
    '',
    numbered('ACCEPTANCE:', packet.acceptance),
    '',
    numbered('EVIDENCE_REQUIRED:', packet.evidence_required),
    '',
    numbered('BLOCK_CONDITIONS:', packet.block_conditions),
    '',
    'OUTPUT REQUIREMENT:',
    'Return exactly one JSON object and nothing else. No markdown fences.',
    `Schema ${EXECUTION_RESULT_VERSION}: {"schema":"EXECUTION_RESULT_V1","status":"complete|blocked","summary":"short factual summary","acceptance":[{"criterion":"acceptance criterion text","passed":true|false,"evidence_refs":["evidence id"]}],"evidence":[{"id":"e1","type":"observation|artifact|test|source","value":"concrete evidence"}],"block_reason":null|string}`,
    'Every acceptance criterion in the packet must appear once in acceptance[].',
    'A complete result requires all criteria passed=true and each passed criterion must cite at least one evidence id present in evidence[].',
    'If any criterion cannot be proven, return status=blocked and explain the exact block_reason.',
  ].join('\n');
  return { packet, prompt };
}

function stripFence(raw) {
  return String(raw || '').trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '').trim();
}

export function parseExecutionResult(raw) {
  let value;
  try { value = JSON.parse(stripFence(raw)); }
  catch (error) {
    const wrapped = new Error('EXECUTION_RESULT_JSON_INVALID');
    wrapped.kind = 'invalid_response';
    wrapped.cause = error;
    throw wrapped;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('EXECUTION_RESULT_INVALID'), { kind:'invalid_response' });
  return value;
}

export function executionResultGate(raw, packetInput) {
  const packet = validateExecutionPacket(packetInput?.packet_version ? packetInput : buildExecutionPacket(packetInput));
  let result;
  try { result = typeof raw === 'string' ? parseExecutionResult(raw) : raw; }
  catch (error) { return { pass:false, code:error.message, result:null, missing:packet.acceptance, evidenceIds:[] }; }

  if (result?.schema !== EXECUTION_RESULT_VERSION) return { pass:false, code:'EXECUTION_RESULT_SCHEMA_INVALID', result, missing:packet.acceptance, evidenceIds:[] };
  if (!['complete','blocked'].includes(result?.status)) return { pass:false, code:'EXECUTION_RESULT_STATUS_INVALID', result, missing:packet.acceptance, evidenceIds:[] };
  if (!Array.isArray(result?.acceptance) || !Array.isArray(result?.evidence)) return { pass:false, code:'EXECUTION_RESULT_EVIDENCE_MISSING', result, missing:packet.acceptance, evidenceIds:[] };

  const evidenceIds = new Set(result.evidence.map(item => text(item?.id)).filter(Boolean));
  const claimed = new Map(result.acceptance.map(item => [text(item?.criterion), item]));
  const missing = packet.acceptance.filter(criterion => !claimed.has(criterion));
  if (missing.length) return { pass:false, code:'EXECUTION_ACCEPTANCE_MISSING', result, missing, evidenceIds:[...evidenceIds] };

  const failed = [];
  for (const criterion of packet.acceptance) {
    const item = claimed.get(criterion);
    const refs = list(item?.evidence_refs);
    const refsValid = refs.length > 0 && refs.every(ref => evidenceIds.has(ref));
    if (item?.passed !== true || !refsValid) failed.push(criterion);
  }

  if (result.status !== 'complete') return { pass:false, code:'EXECUTION_RESULT_BLOCKED', result, missing:failed, evidenceIds:[...evidenceIds] };
  if (!result.evidence.length || !evidenceIds.size) return { pass:false, code:'EXECUTION_EVIDENCE_EMPTY', result, missing:packet.acceptance, evidenceIds:[] };
  if (failed.length) return { pass:false, code:'EXECUTION_ACCEPTANCE_NOT_PROVEN', result, missing:failed, evidenceIds:[...evidenceIds] };

  return { pass:true, code:'EXECUTION_ACCEPTED', result, missing:[], evidenceIds:[...evidenceIds] };
}

export function strictExecutionRetryPrompt(compiledPrompt, gate) {
  const code = text(gate?.code, 'EXECUTION_RESULT_INVALID');
  return `${String(compiledPrompt || '').trim()}\n\nSTRICT RETRY: the previous output failed the deterministic acceptance gate with ${code}. Return one corrected ${EXECUTION_RESULT_VERSION} JSON object only. Do not claim complete unless every acceptance criterion is proven by evidence_refs.`;
}
