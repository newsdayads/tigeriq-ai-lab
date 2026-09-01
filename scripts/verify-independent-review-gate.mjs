import { pathToFileURL } from 'node:url';

const evidencePattern = /EVIDENCE_REF\s*:\s*(github:(?:issue|pr):\S+|commit:[0-9a-f]{40}|sha256:[0-9a-f]{64}|https:\/\/\S+)/i;

export function hasStructuredIndependentPass(body, headSha) {
  if (typeof body !== 'string' || !headSha) return false;
  const escapedHead = String(headSha).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactHeadPatterns = [
    new RegExp(`Exact\\s+head\\s*:\\s*\\\`${escapedHead}\\\``, 'i'),
    new RegExp(`Exact\\s+head\\s*:\\s*${escapedHead}`, 'i'),
    new RegExp(`HEAD_SHA\\s*:\\s*\\\`${escapedHead}\\\``, 'i'),
    new RegExp(`HEAD_SHA\\s*:\\s*${escapedHead}`, 'i'),
  ];
  return /\bTIGERIQ_INDEPENDENT_REVIEW_PASS\b/.test(body)
    && /REVIEW_ROLE\s*:\s*07\b/i.test(body)
    && exactHeadPatterns.some((pattern) => pattern.test(body))
    && evidencePattern.test(body);
}

export function isQualifyingIndependentReview(review, pull, headSha) {
  if (!review || !pull || !headSha) return false;
  if (String(review.state || '').toUpperCase() !== 'APPROVED') return false;
  if (String(review.commit_id || '') !== String(headSha)) return false;
  const reviewer = String(review.user?.login || '').trim().toLowerCase();
  const author = String(pull.user?.login || '').trim().toLowerCase();
  if (!reviewer || !author || reviewer === author) return false;
  return hasStructuredIndependentPass(review.body, headSha);
}

async function main() {
  const { GITHUB_REPOSITORY, GITHUB_TOKEN, PR_NUMBER, HEAD_SHA } = process.env;
  const required = (name, value) => {
    if (!value) throw new Error(`${name} is required`);
    return value;
  };

  required('GITHUB_REPOSITORY', GITHUB_REPOSITORY);
  required('GITHUB_TOKEN', GITHUB_TOKEN);
  required('PR_NUMBER', PR_NUMBER);
  required('HEAD_SHA', HEAD_SHA);

  const [owner, repo] = GITHUB_REPOSITORY.split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPOSITORY must be owner/repo');

  const api = async (path) => {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
      headers: {
        authorization: `Bearer ${GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'tigeriq-governance-gate',
      },
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
    return response.json();
  };

  const [pull, reviews] = await Promise.all([
    api(`/pulls/${PR_NUMBER}`),
    api(`/pulls/${PR_NUMBER}/reviews?per_page=100`),
  ]);

  if (pull.head?.sha !== HEAD_SHA) {
    throw new Error(`PR head moved: expected ${HEAD_SHA}, actual ${pull.head?.sha || 'unknown'}`);
  }

  const match = reviews.find((review) => isQualifyingIndependentReview(review, pull, HEAD_SHA));
  if (!match) {
    throw new Error(
      `Missing formal independent APPROVED review for exact head ${HEAD_SHA}. ` +
      'Required: reviewer actor != PR author, review.commit_id == HEAD_SHA, APPROVED state, ' +
      'TIGERIQ_INDEPENDENT_REVIEW_PASS, REVIEW_ROLE: 07, Exact head/HEAD_SHA, EVIDENCE_REF. ' +
      'Issue comments and self-authored reviews are not accepted.'
    );
  }

  console.log(`Independent review gate PASS for ${HEAD_SHA}`);
  console.log(`Formal approval by ${match.user?.login || 'unknown'} review ${match.html_url || match.id || ''}`);
}

const executedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
