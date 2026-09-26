const REPO = 'newsdayads/tigeriq-ai-lab';
const BOOTSTRAP_PATHS = [
  'bootstrap/00_TIGERIQ_LOADER.md',
  'bootstrap/01_TIGERIQ_COMPANY_CONSTITUTION.md',
  'bootstrap/02_TIGERIQ_WORKFLOW.md',
  'bootstrap/03_TIGERIQ_AI_EMPLOYEE_MODEL.md',
  'bootstrap/05_TIGERIQ_BASELINE_DECISIONS.md',
  'bootstrap/06_TIGERIQ_SOURCE_INDEX.md',
  'docs/CURRENT_STATE.md',
];

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'TigerIQ-Source-Bundle/1.0' } });
  if (!response.ok) throw new Error(`SOURCE_FETCH_FAILED ${response.status} ${url}`);
  return response.text();
}

async function fetchIssue(number) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/issues/${number}`, {
    headers: { 'accept': 'application/vnd.github+json', 'user-agent': 'TigerIQ-Source-Bundle/1.0' },
  });
  if (!response.ok) throw new Error(`ISSUE_FETCH_FAILED #${number} ${response.status}`);
  const issue = await response.json();
  return `# GitHub Issue #${number} — ${issue.title}\n\nState: ${issue.state}\nUpdated: ${issue.updated_at}\n\n${issue.body || ''}`;
}

function pointer(body, key, fallback) {
  const match = String(body).match(new RegExp(`${key}=#(\\d+)`, 'i'));
  return match ? Number(match[1]) : fallback;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('method_not_allowed');
  }

  try {
    const ref = process.env.VERCEL_ENV === 'production' ? 'main' : (process.env.VERCEL_GIT_COMMIT_REF || 'main');
    const sections = [];
    for (const path of BOOTSTRAP_PATHS) {
      const url = `https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(ref).replace(/%2F/g, '/')}/${path}`;
      const text = await fetchText(url);
      sections.push(`\n\n---\nSOURCE: ${path}\nREF: ${ref}\n---\n\n${text}`);
    }

    const centralBody = await fetchIssue(280);
    const registryNumber = pointer(centralBody, 'REGISTRY_POINTER', 335);
    const interactionNumber = pointer(centralBody, 'INTERACTION_POINTER', 504);
    const [registryBody, interactionBody] = await Promise.all([
      fetchIssue(registryNumber),
      fetchIssue(interactionNumber),
    ]);

    sections.push(`\n\n---\nSOURCE: CENTRAL #280\n---\n\n${centralBody}`);
    sections.push(`\n\n---\nSOURCE: REGISTRY #${registryNumber}\n---\n\n${registryBody}`);
    sections.push(`\n\n---\nSOURCE: INTERACTION #${interactionNumber}\n---\n\n${interactionBody}`);

    const header = `# TIGERIQ LIVE SOURCE BUNDLE\nGenerated: ${new Date().toISOString()}\nRepository: ${REPO}\nRef: ${ref}\nPolicy: fail-closed; if this endpoint cannot assemble every mandatory source, it returns an error instead of stale/partial content.\n`;
    res.statusCode = 200;
    res.setHeader('content-type', 'text/markdown; charset=utf-8');
    res.setHeader('cache-control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.end(header + sections.join(''));
  } catch (error) {
    res.statusCode = 502;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.end(`SOURCE_UNAVAILABLE\n${error instanceof Error ? error.message : String(error)}`);
  }
}
