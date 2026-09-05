import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  AUTHORIZED_ISSUE,
  EXPECTED_BRANCH,
  EXPECTED_PROJECT_ID,
  EXPECTED_REPO,
  EXPECTED_TEAM_ID,
  buildDeployPlan,
  classifyDeployFailure,
} from './vercel-explicit-production-deploy.mjs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

if (config?.git?.deploymentEnabled !== false) {
  throw new Error('TigerIQ Vercel policy violation: vercel.json must keep git.deploymentEnabled=false. Deploy previews/production explicitly only when needed.');
}
if (config?.cleanUrls !== true) throw new Error('TigerIQ Vercel routing violation: cleanUrls must stay enabled.');
const rewrites = Array.isArray(config?.rewrites) ? config.rewrites : [];
const rootRewrite = rewrites.find((route) => route?.source === '/');
if (rootRewrite?.destination !== '/command-center') throw new Error('TigerIQ Vercel routing violation: / must rewrite to extensionless /command-center.');
const htmlRewrite = rewrites.find((route) => String(route?.destination || '').endsWith('.html'));
if (htmlRewrite) throw new Error(`TigerIQ Vercel routing violation: cleanUrls cannot rewrite to .html (${htmlRewrite.source} -> ${htmlRewrite.destination}).`);
if (existsSync(new URL('../public/index.html', import.meta.url))) throw new Error('TigerIQ Vercel routing violation: public/index.html must not self-shadow /.');

const sha = 'a'.repeat(40);
const valid = {
  projectLink: { projectId: EXPECTED_PROJECT_ID, orgId: EXPECTED_TEAM_ID },
  expectedSha: sha,
  actualSha: sha,
  issue: AUTHORIZED_ISSUE,
  branch: EXPECTED_BRANCH,
  remote: `https://github.com/${EXPECTED_REPO}.git`,
  config,
};
const plan = buildDeployPlan(valid);
assert.equal(plan.projectId, EXPECTED_PROJECT_ID);
assert.equal(plan.teamId, EXPECTED_TEAM_ID);
assert.equal(plan.repo, EXPECTED_REPO);
assert.equal(plan.branch, EXPECTED_BRANCH);
assert.equal(plan.target, 'production');
assert.equal(plan.maxAttempts, 1);
assert.equal(plan.exactSha, sha);
assert.throws(() => buildDeployPlan({ ...valid, projectLink: { projectId: 'prj_wrong', orgId: EXPECTED_TEAM_ID } }), /VERCEL_PROJECT_SCOPE_MISMATCH/);
assert.throws(() => buildDeployPlan({ ...valid, expectedSha: 'b'.repeat(40) }), /VERCEL_EXACT_SHA_MISMATCH/);
assert.throws(() => buildDeployPlan({ ...valid, issue: '999' }), /VERCEL_OWNER_AUTH_SCOPE_MISMATCH/);
assert.throws(() => buildDeployPlan({ ...valid, branch: 'feature/unsafe' }), /VERCEL_GIT_BRANCH_MISMATCH/);
assert.throws(() => buildDeployPlan({ ...valid, remote: 'https://github.com/newsdayads/other-repo.git' }), /VERCEL_GIT_REPO_MISMATCH/);
assert.throws(() => buildDeployPlan({ ...valid, config: { git: { deploymentEnabled: true } } }), /VERCEL_AUTO_DEPLOY_POLICY_MISMATCH/);
assert.equal(classifyDeployFailure('Deployment rate limited — retry later.'), 'VERCEL_RATE_LIMIT_WAIT');
assert.equal(classifyDeployFailure('Please log in to Vercel'), 'VERCEL_AUTH_REQUIRED');
assert.equal(classifyDeployFailure('unexpected failure'), 'VERCEL_DEPLOY_FAILED');

console.log('Vercel policy PASS: loop-safe routing plus project/repo/main/SHA/Owner-scoped bounded Production executor.');
