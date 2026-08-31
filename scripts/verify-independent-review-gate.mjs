const { GITHUB_REPOSITORY, GITHUB_TOKEN, PR_NUMBER, HEAD_SHA } = process.env;

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

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

const exactHeadPatterns = [
  new RegExp(`Exact\\s+head\\s*:\\s*\\\`${HEAD_SHA}\\\``, 'i'),
  new RegExp(`Exact\\s+head\\s*:\\s*${HEAD_SHA}`, 'i'),
  new RegExp(`HEAD_SHA\\s*:\\s*\\\`${HEAD_SHA}\\\``, 'i'),
  new RegExp(`HEAD_SHA\\s*:\\s*${HEAD_SHA}`, 'i'),
];

const evidencePattern = /EVIDENCE_REF\s*:\s*(github:(?:issue|pr):\S+|commit:[0-9a-f]{40}|sha256:[0-9a-f]{64}|https:\/\/\S+)/i;

const isValidPass = (body) => {
  if (typeof body !== 'string') return false;
  if (!/\bTIGERIQ_INDEPENDENT_REVIEW_PASS\b/.test(body)) return false;
  if (!/REVIEW_ROLE\s*:\s*07\b/i.test(body)) return false;
  if (!exactHeadPatterns.some((pattern) => pattern.test(body))) return false;
  if (!evidencePattern.test(body)) return false;
  return true;
};

const [pull, reviews, comments] = await Promise.all([
  api(`/pulls/${PR_NUMBER}`),
  api(`/pulls/${PR_NUMBER}/reviews?per_page=100`),
  api(`/issues/${PR_NUMBER}/comments?per_page=100`),
]);

if (pull.head?.sha !== HEAD_SHA) {
  throw new Error(`PR head moved: expected ${HEAD_SHA}, actual ${pull.head?.sha || 'unknown'}`);
}

const candidates = [
  ...reviews.map((item) => ({ type: 'review', body: item.body, actor: item.user?.login, url: item.html_url })),
  ...comments.map((item) => ({ type: 'comment', body: item.body, actor: item.user?.login, url: item.html_url })),
];

const match = candidates.find((candidate) => isValidPass(candidate.body));
if (!match) {
  throw new Error(
    `Missing structured independent review PASS for exact head ${HEAD_SHA}. ` +
    'Required fields: TIGERIQ_INDEPENDENT_REVIEW_PASS, REVIEW_ROLE: 07, Exact head/HEAD_SHA, EVIDENCE_REF.'
  );
}

console.log(`Independent review gate PASS for ${HEAD_SHA}`);
console.log(`Evidence source: ${match.type} by ${match.actor || 'unknown'} ${match.url || ''}`);
