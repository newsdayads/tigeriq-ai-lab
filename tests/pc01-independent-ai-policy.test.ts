import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/pc-worker/worker-github-queue.py', 'utf8');

describe('WO-043 PC01 independent AI policy', () => {
  it('uses separately configured model identities for executor, reviewer and judge', () => {
    expect(source).toContain('TIGERIQ_OLLAMA_EXECUTOR_MODEL');
    expect(source).toContain('TIGERIQ_OLLAMA_REVIEWER_MODEL');
    expect(source).toContain('TIGERIQ_OLLAMA_JUDGE_MODEL');
    expect(source).toContain("len(set(normalized)) != 3");
    expect(source).toContain('ollama_chat(EXECUTOR_MODEL');
    expect(source).toContain('ollama_chat(\n        REVIEWER_MODEL');
    expect(source).toContain('ollama_chat(\n        JUDGE_MODEL');
  });

  it('fails closed instead of claiming independent review when role models are unavailable', () => {
    expect(source).toContain("REQUIRE_INDEPENDENT_AI = os.getenv('TIGERIQ_REQUIRE_INDEPENDENT_AI', '1')");
    expect(source).toContain("INDEPENDENCE_BLOCKED = 'TIGERIQ_PC01_INDEPENDENCE_BLOCKED'");
    expect(source).toContain("return False, 'missing independent model configuration: '");
    expect(source).toContain("return False, 'executor, reviewer and judge must use three distinct model identities'");
  });
});
