import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  AUTHORIZED_ISSUE,
  EXPECTED_PROJECT_ID,
  EXPECTED_TEAM_ID,
  buildDeployPlan,
} from './vercel-explicit-production-deploy.mjs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

if (config?.git?.deploymentEnabled !== false) {
  throw new Error(
    'TigerIQ Vercel policy violation: vercel.json must keep git.deploymentEnabled=false. ' +
      'Deploy previews/production explicitly only when needed.'
  );
}

const sha = 'a'.repeat(40);
const plan = buildDeployPlan({
  projectLink: { projectId: EXPECTED_PROJECT_ID, orgId: EXPECTED_TEAM_ID },
  expectedSha: sha,
  actualSha: sha,
  issue: AUTHORIZED_ISSUE,
});
assert.equal(plan.projectId, EXPECTED_PROJECT_ID);
assert.equal(plan.teamId, EXPECTED_TEAM_ID);
assert.equal(plan.target, 'production');
assert.equal(plan.maxAttempts, 1);
assert.equal(plan.exactSha, sha);

assert.throws(
  () => buildDeployPlan({
    projectLink: { projectId: 'prj_wrong', orgId: EXPECTED_TEAM_ID },
    expectedSha: sha,
    actualSha: sha,
    issue: AUTHORIZED_ISSUE,
  }),
  /VERCEL_PROJECT_SCOPE_MISMATCH/
);
assert.throws(
  () => buildDeployPlan({
    projectLink: { projectId: EXPECTED_PROJECT_ID, orgId: EXPECTED_TEAM_ID },
    expectedSha: 'b'.repeat(40),
    actualSha: sha,
    issue: AUTHORIZED_ISSUE,
  }),
  /VERCEL_EXACT_SHA_MISMATCH/
);
assert.throws(
  () => buildDeployPlan({
    projectLink: { projectId: EXPECTED_PROJECT_ID, orgId: EXPECTED_TEAM_ID },
    expectedSha: sha,
    actualSha: sha,
    issue: '999',
  }),
  /VERCEL_OWNER_AUTH_SCOPE_MISMATCH/
);

console.log('Vercel deployment policy PASS: automatic Git deployments are disabled and explicit production deploy is project/SHA/Owner-scope fail-closed.');
