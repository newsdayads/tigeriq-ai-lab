import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTaskPrompt } from '../apps/tigeriq-core/task-prompt-compiler.mjs';
import { structuredExecutionSchema, compactStructuredExecutionSchema, buildNativeExecutionRequest, invokeNativeStructuredExecution } from '../apps/tigeriq-core/ollama-native-structured.mjs';

const criteria = [
  'The summary reports CODE=READY from the synthetic fixture.',
  'The summary reports COUNT=2 from the synthetic fixture.',
  'The summary reports POLICY=READ_ONLY from the synthetic fixture.',
];
const fixture = () => compileTaskPrompt({
  taskId: 'CORE4457-SYNTHETIC-ONLY',
  objectiveId: 'NOT-A-CORE-OBJECTIVE',
  sourceRevision: 'mock-20261011',
  capability: 'general',
  goal: 'Read synthetic fixture CODE=READY COUNT=2 POLICY=READ_ONLY; no external action.',
  allowedScope: ['Read only synthetic fixture'],
  contextRefs: ['inline fixture, no real business data'],
  steps: ['Read fixture fields', 'Produce schema result'],
  acceptance: criteria,
  evidenceRequired: ['Inline synthetic fixture evidence'],
});
function goodResult(packet) {
  return {
    schema: 'EXECUTION_RESULT_V1', status: 'complete',
    summary: 'CODE=READY COUNT=2 POLICY=READ_ONLY in fake test fixture',
    acceptance: packet.acceptance.map(criterion => ({ criterion, passed: true, evidence_refs: ['synthetic-1'] })),
    evidence: [{ id: 'synthetic-1', type: 'test', value: 'synthetic fixture only' }],
    block_reason: null,
  };
}
function mockProvider(message, meta = {}) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: meta.httpOk ?? true,
        json: async () => ({
          done: meta.done ?? true,
          done_reason: meta.reason ?? 'stop',
          message: { content: typeof message === 'string' ? message : JSON.stringify(message) },
          eval_count: 19, prompt_eval_count: 150,
        }),
      };
    },
  };
}
test('schema pins every ordered criterion verbatim and denies extra acceptance slots', () => {
  const { packet } = fixture(), schema = structuredExecutionSchema(packet);
  assert.equal(schema.properties.acceptance.minItems, 3);
  assert.equal(schema.properties.acceptance.maxItems, 3);
  assert.deepEqual(schema.properties.acceptance.prefixItems.map(x => x.properties.criterion.const), criteria);
  assert.equal(schema.properties.schema.const, 'EXECUTION_RESULT_V1');
});
test('compact schema replaces verbose criterion literals with stable indexes', () => {
  const { packet } = fixture(), schema = compactStructuredExecutionSchema(packet);
  assert.deepEqual(schema.properties.acceptance.prefixItems.map(x => x.properties.criterion_index.const), [0,1,2]);
  assert.equal(schema.properties.acceptance.minItems, 3);
  assert.equal(schema.properties.acceptance.maxItems, 3);
  assert.equal(schema.properties.summary.maxLength, 180);
  assert.equal(schema.properties.evidence.maxItems, 6);
});
test('native request stays loopback-only with a finite budget and a bound packet', () => {
  const { packet, prompt } = fixture(), body = buildNativeExecutionRequest({ packet, prompt });
  assert.equal(body.model, 'gemma3:4b');
  assert.equal(body.messages[0].content, prompt);
  assert.equal(body.options.num_predict, 512);
  assert.equal(body.stream, false);
  assert.deepEqual(body.format.properties.acceptance.prefixItems.map(x => x.properties.criterion.const), criteria);
});
test('rejects prompt paired with a different source packet', () => {
  const { packet, prompt } = fixture();
  const altered = { ...packet, goal: 'tampered' };
  assert.throws(() => buildNativeExecutionRequest({ packet: altered, prompt }), /LOCAL_PACKET_PROMPT_MISMATCH/);
});
test('denies other models until separately validated', () => {
  const { packet, prompt } = fixture();
  assert.throws(() => buildNativeExecutionRequest({ packet, prompt, model: 'qwen3:4b' }), /LOCAL_MODEL_NOT_ALLOWLISTED/);
});
test('rejects unbounded token budget and oversized timeout', async () => {
  const { packet, prompt } = fixture();
  assert.throws(() => buildNativeExecutionRequest({ packet, prompt, numPredict: 2048 }), /LOCAL_OUTPUT_TOKEN_BUDGET_INVALID/);
  await assert.rejects(invokeNativeStructuredExecution({ packet, prompt, timeoutMs: 120000 }), /LOCAL_TIMEOUT_BUDGET_INVALID/);
});
test('rejects repeated acceptance criteria before an API request', () => {
  const { packet } = fixture();
  assert.throws(() => structuredExecutionSchema({ ...packet, acceptance: [criteria[0], criteria[0]] }), /LOCAL_ACCEPTANCE_DUPLICATED/);
});
test('passes genuine deterministic gate for mock 3/3 with referenced test evidence', async () => {
  const { packet, prompt } = fixture();
  const provider = mockProvider(goodResult(packet));
  const result = await invokeNativeStructuredExecution({ packet, prompt, fetchImpl: provider.fetchImpl });
  assert.equal(result.gate.pass, true);
  assert.equal(result.gate.code, 'EXECUTION_ACCEPTED');
  assert.equal(result.gate.evidenceIds.length, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].url, 'http://127.0.0.1:11434/api/chat');
  assert.ok(provider.calls[0].init.signal);
});
test('paraphrased criterion must fail exact contract even if JSON is valid', async () => {
  const { packet, prompt } = fixture();
  const invalid = goodResult(packet);
  invalid.acceptance[0].criterion = 'CODE is READY';
  const provider = mockProvider(invalid);
  await assert.rejects(invokeNativeStructuredExecution({ packet, prompt, fetchImpl: provider.fetchImpl }), /EXECUTION_ACCEPTANCE_MISSING/);
});
test('missing evidence reference must fail closed', async () => {
  const { packet, prompt } = fixture();
  const invalid = goodResult(packet);
  invalid.acceptance[0].evidence_refs = ['nonexistent'];
  await assert.rejects(invokeNativeStructuredExecution({ packet, prompt, fetchImpl: mockProvider(invalid).fetchImpl }), /EXECUTION_ACCEPTANCE_NOT_PROVEN/);
});
test('blocked model output must never be reported as a complete result', async () => {
  const { packet, prompt } = fixture();
  const invalid = goodResult(packet);
  invalid.status = 'blocked'; invalid.block_reason = 'insufficient evidence';
  await assert.rejects(invokeNativeStructuredExecution({ packet, prompt, fetchImpl: mockProvider(invalid).fetchImpl }), /EXECUTION_RESULT_BLOCKED/);
});
test('malformed JSON must fail closed', async () => {
  const { packet, prompt } = fixture();
  await assert.rejects(invokeNativeStructuredExecution({ packet, prompt, fetchImpl: mockProvider('{truncated').fetchImpl }), /EXECUTION_RESULT_JSON_INVALID/);
});
test('provider length truncation is rejected before claiming acceptance', async () => {
  const { packet, prompt } = fixture();
  await assert.rejects(invokeNativeStructuredExecution({ packet, prompt, fetchImpl: mockProvider(goodResult(packet), {reason:'length'}).fetchImpl }), /LOCAL_PROVIDER_INCOMPLETE/);
});
test('provider HTTP failure and incomplete response are rejected', async () => {
  const { packet, prompt } = fixture();
  await assert.rejects(invokeNativeStructuredExecution({ packet, prompt, fetchImpl: mockProvider(goodResult(packet), {httpOk:false}).fetchImpl }), /LOCAL_PROVIDER_HTTP_FAILURE/);
  await assert.rejects(invokeNativeStructuredExecution({ packet, prompt, fetchImpl: mockProvider(goodResult(packet), {done:false}).fetchImpl }), /LOCAL_PROVIDER_INCOMPLETE/);
});
test('response schema and status cannot be spoofed', async () => {
  const { packet, prompt } = fixture();
  const invalid = goodResult(packet);
  invalid.schema = 'EXECUTION_RESULT_V2';
  await assert.rejects(invokeNativeStructuredExecution({ packet, prompt, fetchImpl: mockProvider(invalid).fetchImpl }), /EXECUTION_RESULT_SCHEMA_INVALID/);
});

