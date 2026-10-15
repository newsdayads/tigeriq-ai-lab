// GH-2293 R04: owner-authorized, GET-only historical canary verifier CLI.
// No actor/run ID, URL, token or audited-site payload printed on either path.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { inspectDiscoveredOwnerCanary, RunLocatorError } from './apify-existing-run-locator.mjs';
import { HistoricReadError } from './apify-historical-run-readonly.mjs';

export function redactedHistoricalEvidence(evidence) {
  // Explicit allowlist prevents accidentally serializing new private API fields.
  return {
    schema: 'TIGERIQ_APIFY_DISCOVERED_RUN_SAFE_CLI_V1',
    evidenceType: evidence.evidenceType,
    inspectedAt: evidence.inspectedAt,
    actor: {
      handle: evidence.actor.handle,
      isPublic: evidence.actor.isPublic,
      actorPermissionLevel: evidence.actor.actorPermissionLevel,
    },
    run: {
      status: evidence.run.status,
      startedAt: evidence.run.startedAt,
      finishedAt: evidence.run.finishedAt,
      buildNumber: evidence.run.buildNumber,
      computeUnits: evidence.run.computeUnits,
      usageTotalUsd: evidence.run.usageTotalUsd,
    },
    output: {
      schemaVersion: evidence.output.schemaVersion,
      status: evidence.output.status,
    },
    discovery: {
      source: evidence.discovery.source,
      boundedDate: evidence.discovery.boundedDate,
      candidates: evidence.discovery.candidates,
    },
    cost: {
      source: evidence.cost.source,
      ownerBillingConfirmed: false,
      zeroCostClaim: false,
      revenueVerified: false,
    },
    acceptance: {
      historicalRunMatched: evidence.acceptance.historicalRunMatched,
      platformFinalInvoiceVerified: false,
      paidRevenueVerified: false,
    },
    action: {
      readOnly: evidence.action.readOnly,
      requests: evidence.action.requests,
      postRequests: 0,
      newBuilds: 0,
      newRuns: 0,
      actorMutation: false,
    },
  };
}

export async function verifyOldCanaryReadOnly({
  env = process.env, fetchFn = globalThis.fetch, now = () => new Date(),
} = {}) {
  const evidence = await inspectDiscoveredOwnerCanary({ env, fetchFn, now });
  return redactedHistoricalEvidence(evidence);
}

export function safeCliError(error) {
  // Never print unknown exceptions or raw response bodies (may contain token).
  const recognized = error instanceof RunLocatorError || error instanceof HistoricReadError;
  return { ok: false, code: recognized ? error.code : 'UNEXPECTED_FAILURE' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const evidence = await verifyOldCanaryReadOnly();
    process.stdout.write(JSON.stringify({ ok: true, evidence }) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify(safeCliError(error)) + '\n');
    process.exitCode = 1;
  }
}
