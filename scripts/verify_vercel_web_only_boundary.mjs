import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const textExtensions = new Set(['.html','.js','.css','.json','.webmanifest','.svg','.txt','.md']);
const ext = path => path.includes('.') ? path.slice(path.lastIndexOf('.')) : '';
function walk(root) {
  const out = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (textExtensions.has(ext(path))) out.push(path);
  }
  return out;
}

const apiFiles = readdirSync('api').filter(name => name.endsWith('.mjs')).sort();
assert.deepEqual(apiFiles, ['owner-auth.mjs'], 'Vercel api/ must expose owner-auth only');
for (const retired of ['chief.mjs','chief-smoke.mjs','control.mjs','company-progress.mjs','workforce-status.mjs']) {
  assert.equal(existsSync(`api/${retired}`), false, `${retired} must be retired from Vercel execution path`);
}

const publicFiles = walk('public');
const publicSources = publicFiles.map(path => [path, readFileSync(path, 'utf8')]);
const directSameOriginCalls = [];
for (const [path, source] of publicSources) {
  for (const match of source.matchAll(/\bfetch\s*\(\s*['"](\/api\/[^'"?#)]*)/g)) directSameOriginCalls.push({ path, route: match[1] });
  for (const forbidden of ['https://ai-gateway.vercel.sh','https://api.openai.com','https://generativelanguage.googleapis.com','AI_GATEWAY_API_KEY','getVercelOidcToken','decideWithChief']) {
    assert.equal(source.includes(forbidden), false, `${path} must not contain active Vercel/OpenAI/Gemini authority marker ${forbidden}`);
  }
}
assert.ok(directSameOriginCalls.length >= 2, 'Owner auth calls must remain visible in the V3 frontend call graph');
assert.ok(directSameOriginCalls.every(row => row.route === '/api/owner-auth'), `Unexpected same-origin Vercel API call: ${JSON.stringify(directSameOriginCalls)}`);

const app = readFileSync('public/web-v1/app.js','utf8');
assert.match(app, /fetch\('\/api\/owner-auth\?action=status'/);
assert.match(app, /fetch\('\/api\/owner-auth\?action=identity'/);
assert.doesNotMatch(app, /\/api\/(?:control|chief|company-progress)/);

const controller = readFileSync('public/web-v1/controller-client.js','utf8');
assert.match(controller, /this\.baseUrl}\$\{path}/);
assert.match(controller, /\.ts\.net/);
assert.match(controller, /CONTROLLER_NOT_TAILNET_OR_LOCAL/);
assert.match(controller, /source\?\.mode!=='controller'\|\|snapshot\.source\?\.authoritative!==true/);
for (const route of ['/api/workforce/status','/api/web/v1/snapshot','/api/web/v1/goals','/api/web/v1/prompts/versions']) assert.match(controller, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));

const ownerAuth = readFileSync('api/owner-auth.mjs','utf8');
for (const forbidden of ['ai-gateway.vercel.sh','api.openai.com','generativelanguage.googleapis.com','AI_GATEWAY_API_KEY','getVercelOidcToken','decideWithChief']) assert.equal(ownerAuth.includes(forbidden), false);

const config = JSON.parse(readFileSync('vercel.json','utf8'));
assert.equal(config.git?.deploymentEnabled, false, 'Ordinary Git commits must not auto-deploy to Vercel');

const releaseWorkflow = readFileSync('.github/workflows/web-release-vercel.yml','utf8');
assert.match(releaseWorkflow, /^on:\n  workflow_dispatch:/m);
assert.doesNotMatch(releaseWorkflow, /^\s*(push|pull_request):/m);
for (const required of ['WEB_RELEASE_CANDIDATE_APPROVED','OWNER_APPROVED_PRODUCTION','release_base_sha','release_sha','git merge-base --is-ancestor','Non-Web paths cannot enter a Vercel release','Docs/tests/workflow-only diff is not a Web Release Candidate','--prebuilt']) assert.match(releaseWorkflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));

console.log('VERCEL_WEB_ONLY_BOUNDARY_PASS');
