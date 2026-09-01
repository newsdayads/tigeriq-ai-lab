import { createHmac, timingSafeEqual } from 'node:crypto';
import { getVercelOidcToken } from '@vercel/oidc';

const VERCEL_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const GROQ_GATEWAY_URL = 'https://api.groq.com/openai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_TEXT = 8_000;

function clean(value, max = MAX_TEXT) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function gateSecret() {
  return String(process.env.TIGERIQ_GATE_ATTESTATION_SECRET || process.env.TIGERIQ_OWNER_SESSION_SECRET || '').trim();
}

function canonicalGateBody(body) {
  return String(body || '')
    .split(/\r?\n/)
    .filter((line) => !/^GATE_ATTESTATION\s+/i.test(line.trim()))
    .join('\n')
    .trim();
}

function gateSignature(body) {
  const secret = gateSecret();
  if (!secret) return '';
  return createHmac('sha256', secret)
    .update(`tigeriq-server-gate-v1\n${canonicalGateBody(body)}`)
    .digest('base64url');
}

export function signServerGateComment(body) {
  if (!gateSecret()) throw new Error('gate_attestation_secret_unavailable');
  const marked = `${canonicalGateBody(body)}\nTIGERIQ_SERVER_GATE_V1`;
  return `${marked}\nGATE_ATTESTATION ${gateSignature(marked)}`;
}

export function verifyServerGateComment(body) {
  const secret = gateSecret();
  if (!secret) return false;
  const lines = String(body || '').split(/\r?\n/);
  if (!lines.some((line) => line.trim() === 'TIGERIQ_SERVER_GATE_V1')) return false;
  const signatures = lines
    .map((line) => line.trim().match(/^GATE_ATTESTATION\s+([A-Za-z0-9_-]{32,128})$/i)?.[1] || '')
    .filter(Boolean);
  if (signatures.length !== 1) return false;
  return safeEqual(gateSignature(body), signatures[0]);
}

function aiProvider() {
  const explicit = String(process.env.TIGERIQ_AI_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'groq' || explicit === 'vercel') return explicit;
  if (String(process.env.GROQ_API_KEY || '').trim()) return 'groq';
  if (String(process.env.AI_GATEWAY_API_KEY || '').trim()) return 'vercel';
  return 'groq';
}

function roleModel(role) {
  const key = `TIGERIQ_${String(role || '').toUpperCase()}_MODEL`;
  const configured = String(process.env[key] || '').trim();
  if (configured) return configured;
  if (aiProvider() === 'groq') {
    if (role === 'reviewer') return 'qwen/qwen3.8-27b';
    if (role === 'judge') return 'openai/gpt-oss-20b';
    return 'openai/gpt-oss-120b';
  }
  if (role === 'reviewer') return 'openai/gpt-5.6-sol';
  return 'google/gemini-3.6-flash';
}

export function cloudExecutorEnabled() {
  const mode = String(process.env.TIGERIQ_CLOUD_EXECUTOR || '').trim().toLowerCase();
  if (mode === 'off' || mode === '0' || mode === 'false') return false;
  if (mode === 'on' || mode === '1' || mode === 'true') return true;
  return String(process.env.VERCEL || '') === '1';
}

export function cloudWorkforceDescriptor() {
  const provider = aiProvider();
  return {
    enabled: cloudExecutorEnabled(),
    runtime: 'vercel-serverless',
    gateway: provider === 'groq' ? 'groq-free-tier-api' : 'vercel-ai-gateway',
    pc01Required: false,
    executorModel: roleModel('executor'),
    reviewerModel: roleModel('reviewer'),
    judgeModel: roleModel('judge'),
    safeScope: 'non-mutating-cloud-task-v1',
  };
}

async function providerCredential(provider) {
  if (provider === 'groq') return String(process.env.GROQ_API_KEY || '').trim();
  const explicit = String(process.env.AI_GATEWAY_API_KEY || '').trim();
  if (explicit) return explicit;
  if (String(process.env.TIGERIQ_AI_PROVIDER || '').trim().toLowerCase() !== 'vercel') return '';
  try {
    return String((await getVercelOidcToken()) || '').trim();
  } catch {
    return '';
  }
}

function parseJsonContent(value, errorName) {
  const raw = clean(value, 20_000);
  try {
    return JSON.parse(raw);
  } catch {
    const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try { return JSON.parse(unfenced); } catch {
      const error = new Error(errorName);
      error.status = 502;
      throw error;
    }
  }
}

