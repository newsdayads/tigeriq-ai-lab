import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

// Apply the no-new-Vercel auto-deploy contract to EVERY tracked vercel.json,
// not only the repository root. Existing deployments are preserved.
const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean);
for (const name of trackedFiles) {
  if (name.split('/').at(-1) !== 'vercel.json') continue;
  const projectConfig = JSON.parse(readFileSync(resolve(root, name), 'utf8'));
  if (projectConfig?.git?.deploymentEnabled !== false) {
    throw new Error('NO_NEW_VERCEL_AUTO_DEPLOY: ' + name + ' must set git.deploymentEnabled=false');
  }
}

const canonicalDeployScript = 'scripts/pc-worker/vercel-tigeriq-live-3150-deploy.mjs';
const policyGuardScript = 'scripts/verify-vercel-deployment-policy.mjs';

const deployIntentPatterns = [
  /\bvercel(?:\.cmd)?\s+deploy\b/i,
  /\bvercel(?:\.cmd)?\s+(?:--prod|-p)(?:\s|$)/i,
  /\bvercel(?:\.cmd)?\s+api\b[^\r\n]*\/v\d+\/deployments\b[^\r\n]*(?:-X|--method)\s*(?:POST|PUT)\b/i,
  /(?:-X|--method)\s*(?:POST|PUT)\b[^\r\n]*\/v\d+\/deployments\b/i,
  /https:\/\/api\.vercel\.com\/v\d+\/deployments\b[^\r\n]*(?:method\s*:\s*['"]?(?:POST|PUT)|\b(?:POST|PUT)\b)/i,
  /\b(?:createDeployment|deployToVercel)\s*\(/i,
  /^\s*uses:\s*[^\r\n]*vercel[^\r\n]*action[^\r\n]*@/im,
];

export function hasVercelDeployIntent(text = '') {
  return deployIntentPatterns.some((pattern) => pattern.test(String(text)));
}

if (config?.git?.deploymentEnabled !== false) {
  throw new Error(
    'TigerIQ web-hosting boundary violation: vercel.json must keep git.deploymentEnabled=false.'
  );
}

if (config?.cleanUrls !== true) {
  throw new Error('TigerIQ Vercel routing violation: cleanUrls must stay enabled.');
}

const rewrites = Array.isArray(config?.rewrites) ? config.rewrites : [];
const rootRewrite = rewrites.find((route) => route?.source === '/');
if (rootRewrite?.destination !== '/api/health-view?resource=') {
  throw new Error('TigerIQ Vercel routing violation: / must proxy PC01 display via /api/health-view.');
}
const proxyRoute = rewrites.find(route=>route?.source==='/pc01/:path*');
if(proxyRoute?.destination!=='/api/health-view?resource=:path*')
  throw new Error('TigerIQ Vercel routing violation: PC01 read-only resource proxy missing.');
const facade=readFileSync(new URL('../api/health-view.mjs',import.meta.url),'utf8');
const gateway=readFileSync(new URL('../apps/tigeriq-core/api-health-view-gateway.mjs',import.meta.url),'utf8');
for(const required of ['TIGERIQ_HEALTH_VIEW_ORIGIN','TIGERIQ_HEALTH_VIEW_KEY','method !== \'GET\'','PATHS.has(path)']){
  if(!facade.includes(required))throw Error('TigerIQ Vercel PC01 display guard missing '+required);
}
for(const required of ['DISPLAY_PATHS','timingSafeEqual','method !== \'GET\'','TIGERIQ_HEALTH_VIEW_KEY']){
  if(!gateway.includes(required))throw Error('TigerIQ PC01 read-only ingress guard missing '+required);
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

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const workflowDir = resolve(root, '.github', 'workflows');
for (const file of walk(workflowDir)) {
  const text = readFileSync(file, 'utf8');
  if (hasVercelDeployIntent(text)) {
    throw new Error(`TigerIQ web-hosting boundary violation: workflow must not deploy Vercel (${file}).`);
  }
}

const scriptsDir = resolve(root, 'scripts');
for (const file of walk(scriptsDir)) {
  if (!/\.(?:mjs|js|cjs|ts|ps1|sh)$/i.test(file)) continue;
  const relative = file.slice(root.length + 1).replaceAll('\\', '/');
  if (relative === policyGuardScript) continue;
  const text = readFileSync(file, 'utf8');
  if (hasVercelDeployIntent(text) && relative !== canonicalDeployScript) {
    throw new Error(
      `TigerIQ web-hosting boundary violation: only ${canonicalDeployScript} may contain a Vercel deploy command; found ${relative}.`
    );
  }
}

const canonicalText = readFileSync(resolve(root, canonicalDeployScript), 'utf8');
for (const required of [
  'TIGERIQ_VERCEL_RELEASE_CLASS',
  'TIGERIQ_OWNER_RELEASE_AUTHORIZED',
  'TIGERIQ_VERCEL_RELEASE_REASON',
  'VERCEL_WEB_ARTIFACT_CHANGE_REQUIRED',
  'VERCEL_OWNER_RELEASE_AUTH_REQUIRED',
  'VERCEL_RELEASE_CLASS_INVALID',
]) {
  if (!canonicalText.includes(required)) {
    throw new Error(`TigerIQ web-hosting boundary violation: canonical deploy guard missing ${required}.`);
  }
}

console.log('Web-hosting boundary PASS: Vercel is hosting-only, Git auto-deploy is disabled, and deploy is single-path gated.');
