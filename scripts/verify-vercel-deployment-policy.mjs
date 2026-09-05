import { readFileSync } from 'node:fs';

const PREVIEW_BRANCH = 'nv02/433-exact-main-vercel-preview';
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const policy = config?.git?.deploymentEnabled;

const globalOff = policy?.['**'] === false;
const onlyPreviewOn = policy?.[PREVIEW_BRANCH] === true;
const keys = policy && typeof policy === 'object' && !Array.isArray(policy) ? Object.keys(policy).sort() : [];
const exactKeys = keys.length === 2 && keys[0] === '**' && keys[1] === PREVIEW_BRANCH;

if (!globalOff || !onlyPreviewOn || !exactKeys) {
  throw new Error(
    'TigerIQ Vercel policy violation: only the bounded #433 Preview branch may be enabled; all other Git deployments must remain disabled.'
  );
}

console.log(`Vercel deployment policy PASS: only ${PREVIEW_BRANCH} is enabled; all other Git deployments are disabled.`);