test('local structured result rejects non-factual summary even with accepted criteria', async () => {
  const { packet, prompt } = fixture();
  const invalid = goodResult(packet);
  invalid.summary = '\":[{';
  await assert.rejects(
    invokeNativeStructuredExecution({ packet, prompt, fetchImpl: mockProvider(invalid).fetchImpl }),
    /LOCAL_RESULT_SUMMARY_INVALID/,
  );
});

test('timeout errors are classified as timeout for bounded router failure policy', async () => {
  const { packet, prompt } = fixture();
  const mockTimedOut = async () => {
    throw Object.assign(new Error('synthetic deadline'), { name: 'TimeoutError' });
  };
  await assert.rejects(
    invokeNativeStructuredExecution({ packet, prompt, fetchImpl: mockTimedOut }),
    error => error.code === 'LOCAL_PROVIDER_TIMEOUT' && error.kind === 'timeout',
  );
});
test('AbortError uses timeout classification without swallowing unrelated errors', async () => {
  const { packet, prompt } = fixture();
  await assert.rejects(
    invokeNativeStructuredExecution({ packet, prompt, fetchImpl: async () => {
      throw Object.assign(new Error('synthetic abort'), { name: 'AbortError' });
    }}),
    error => error.code === 'LOCAL_PROVIDER_TIMEOUT' && error.kind === 'timeout',
  );
  await assert.rejects(
    invokeNativeStructuredExecution({ packet, prompt, fetchImpl: async () => {
      throw Object.assign(new Error('synthetic security failure'), { kind:'security' });
    }}),
    error => error.kind === 'security',
  );
});
