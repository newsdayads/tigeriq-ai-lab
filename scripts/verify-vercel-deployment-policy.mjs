import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

if (config?.git?.deploymentEnabled !== false) {
  throw new Error(
    'TigerIQ Vercel policy violation: vercel.json must keep git.deploymentEnabled=false. ' +
      'Deploy previews/production explicitly only when needed.'
  );
}

console.log('Vercel deployment policy PASS: automatic Git deployments are disabled.');
