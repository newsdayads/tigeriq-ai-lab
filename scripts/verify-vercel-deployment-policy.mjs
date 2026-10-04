import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const canonicalDeployScript = 'scripts/pc-worker/vercel-tigeriq-live-3150-deploy.mjs';

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

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const deployCommand = /\bvercel(?:\.cmd)?\s+deploy\b/i;
const workflowDir = resolve(root, '.github', 'workflows');
for (const file of walk(workflowDir)) {
  const text = readFileSync(file, 'utf8');
  if (deployCommand.test(text)) {
    throw new Error(`TigerIQ web-hosting boundary violation: workflow must not deploy Vercel (${file}).`);
  }
}

const scriptsDir = resolve(root, 'scripts');
for (const file of walk(scriptsDir)) {
  if (!/\.(?:mjs|js|cjs|ts|ps1|sh)$/i.test(file)) continue;
  const relative = file.slice(root.length + 1).replaceAll('\\', '/');
  const text = readFileSync(file, 'utf8');
  if (deployCommand.test(text) && relative !== canonicalDeployScript) {
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
