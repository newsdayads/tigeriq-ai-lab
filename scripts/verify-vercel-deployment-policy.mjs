import { existsSync, readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const deploymentEnabled = config?.git?.deploymentEnabled;
const marker = new URL('../release/3840-retry-one-shot.txt', import.meta.url);
const gateScript = new URL('./vercel-3840-one-shot.mjs', import.meta.url);
const ignore = 'node scripts/vercel-3840-one-shot.mjs';
const keys = deploymentEnabled && typeof deploymentEnabled === 'object' && !Array.isArray(deploymentEnabled)
  ? Object.keys(deploymentEnabled).sort()
  : [];
const oneShot =
  keys.length === 2
  && keys[0] === '**'
  && keys[1] === 'main'
  && deploymentEnabled['**'] === false
  && deploymentEnabled.main === true
  && config?.ignoreCommand === ignore
  && existsSync(marker)
  && existsSync(gateScript)
  && readFileSync(marker, 'utf8') === 'TIGERIQ_LIVE_3840_RETRY_TRUE_PRODUCTION\n';

if (deploymentEnabled !== false && !oneShot) {
  throw new Error('TigerIQ Vercel policy violation: Git deployment must be disabled except exact bounded #3840 one-shot main release.');
}
if (deploymentEnabled === false && config?.ignoreCommand === ignore) {
  throw new Error('TigerIQ Vercel policy violation: #3840 one-shot ignoreCommand must not remain after disable.');
}
if (config?.cleanUrls !== true) throw new Error('TigerIQ Vercel routing violation: cleanUrls must stay enabled.');
const rewrites = Array.isArray(config?.rewrites) ? config.rewrites : [];
const rootRewrite = rewrites.find((route) => route?.source === '/');
if (rootRewrite?.destination !== '/command-center') throw new Error('TigerIQ Vercel routing violation: / must rewrite to extensionless /command-center.');
const htmlRewrite = rewrites.find((route) => String(route?.destination || '').endsWith('.html'));
if (htmlRewrite) throw new Error('TigerIQ Vercel routing violation: cleanUrls cannot rewrite to .html.');
if (existsSync(new URL('../public/index.html', import.meta.url))) throw new Error('TigerIQ Vercel routing violation: public/index.html must not self-shadow /.');
console.log(oneShot
  ? 'Vercel deployment/routing policy PASS: bounded #3840 Production retry gate enabled.'
  : 'Vercel deployment/routing policy PASS: Git auto-deploy disabled and cleanUrls root routing is loop-safe.');
