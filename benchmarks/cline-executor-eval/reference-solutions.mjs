// Reference solutions only for the scorer self-check; no real Cline/NV09 agent executes.
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

const sourcePatches = Object.freeze({
  'strict-count-parser': {
    file: 'src/parse-count.mjs',
    content: [
      "export function parseCount(value) {",
      "  const text = String(value ?? '');",
      "  if (!/^(?:0|[1-9]\\d*)$/.test(text)) return null;",
      "  const number = Number(text);",
      "  return Number.isSafeInteger(number) ? number : null;",
      "}",
      ""
    ].join('\n')
  },
  'bounded-tag-normalizer': {
    file: 'src/normalize-tags.mjs',
    content: [
      "export function normalizeTags(input) {",
      "  if (!Array.isArray(input)) throw new TypeError('tags must be an array');",
      "  const result = [];",
      "  const seen = new Set();",
      "  for (const item of input) {",
      "    const tag = String(item ?? '').trim().toLowerCase();",
      "    if (!tag) continue;",
      "    if (tag.length > 24) throw new TypeError('tag too long');",
      "    if (seen.has(tag)) continue;",
      "    if (result.length >= 8) throw new TypeError('too many tags');",
      "    seen.add(tag);",
      "    result.push(tag);",
      "  }",
      "  return result;",
      "}",
      ""
    ].join('\n')
  },
  'shared-metric-sum-refactor': {
    file: 'src/metrics.mjs',
    content: [
      "export function sumFinite(rows, key) {",
      "  return (Array.isArray(rows) ? rows : []).reduce((sum, row) => {",
      "    const value = row?.[key];",
      "    return typeof value === 'number' && Number.isFinite(value) ? sum + value : sum;",
      "  }, 0);",
      "}",
      "export function sumLatencyMs(rows) { return sumFinite(rows, 'latencyMs'); }",
      "export function sumTokens(rows) { return sumFinite(rows, 'tokens'); }",
      ""
    ].join('\n')
  }
});

export async function applyDemoReferenceSolutions(fixtures) {
  const ids = new Set(fixtures.map(row => row.id));
  if (ids.size !== 3 || Object.keys(sourcePatches).some(id => !ids.has(id))) {
    throw new Error('REFERENCE_SOLUTION_FIXTURE_SET_MISMATCH');
  }
  for (const fixture of fixtures) {
    const patch = sourcePatches[fixture.id];
    await writeFile(path.join(fixture.root, patch.file), patch.content, 'utf8');
  }
  return fixtures.map(row => ({fixtureId: row.id, path: sourcePatches[row.id].file}));
}
