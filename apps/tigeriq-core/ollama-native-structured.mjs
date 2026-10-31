// Isolated Core #4457 staging adapter; not wired into Core or Production.
// Snapshot dependency ./task-prompt-compiler.mjs was copied byte-for-byte from PC01 main.
import { validateExecutionPacket, executionPacketFromPrompt, executionResultGate } from './task-prompt-compiler.mjs';

const LOCAL_ENDPOINT = 'http://127.0.0.1:11434/api/chat';
const RESULT_VERSION = 'EXECUTION_RESULT_V1';

function contractError(code, kind = 'invalid_response') {
  return Object.assign(new Error(code), { code, kind });
}

export function structuredExecutionSchema(packetInput) {
  const packet = validateExecutionPacket(packetInput);
  if (packet.output_schema !== RESULT_VERSION) throw contractError('LOCAL_SCHEMA_VERSION_UNSUPPORTED');
  if (packet.acceptance.length < 1 || packet.acceptance.length > 8) throw contractError('LOCAL_ACCEPTANCE_COUNT_UNSUPPORTED');
  if (new Set(packet.acceptance).size !== packet.acceptance.length) throw contractError('LOCAL_ACCEPTANCE_DUPLICATED');

  // Immutable criterion literals: do not let the model paraphrase criteria.
  const criterion = value => ({
    type: 'object',
    properties: {
      criterion: { const: value },
      passed: { type: 'boolean' },
      evidence_refs: { type: 'array', items: { type: 'string' }, minItems: 1 },
    },
    required: ['criterion', 'passed', 'evidence_refs'],
    additionalProperties: false,
  });

  return {
    type: 'object',
    properties: {
      schema: { const: RESULT_VERSION },
      status: { enum: ['complete', 'blocked'] },
      summary: { type: 'string' },
      acceptance: {
        type: 'array',
        prefixItems: packet.acceptance.map(criterion),
        minItems: packet.acceptance.length,
        maxItems: packet.acceptance.length,
      },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { enum: ['observation', 'artifact', 'test', 'source'] },
            value: { type: 'string' },
          },
          required: ['id', 'type', 'value'],
          additionalProperties: false,
        },
        minItems: 1,
      },
      block_reason: { type: ['null', 'string'] },
    },
    required: ['schema', 'status', 'summary', 'acceptance', 'evidence', 'block_reason'],
    additionalProperties: false,
  };
}


export function compactStructuredExecutionSchema(packetInput) {
  const packet = validateExecutionPacket(packetInput);
  if (packet.output_schema !== RESULT_VERSION) throw contractError('LOCAL_SCHEMA_VERSION_UNSUPPORTED');
  if (packet.acceptance.length < 1 || packet.acceptance.length > 8) throw contractError('LOCAL_ACCEPTANCE_COUNT_UNSUPPORTED');
  if (new Set(packet.acceptance).size !== packet.acceptance.length) throw contractError('LOCAL_ACCEPTANCE_DUPLICATED');

  const criterion = index => ({
    type: 'object',
    properties: {
      criterion_index: { const: index },
      passed: { type: 'boolean' },
      evidence_refs: { type: 'array', items: { type: 'string', maxLength: 32 }, minItems: 1, maxItems: 4 },
    },
    required: ['criterion_index', 'passed', 'evidence_refs'],
    additionalProperties: false,
  });

  return {
    type: 'object',
    properties: {
      schema: { const: RESULT_VERSION },
      status: { enum: ['complete', 'blocked'] },
      summary: { type: 'string', maxLength: 180 },
      acceptance: {
        type: 'array',
        prefixItems: packet.acceptance.map((_, index) => criterion(index)),
        minItems: packet.acceptance.length,
        maxItems: packet.acceptance.length,
      },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', maxLength: 32 },
            type: { enum: ['observation', 'artifact', 'test', 'source'] },
            value: { type: 'string', maxLength: 220 },
          },
          required: ['id', 'type', 'value'],
          additionalProperties: false,
        },
        minItems: 1,
        maxItems: 6,
      },
      block_reason: { type: ['null', 'string'], maxLength: 220 },
    },
    required: ['schema', 'status', 'summary', 'acceptance', 'evidence', 'block_reason'],
    additionalProperties: false,
  };
}

export function buildNativeExecutionRequest({ packet, prompt, model = 'gemma3:4b', numPredict = 512, compact = false }) {
  if (model !== 'gemma3:4b') throw contractError('LOCAL_MODEL_NOT_ALLOWLISTED', 'configuration');
  const parsed = executionPacketFromPrompt(prompt);
  // Verify binding to one exact source packet before sending text to the worker.
  if (JSON.stringify(parsed) !== JSON.stringify(validateExecutionPacket(packet))) {
    throw contractError('LOCAL_PACKET_PROMPT_MISMATCH', 'security');
  }
  if (!Number.isInteger(numPredict) || numPredict < 64 || numPredict > 512) {
    throw contractError('LOCAL_OUTPUT_TOKEN_BUDGET_INVALID', 'configuration');
  }
  return {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    format: compact ? compactStructuredExecutionSchema(packet) : structuredExecutionSchema(packet),
    options: { temperature: 0, num_predict: numPredict },
  };
}

// Call only on an approved isolated surface. Never create Core objectives or mark
// workers successful here. Core's deterministic gate remains authoritative.
export async function invokeNativeStructuredExecution({
  packet, prompt, model = 'gemma3:4b', numPredict = 512, compact = false,
  timeoutMs = 85000, fetchImpl = fetch,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 90000) {
    throw contractError('LOCAL_TIMEOUT_BUDGET_INVALID', 'configuration');
  }
  const body = buildNativeExecutionRequest({ packet, prompt, model, numPredict, compact });
  const start = Date.now();
  let response;
  try {
    response = await fetchImpl(LOCAL_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      const timeout = contractError('LOCAL_PROVIDER_TIMEOUT', 'timeout');
      timeout.cause = error;
      throw timeout;
    }
    throw error;
  }
  if (!response?.ok) throw contractError('LOCAL_PROVIDER_HTTP_FAILURE', 'outage');
  const result = await response.json();
  if (result?.done !== true || result?.done_reason !== 'stop') {
    throw contractError('LOCAL_PROVIDER_INCOMPLETE', 'invalid_response');
  }
  const content = result?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw contractError('LOCAL_PROVIDER_EMPTY', 'invalid_response');
  }
  const gate = executionResultGate(content, packet);
  if (!gate.pass) throw contractError(gate.code, 'invalid_response');
  // Reject obviously corrupt summaries even when acceptance evidence is self-referenced.
  const summary = String(gate.result?.summary ?? '').trim();
  if (summary.length < 12 || !/\p{L}{3}/u.test(summary)) {
    throw contractError('LOCAL_RESULT_SUMMARY_INVALID', 'invalid_response');
  }
  return {
    text: content,
    gate,
    model,
    latencyMs: Date.now() - start,
    evalCount: Number.isFinite(result.eval_count) ? result.eval_count : null,
    promptEvalCount: Number.isFinite(result.prompt_eval_count) ? result.prompt_eval_count : null,
    // No model prompt or model output in logs beyond this returned contract payload.
  };
}
