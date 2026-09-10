import { existsSync, readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

const deploymentEnabled = config?.git?.deploymentEnabled;
const mainOnlyAutoDeploy =
  deploymentEnabled &&
  typeof deploymentEnabled === 'object' &&
  !Array.isArray(deploymentEnabled) &&
  deploymentEnabled['*'] === false &&
  deploymentEnabled.main === true &&
  Object.entries(deploymentEnabled).every(
    ([branch, enabled]) => branch === 'main' || enabled === false
  );

if (!mainOnlyAutoDeploy) {
  throw new Error(
    'TigerIQ Vercel policy violation: automatic Git deployment must be enabled for main only; all other branch patterns must remain false.'
  );
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
  throw new Error(
    `TigerIQ Vercel routing violation: cleanUrls cannot rewrite to .html (${htmlRewrite.source} -> ${htmlRewrite.destination}).`
  );
}

if (existsSync(new URL('../public/index.html', import.meta.url))) {
  throw new Error(
    'TigerIQ Vercel routing violation: public/index.html must not self-shadow /; root is routed to /command-center.'
  );
}

console.log('Vercel deployment/routing policy PASS: Git auto-deploy is main-only and cleanUrls root routing is loop-safe.');
