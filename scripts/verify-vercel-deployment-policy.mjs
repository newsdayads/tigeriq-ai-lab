import { existsSync, readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

if (config?.git?.deploymentEnabled !== false) {
  throw new Error(
    'TigerIQ Vercel policy violation: vercel.json must keep git.deploymentEnabled=false. ' +
      'Deploy previews/production explicitly only when needed.'
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

console.log('Vercel deployment/routing policy PASS: Git auto-deploy disabled and cleanUrls root routing is loop-safe.');
