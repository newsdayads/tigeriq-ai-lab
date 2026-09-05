import { readFileSync } from 'node:fs';

const PREVIEW_BRANCH = 'nv02/433b-exact-main-vercel-preview';
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const policy = config?.git?.deploymentEnabled;

const globallyDisabled = policy === false;
const boundedPreview = policy && typeof policy === 'object' && !Array.isArray(policy)
  && policy['**'] === false
  && policy[PREVIEW_BRANCH] === true
  && Object.keys(policy).length === 2;

if (!globallyDisabled && !boundedPreview) {
  throw new Error(
    'TigerIQ Vercel policy violation: Git deployment must be globally disabled or limited to the exact #433b Preview branch.'
  );
}

console.log(globallyDisabled
  ? 'Vercel deployment policy PASS: automatic Git deployments are disabled.'
  : `Vercel deployment policy PASS: only ${PREVIEW_BRANCH} is enabled; all other Git deployments are disabled.`);
