import { describe, it, expect, vi } from 'vitest';
import { OWNER_PROMPT_PREFIX, validateOwnerPromptCopy, publishOwnerPromptCopy } from '../apps/shared/owner-prompt-copy-contract.mjs';

const oneLine = '```text\n' + OWNER_PROMPT_PREFIX +
  ' Rà soát TigerIQ từ GitHub main; báo kết quả và bằng chứng, không sửa Production.\n```';

describe('Owner one-line Copy prompt contract V1', () => {
  it('accepts exactly one native text Copy block containing one physical line', () => {
    expect(validateOwnerPromptCopy(oneLine)).toEqual({ ok: true, errors: [] });
  });
  it('rejects lead-in, outro, markdown quotes and alternative writing blocks', () => {
    for (const output of ['Dưới đây là prompt:\n' + oneLine, oneLine + '\nEm đã chuẩn bị.', '> ' + oneLine, OWNER_PROMPT_PREFIX]) {
      expect(validateOwnerPromptCopy(output).ok).toBe(false);
    }
  });
  it('rejects missing or wrong mandatory opening and empty payload', () => {
    expect(validateOwnerPromptCopy(oneLine.replace(OWNER_PROMPT_PREFIX, 'HÃY LÀM.')).errors).toContain('EXACT_OWNER_PREFIX_REQUIRED');
    expect(validateOwnerPromptCopy('```text\n' + OWNER_PROMPT_PREFIX + '\n```').errors).toContain('PROMPT_CONTENT_REQUIRED');
  });
  it('rejects wrapped paragraphs, multiple code blocks and CR/tab', () => {
    for (const output of [
      oneLine.replace('GitHub main;', 'GitHub\nmain;'),
      oneLine + '\n' + oneLine,
      oneLine.replace('Rà soát', 'Rà\tsoát'),
      oneLine.replace('Rà soát', 'Rà\rsoát'),
    ]) {
      expect(validateOwnerPromptCopy(output).ok).toBe(false);
    }
  });
  it('rejects nested fences, other languages and misleading single inline code spans', () => {
    expect(validateOwnerPromptCopy(oneLine.replace('GitHub main;', '```GitHub main;')).errors).toContain('NESTED_FENCE_FORBIDDEN');
    expect(validateOwnerPromptCopy(oneLine.replace('```text', '```markdown')).errors).toContain('SINGLE_NATIVE_TEXT_COPY_BLOCK_REQUIRED');
    expect(validateOwnerPromptCopy('`' + OWNER_PROMPT_PREFIX + ' Test`').ok).toBe(false);
  });
  it('fails closed without calling emit on bad output or missing emitter', () => {
    const emit = vi.fn();
    expect(publishOwnerPromptCopy('Hãy làm việc', emit).published).toBe(false);
    expect(emit).not.toHaveBeenCalled();
    expect(publishOwnerPromptCopy(oneLine, null)).toEqual({ published: false, errors: ['EMITTER_REQUIRED'] });
    expect(publishOwnerPromptCopy(oneLine, emit).published).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);\n    expect(emit).toHaveBeenCalledWith(oneLine);
  });
});
