import { describe, expect, it } from 'vitest';
// @ts-expect-error manager-json is a runtime .mjs module without declarations.
import { parseManagerJson } from '../apps/tigeriq-core/manager-json.mjs';

const executableJob = { title: 'dispatch me', prompt: 'run this job' };

describe('manager decision jobs invariant (#791)', () => {
  it('keeps continue invalid when jobs are absent or empty', () => {
    expect(() => parseManagerJson(JSON.stringify({ status: 'continue', summary: 'more work' }))).toThrow('MANAGER_SCHEMA_INVALID');
    expect(() => parseManagerJson(JSON.stringify({ status: 'continue', summary: 'more work', jobs: [] }))).toThrow('MANAGER_SCHEMA_INVALID');
  });

  it('keeps continue valid with an executable job', () => {
    expect(parseManagerJson(JSON.stringify({ status: 'continue', summary: 'more work', jobs: [executableJob] }))).toMatchObject({ status: 'continue', jobs: [executableJob] });
  });

  for (const status of ['complete', 'blocked']) {
    it(`rejects ${status} when executable jobs are present`, () => {
      expect(() => parseManagerJson(JSON.stringify({ status, summary: 'terminal', jobs: [executableJob] }))).toThrow('MANAGER_SCHEMA_INVALID');
    });
  }

  it('accepts terminal decisions only with jobs empty or absent', () => {
    expect(parseManagerJson(JSON.stringify({ status: 'complete', summary: 'done', jobs: [] }))).toMatchObject({ status: 'complete', jobs: [] });
    expect(parseManagerJson(JSON.stringify({ status: 'blocked', summary: 'stopped' }))).toMatchObject({ status: 'blocked', jobs: [] });
  });
});