async function gatewayJson({ model, system, payload, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const provider = aiProvider();
  const credential = await providerCredential(provider);
  if (!credential) {
    const error = new Error(provider === 'groq' ? 'groq_authorization_unavailable' : 'ai_gateway_authorization_unavailable');
    error.status = 503;
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(provider === 'groq' ? GROQ_GATEWAY_URL : VERCEL_GATEWAY_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential}`,
        'content-type': 'application/json',
        'x-title': 'TigerIQ Cloud Workforce',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1600,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
    if (!response.ok) {
      const error = new Error(`${provider === 'groq' ? 'groq_api' : 'ai_gateway'}_${response.status}`);
      error.status = response.status === 401 || response.status === 403 ? 503 : 502;
      error.details = data?.error?.message || data?.message || 'Cloud AI request failed';
      throw error;
    }
    const content = data?.choices?.[0]?.message?.content;
    return {
      value: parseJsonContent(content, 'cloud_workforce_invalid_json'),
      modelUsed: String(data?.model || model),
      providerUsed: String(data?.provider || data?.provider_name || provider),
      usage: data?.usage || null,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('cloud_ai_timeout');
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const EXECUTOR_SYSTEM = `You are the bounded TigerIQ cloud Executor. Execute only tasks that can be completed safely from the instruction and your model reasoning in this request. You have NO browser, shell, repository mutation, device, payment, messaging, deployment, or external-state tools. Never claim an external action, fresh lookup, test, deployment, file edit, or side effect happened unless the supplied input itself proves it. If the task requires unavailable tools, credentials, current external data, irreversible action, or a repository/device mutation, return status="blocked" and explain exactly what capability is missing. For tasks you can actually complete (analysis, drafting, classification, transformation, deterministic reasoning), return status="completed" with a concrete result and a concise evidenceSummary describing the output evidence. Return JSON only: {"status":"completed|blocked","result":"...","evidenceSummary":"...","blocker":"..."}.`;

const REVIEWER_SYSTEM = `You are an independent TigerIQ Reviewer. You did not perform the task. Inspect the instruction, expected-evidence contract, executor result, and evidence summary. PASS only if the result actually satisfies the instruction within the declared bounded cloud scope, contains no invented external actions, and the expected evidence is present. Return JSON only: {"pass":true|false,"rationale":"..."}.`;

const JUDGE_SYSTEM = `You are the TigerIQ Judge/Gate. You did not execute or review the task. Decide the final gate from the instruction, expected-evidence contract, executor result/evidence, and reviewer decision. PASS only if reviewer.pass is true, evidence is concrete and bound to the result, and there is no unresolved blocker or fabricated external claim. Return JSON only: {"pass":true|false,"rationale":"..."}.`;

export async function executeCloudTask({ instruction, expectedEvidence }) {
  const call = await gatewayJson({
    model: roleModel('executor'),
    system: EXECUTOR_SYSTEM,
    payload: { instruction: clean(instruction, 6_000), expectedEvidence: clean(expectedEvidence, 3_000) },
  });
  const status = String(call.value?.status || '').toLowerCase();
  if (!['completed', 'blocked'].includes(status)) throw new Error('cloud_executor_invalid_status');
  return {
    status,
    result: clean(call.value?.result, 8_000),
    evidenceSummary: clean(call.value?.evidenceSummary, 4_000),
    blocker: clean(call.value?.blocker, 2_000),
    modelUsed: call.modelUsed,
    providerUsed: call.providerUsed,
    usage: call.usage,
  };
}

export async function reviewCloudTask(input) {
  const call = await gatewayJson({
    model: roleModel('reviewer'),
    system: REVIEWER_SYSTEM,
    payload: {
      instruction: clean(input?.instruction, 6_000),
      expectedEvidence: clean(input?.expectedEvidence, 3_000),
      result: clean(input?.result, 8_000),
      evidenceSummary: clean(input?.evidenceSummary, 4_000),
    },
  });
  return {
    pass: call.value?.pass === true,
    rationale: clean(call.value?.rationale, 3_000),
    modelUsed: call.modelUsed,
    providerUsed: call.providerUsed,
    usage: call.usage,
  };
}

export async function judgeCloudTask(input) {
  const call = await gatewayJson({
    model: roleModel('judge'),
    system: JUDGE_SYSTEM,
    payload: {
      instruction: clean(input?.instruction, 6_000),
      expectedEvidence: clean(input?.expectedEvidence, 3_000),
      result: clean(input?.result, 8_000),
      evidenceSummary: clean(input?.evidenceSummary, 4_000),
      review: { pass: input?.review?.pass === true, rationale: clean(input?.review?.rationale, 3_000) },
    },
  });
  return {
    pass: call.value?.pass === true,
    rationale: clean(call.value?.rationale, 3_000),
    modelUsed: call.modelUsed,
    providerUsed: call.providerUsed,
    usage: call.usage,
  };
}
