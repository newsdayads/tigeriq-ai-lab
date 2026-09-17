import { describe, expect, it } from 'vitest';
// @ts-expect-error manager-json is a runtime .mjs module without declarations.
import { parseManagerJson } from '../apps/tigeriq-core/manager-json.mjs';

describe('manager terminal decision invariant', () => {
  for (const status of ['complete', 'blocked']) {
    it(`rejects ${status} decisions that still carry executable jobs`, () => {
      const payload = JSON.stringify({ status, summary: 'terminal', jobs: [{ title: 'must not run', prompt: 'must not dispatch' }] });
      expect(() => parseManagerJson(payload)).toThrow('MANAGER_SCHEMA_INVALID');
    });
  }

  it('continues to accept a terminal decision with no jobs', () => {
    expect(parseManagerJson(JSON.stringify({ status: 'complete', summary: 'done', jobs: [] }))).toMatchObject({ status: 'complete', jobs: [] });
  });
});
