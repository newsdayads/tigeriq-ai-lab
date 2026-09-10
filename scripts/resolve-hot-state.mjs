#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const file = resolve(process.env.TIGERIQ_HOT_STATE || 'docs/HOT_STATE.json');
const requiredPointers = ['centralRouterIssue','interactionPolicyIssue','commandRegistryIssue','sourceTruthIssue'];
const allowedBrowserStates = new Set(['OWNER_HOLD','AUTHORIZED_WITH_GUARDRAILS','BLOCKED_HUMAN_AUTH']);

export function validateHotState(state) {
  const errors = [];
  if (state?.schemaVersion !== 1) errors.push('schemaVersion');
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(String(state?.hotStateVersion || ''))) errors.push('hotStateVersion');
  if (state?.kind !== 'derived_fast_start_index' || state?.authoritativeByItself !== false) errors.push('derivedIndexContract');
  for (const key of requiredPointers) if (!Number.isInteger(state?.dynamicPointers?.[key])) errors.push(`dynamicPointers.${key}`);
  if (!Number.isInteger(state?.currentPriority?.issue)) errors.push('currentPriority.issue');
  const browser = state?.currentDecisions?.chatgptWebAutomation;
  if (!allowedBrowserStates.has(browser?.status)) errors.push('currentDecisions.chatgptWebAutomation.status');
  if (!Array.isArray(state?.deepScanRequiredWhen) || state.deepScanRequiredWhen.length === 0) errors.push('deepScanRequiredWhen');
  if (errors.length) throw new Error(`HOT_STATE_INVALID:${errors.join(',')}`);
  return state;
}

export function compactHotState(state) {
  return {
    hotStateVersion: state.hotStateVersion,
    currentPriority: state.currentPriority,
    browserPolicy: state.currentDecisions.chatgptWebAutomation,
    dynamicPointers: state.dynamicPointers,
    runtime: state.runtime,
    completed: state.completed,
    openWithExternalOrOwnerGate: state.openWithExternalOrOwnerGate,
    deepScanRequiredWhen: state.deepScanRequiredWhen
  };
}

function readState() {
  return validateHotState(JSON.parse(readFileSync(file, 'utf8')));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const state = readState();
    if (process.argv.includes('--check')) console.log(JSON.stringify({ ok: true, hotStateVersion: state.hotStateVersion }));
    else console.log(JSON.stringify(compactHotState(state)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
