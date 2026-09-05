import { existsSync, readFileSync } from 'node:fs';

const PREVIEW_BRANCH = 'nv02/436-vercel-preview';
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const policy = config?.git?.deploymentEnabled;
const globallyDisabled = policy === false;
const boundedPreview = policy && typeof policy === 'object' && !Array.isArray(policy)
  && policy['**'] === false
  && policy[PREVIEW_BRANCH] === true
  && Object.keys(policy).length === 2;

if (!globallyDisabled && !boundedPreview) {
  throw new Error('TigerIQ Vercel policy violation: Git deployment must be globally disabled or limited to the exact #436 Preview branch.');
}

if (config?.cleanUrls !== true) {
  throw new Error('TigerIQ Vercel routing violation: cleanUrls must stay enabled.');
}

const rewrites = Array.isArray(config?.rewrites) ? config.rewrites : [];
const rootRewrite = rewrites.find((route) => route?.source === '/');
if (rootRewrite?.destination !== '/command-center') {
  throw new Error('TigerIQ Vercel routing violation: / must rewrite to extensionless /command-center.');
}

const htmlRewrite = rewrites.find((route) => String(route?.destination || '').endsWith('.html'));
if (htmlRewrite) {
  throw new Error(`TigerIQ Vercel routing violation: cleanUrls cannot rewrite to .html (${htmlRewrite.source} -> ${htmlRewrite.destination}).`);
}

if (existsSync(new URL('../public/index.html', import.meta.url))) {
  throw new Error('TigerIQ Vercel routing violation: public/index.html must not self-shadow /.');
}

console.log(boundedPreview
  ? `Vercel deployment/routing policy PASS: only ${PREVIEW_BRANCH} is enabled and root routing is loop-safe.`
  : 'Vercel deployment/routing policy PASS: Git auto-deploy disabled and root routing is loop-safe.');
