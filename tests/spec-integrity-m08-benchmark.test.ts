import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
// @ts-expect-error canonical JavaScript runtime module has no TypeScript declarations.
import { evaluateSpecIntegrity } from '../apps/tigeriq-core/spec-integrity-gate.mjs';
// @ts-expect-error canonical JavaScript runtime module has no TypeScript declarations.
import { evaluateProductAcceptance } from '../apps/tigeriq-coding-lane/product-acceptance.mjs';

const REPO = 'newsdayads/tigeriq-ai-lab';

type Requirement = { id: string; text: string };
type Sample = {
  id: string;
  kind: 'feature' | 'bug';
  pr: string;
  sourceHeadSha: string;
  historicalDeliveryMs: number;
  sourcePath: string;
  sourceMarker: string;
  backendCheck: {
    id: number;
    name: string;
    status: string;
    conclusion: string;
    head_sha: string;
    details_url: string;
    app: { slug: string };
  };
  requirements: Requirement[];
};

const samples: Sample[] = [
  {
    id: 'FEATURE_PR_5427_OAUTH_RUNTIME',
    kind: 'feature',
    pr: 'https://github.com/newsdayads/tigeriq-ai-lab/pull/5427',
    sourceHeadSha: '0aeb75ed317fbf24ee708015b84b0979e22aa51a',
    historicalDeliveryMs: 456000,
    sourcePath: 'apps/tigeriq-core/pc-operator-oauth-runtime.mjs',
    sourceMarker: 'export function createOAuthResourceServer',
    backendCheck: {
      id: 123295184763,
      name: 'Backend Contract Verify',
      status: 'completed',
      conclusion: 'success',
      head_sha: '0aeb75ed317fbf24ee708015b84b0979e22aa51a',
      details_url: 'https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/40827936468/job/123295184763',
      app: { slug: 'github-actions' },
    },
    requirements: [
      { id: 'F5427-R1', text: 'Serve OAuth protected-resource discovery.' },
      { id: 'F5427-R2', text: 'Serve authorization-server discovery.' },
      { id: 'F5427-R3', text: 'Verify RS256 bearer tokens from JWKS.' },
      { id: 'F5427-R4', text: 'Validate issuer audience expiry and subject.' },
      { id: 'F5427-R5', text: 'Advertise PKCE S256 metadata.' },
      { id: 'F5427-R6', text: 'Return 401 for unauthorized requests.' },
      { id: 'F5427-R7', text: 'Enforce verified-principal scopes across MCP tools.' },
    ],
  },
  {
    id: 'BUG_PR_5684_LOCAL_ROUTING_WHITESPACE',
    kind: 'bug',
    pr: 'https://github.com/newsdayads/tigeriq-ai-lab/pull/5684',
    sourceHeadSha: 'a5184c749972e898637aeef15851d5d03c638968',
    historicalDeliveryMs: 1206000,
    sourcePath: 'apps/tigeriq-core/objective-local-routing.mjs',
    sourceMarker: 'export function effectiveCoreJobRoutingProfile',
    backendCheck: {
      id: 128859929735,
      name: 'Backend Contract Verify',
      status: 'completed',
      conclusion: 'success',
      head_sha: 'a5184c749972e898637aeef15851d5d03c638968',
      details_url: 'https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/42522846534/job/128859929735',
      app: { slug: 'github-actions' },
    },
    requirements: [
      { id: 'B5684-R1', text: 'Trim routing_profile only for github_api_autowork.' },
      { id: 'B5684-R2', text: 'Whitespace-wrapped LOCAL variants must remain LOCAL.' },
      { id: 'B5684-R3', text: 'Non-autowork routing profiles must remain unchanged.' },
    ],
  },
];

function productInput(sample: Sample) {
  return {
    productType: 'backend',
    sourceHeadSha: sample.sourceHeadSha,
    repositoryFullName: REPO,
    changes: [{ path: sample.sourcePath, content: sample.sourceMarker }],
    checkRuns: [sample.backendCheck],
    receipts: [],
  };
}

function specInput(sample: Sample, mapped: boolean) {
  const proof = sample.backendCheck.details_url;
  return {
    spec: { requirements: sample.requirements },
    plan: {
      tasks: [{
        id: sample.id + '-TASK',
        requirements: sample.requirements.map(r => r.id),
      }],
    },
    receipts: mapped
      ? sample.requirements.map(r => ({
          requirement_id: r.id,
          proof_url: proof,
          head_sha: sample.sourceHeadSha,
          status: 'completed',
          conclusion: 'success',
        }))
      : [{
          proof_url: proof,
          head_sha: sample.sourceHeadSha,
          status: 'completed',
          conclusion: 'success',
        }],
    sourceHeadSha: sample.sourceHeadSha,
  };
}

function averageMs(fn: () => unknown, iterations = 2000) {
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) fn();
  return (performance.now() - started) / iterations;
}

