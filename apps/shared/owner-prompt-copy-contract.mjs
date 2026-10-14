// OWNER PROMPT COPY V1 — fail-closed output contract for TigerIQ-owned renderers.
// GitHub files and this helper cannot control native ChatGPT/Gemini UI or existing chats.
export const OWNER_PROMPT_PREFIX = 'LÀM — NO YAPPING.';
export const OWNER_PROMPT_OPEN_FENCE = '```text';
export const OWNER_PROMPT_CLOSE_FENCE = '```';

export function validateOwnerPromptCopy(output) {
  if (typeof output !== 'string') return { ok: false, errors: ['PROMPT_OUTPUT_INVALID'] };
  const errors = [];
  const lines = output.split('\n');
  if (lines.length !== 3) errors.push('ONE_PHYSICAL_PROMPT_LINE_REQUIRED');
  if (lines[0] !== OWNER_PROMPT_OPEN_FENCE || lines[lines.length - 1] !== OWNER_PROMPT_CLOSE_FENCE)
    errors.push('SINGLE_NATIVE_TEXT_COPY_BLOCK_REQUIRED');
  const prompt = lines.length === 3 ? lines[1] : '';
  if (!prompt.startsWith(OWNER_PROMPT_PREFIX)) errors.push('EXACT_OWNER_PREFIX_REQUIRED');
  if (prompt.startsWith(OWNER_PROMPT_PREFIX) && !prompt.slice(OWNER_PROMPT_PREFIX.length).trim())
    errors.push('PROMPT_CONTENT_REQUIRED');
  if (prompt.includes(OWNER_PROMPT_CLOSE_FENCE)) errors.push('NESTED_FENCE_FORBIDDEN');
  if (prompt.includes('\r') || prompt.includes('\t')) errors.push('ONE_PHYSICAL_PROMPT_LINE_REQUIRED');
  return { ok: errors.length === 0, errors };
}

// The emitting renderer must use this guard for *every* Owner prompt/handoff response.
// Do not label a blocked or unknown output as published or cross-platform compliant.
export function publishOwnerPromptCopy(output, emit) {
  const validation = validateOwnerPromptCopy(output);
  if (!validation.ok) return { published: false, errors: validation.errors };
  if (typeof emit !== 'function') return { published: false, errors: ['EMITTER_REQUIRED'] };
  emit(output);
  return { published: true, errors: [] };
}
