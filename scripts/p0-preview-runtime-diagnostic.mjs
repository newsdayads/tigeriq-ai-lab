import { randomUUID } from 'node:crypto';
import { executeCloudTask, reviewCloudTask, judgeCloudTask } from '../api/cloud-workforce.mjs';

const TARGET_REF = 'wo045/web-control-remote-ops';
const isTargetPreview = process.env.VERCEL === '1'
  && process.env.VERCEL_ENV === 'preview'
  && process.env.VERCEL_GIT_COMMIT_REF === TARGET_REF;

if (!isTargetPreview) {
  console.log('P0_PREVIEW_RUNTIME_DIAGNOSTIC_SKIP');
  process.exit(0);
}

const githubToken = String(process.env.TIGERIQ_GITHUB_TOKEN || '').trim();
const groqKeyPresent = Boolean(String(process.env.GROQ_API_KEY || '').trim());
if (!githubToken) throw new Error('diagnostic_github_token_missing');
if (!groqKeyPresent) throw new Error('diagnostic_groq_key_missing');

const repoFullName = String(process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab');
const [owner, repo] = repoFullName.split('/');
if (!owner || !repo) throw new Error('diagnostic_repo_invalid');

async function gh(path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'tigeriq-p0-preview-diagnostic',
      authorization: `Bearer ${githubToken}`,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`diagnostic_github_${response.status}`);
  return response;
}

let labelName = '';
let githubMetadata = false;
let githubIssuesWrite = false;
try {
  await gh(`/repos/${owner}/${repo}`);
  githubMetadata = true;

  labelName = `tigeriq-p0-diag-${randomUUID().slice(0, 8)}`;
  await gh(`/repos/${owner}/${repo}/labels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: labelName,
      color: 'ededed',
      description: 'Temporary TigerIQ P0 Preview permission diagnostic',
    }),
  });
  githubIssuesWrite = true;

  const instruction = 'Tính 6 × 7 và trả kết quả số.';
  const expectedEvidence = 'Executor returns the correct numeric result 42 with a concise evidence summary; independent reviewer passes; final judge passes.';
  const execution = await executeCloudTask({ instruction, expectedEvidence });
  const executorContains42 = /(^|\D)42(\D|$)/.test(String(execution.result || ''));
  if (execution.status !== 'completed' || !executorContains42) throw new Error('diagnostic_executor_result_invalid');

  const review = await reviewCloudTask({
    instruction,
    expectedEvidence,
    result: execution.result,
    evidenceSummary: execution.evidenceSummary,
  });
  if (!review.pass) throw new Error('diagnostic_reviewer_failed');

  const judge = await judgeCloudTask({
    instruction,
    expectedEvidence,
    result: execution.result,
    evidenceSummary: execution.evidenceSummary,
    review,
  });
  if (!judge.pass) throw new Error('diagnostic_judge_failed');

  console.log('P0_PREVIEW_RUNTIME_DIAGNOSTIC_PASS ' + JSON.stringify({
    githubMetadata,
    githubIssuesWrite,
    groqKeyPresent,
    executorContains42,
    executorModel: execution.modelUsed,
    reviewerPass: review.pass,
    reviewerModel: review.modelUsed,
    judgePass: judge.pass,
    judgeModel: judge.modelUsed,
  }));
} catch (error) {
  console.error('P0_PREVIEW_RUNTIME_DIAGNOSTIC_FAIL ' + String(error instanceof Error ? error.message : error).slice(0, 120));
  process.exitCode = 1;
} finally {
  if (labelName) {
    await gh(`/repos/${owner}/${repo}/labels/${encodeURIComponent(labelName)}`, { method: 'DELETE' }).catch(() => null);
  }
}