function parseCoverage(stdout: string, filename: string) {
  const line = stdout.split(/\r?\n/).find(row => row.includes(filename));
  if (!line) throw new Error('COVERAGE_ROW_MISSING:' + filename);
  const match = line.match(/\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
  if (!match) throw new Error('COVERAGE_ROW_INVALID:' + line);
  return {
    linePct: Number(match[1]),
    branchPct: Number(match[2]),
    functionPct: Number(match[3]),
  };
}

function sampleCoverage(sample: Sample) {
  const dir = mkdtempSync(join(tmpdir(), 'gh5606-m08-'));
  const file = join(dir, 'sample.test.mjs');
  const productUrl = pathToFileURL(resolve('apps/tigeriq-coding-lane/product-acceptance.mjs')).href;
  const specUrl = pathToFileURL(resolve('apps/tigeriq-core/spec-integrity-gate.mjs')).href;
  const product = JSON.stringify(productInput(sample));
  const spec = JSON.stringify(specInput(sample, true));
  writeFileSync(file, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    `import { evaluateProductAcceptance } from ${JSON.stringify(productUrl)};`,
    `import { evaluateSpecIntegrity } from ${JSON.stringify(specUrl)};`,
    `const product = ${product};`,
    `const spec = ${spec};`,
    "test('sample product and spec acceptance', () => {",
    "  assert.equal(evaluateProductAcceptance(product).pass, true);",
    "  assert.equal(evaluateSpecIntegrity(spec).pass, true);",
    "});",
  ].join('\n'));
  try {
    const run = spawnSync(process.execPath, ['--test', '--experimental-test-coverage', file], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env },
    });
    if (run.status !== 0) {
      throw new Error('COVERAGE_RUN_FAILED:' + (run.stderr || run.stdout));
    }
    return {
      productAcceptance: parseCoverage(run.stdout, 'product-acceptance.mjs'),
      specIntegrity: parseCoverage(run.stdout, 'spec-integrity-gate.mjs'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('GH-5606 M08 two real historical sample benchmark', () => {
  for (const sample of samples) {
    it(sample.id + ' compares existing product acceptance with additive spec traceability', () => {
      const baseline = evaluateProductAcceptance(productInput(sample));
      const before = evaluateSpecIntegrity(specInput(sample, false));
      const after = evaluateSpecIntegrity(specInput(sample, true));

      expect(baseline.pass).toBe(true);
      expect(before.pass).toBe(false);
      expect(before.checked).toBe(0);
      expect(before.total).toBe(sample.requirements.length);
      expect(before.details.missingReceipts).toHaveLength(sample.requirements.length);
      expect(after.pass).toBe(true);
      expect(after.checked).toBe(sample.requirements.length);
      expect(after.total).toBe(sample.requirements.length);

      const baselineEvalMs = averageMs(() => evaluateProductAcceptance(productInput(sample)));
      const specEvalMs = averageMs(() => evaluateSpecIntegrity(specInput(sample, true)));
      const coverage = sampleCoverage(sample);

      const receiptCoverageBeforePct = Number(((before.checked / before.total) * 100).toFixed(2));
      const receiptCoverageAfterPct = Number(((after.checked / after.total) * 100).toFixed(2));
      const record = {
        event: 'GH5606_M08_BENCHMARK_V1',
        sample: sample.id,
        kind: sample.kind,
        source_revision: sample.sourceHeadSha,
        source_pr: sample.pr,
        baseline: {
          method: 'TIGERIQ_PRODUCT_ACCEPTANCE_V2',
          accepted: baseline.pass,
          gate_eval_ms: Number(baselineEvalMs.toFixed(6)),
          product_check_receipt: sample.backendCheck.details_url,
          test_coverage: coverage.productAcceptance,
        },
        spec_integrity: {
          method: 'TIGERIQ_SPEC_INTEGRITY_V1_ADDITIVE',
          before: {
            accepted: before.pass,
            checked: before.checked,
            total: before.total,
            receipt_coverage_pct: receiptCoverageBeforePct,
            missing_individual_receipts: before.details.missingReceipts.length,
          },
          after_one_traceability_repair_round: {
            accepted: after.pass,
            checked: after.checked,
            total: after.total,
            receipt_coverage_pct: receiptCoverageAfterPct,
          },
          traceability_repair_rounds: 1,
          gate_eval_ms: Number(specEvalMs.toFixed(6)),
          test_coverage: coverage.specIntegrity,
        },
        historical_delivery_ms: sample.historicalDeliveryMs,
        incremental_paid_api_cost_usd: 0,
        github_actions_billing: 'NOT_ASSERTED_BY_BENCHMARK',
        decision: 'GO_SELECTIVE_ADDITIVE_NOT_REPLACEMENT',
      };
      console.log(JSON.stringify(record));
    });
  }
});
