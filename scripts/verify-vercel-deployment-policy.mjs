import { existsSync, readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const deploymentEnabled = config?.git?.deploymentEnabled;
const oneShotMarker = new URL('../release/3231-one-shot.txt', import.meta.url);
const oneShotIgnore = 'git diff --quiet HEAD^ HEAD -- release/3231-one-shot.txt';
const oneShotKeys = deploymentEnabled && typeof deploymentEnabled === 'object' && !Array.isArray(deploymentEnabled)
  ? Object.keys(deploymentEnabled).sort()
  : [];
const oneShotRelease =
  oneShotKeys.length === 2
  && oneShotKeys[0] === '**'
  && oneShotKeys[1] === 'main'
  && deploymentEnabled['**'] === false
  && deploymentEnabled.main === true
  && config?.ignoreCommand === oneShotIgnore
  && existsSync(oneShotMarker)
  && readFileSync(oneShotMarker, 'utf8').trim() === 'TIGERIQ_LIVE_3231_ONE_SHOT_GIT_RELEASE';

if (deploymentEnabled !== false && !oneShotRelease) {
  throw new Error(
    'TigerIQ Vercel policy violation: Git deployment must be disabled, except exact bounded #3231 one-shot main release.'
  );
}

if (deploymentEnabled === false && config?.ignoreCommand === oneShotIgnore) {
  throw new Error('TigerIQ Vercel policy violation: #3231 one-shot ignoreCommand must not remain after Git deployment is disabled.');
}

if (config?.cleanUrls !== true) throw new Error('TigerIQ Vercel routing violation: cleanUrls must stay enabled.');

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

console.log(oneShotRelease
  ? 'Vercel deployment/routing policy PASS: exact bounded #3231 main-only one-shot release enabled.'
  : 'Vercel deployment/routing policy PASS: Git auto-deploy disabled and cleanUrls root routing is loop-safe.');
