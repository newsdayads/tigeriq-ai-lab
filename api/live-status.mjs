const REPO = process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab';
const REGISTRY_ISSUE = 335;
const FETCH_TIMEOUT_MS = 5000;
const CACHE_MS = 8000;
let cache = { at: 0, value: null };

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(body));
}

function repoParts() {
  const [owner, repo] = REPO.split('/');
  if (!owner || !repo) throw new Error('invalid_repo');
  return { owner, repo };
}

async function gh(path, fetchImpl = fetch) {
  const token = String(process.env.TIGERIQ_GITHUB_TOKEN || '').trim();
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'tigeriq-live-status',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`https://api.github.com${path}`, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`github_${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function cell(value = '') {
  return String(value).replace(/`/g, '').replace(/\*\*/g, '').trim();
}

function workerIdFromText(value = '') {
  const match = String(value).toUpperCase().match(/(?:^|[^A-Z0-9])(NV\d{2})(?=$|[^A-Z0-9])/);
  return match?.[1] || null;
}

function cleanJobTitle(value = '', workerId = '') {
  return String(value)
    .replace(new RegExp(`^\\[${workerId}\\]\\s*`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export function parseRegistryWorkers(body = '') {
  const commandMap = new Map();
  for (const match of String(body).matchAll(/(?:`)?(\d+)↔(NV\d{2})(?:`)?/gi)) {
    commandMap.set(match[2].toUpperCase(), Number(match[1]));
  }

  const workers = [];
  const seen = new Set();
  for (const line of String(body).split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(cell);
    const directId = String(cells[0] || '').match(/^NV\d{2}$/i)?.[0]?.toUpperCase();
    const legacyId = String(cells[1] || '').match(/\bNV\d{2}\b/i)?.[0]?.toUpperCase();
    const employeeId = directId || legacyId;
    if (!employeeId || employeeId === 'NV00' || seen.has(employeeId)) continue;
    seen.add(employeeId);

    const label = directId ? (cells[1] || employeeId) : (cells[5] || cells[1] || employeeId);
    const adminState = directId ? (cells[2] || '') : (cells[6] || cells[4] || '');
    workers.push({
      employeeId,
      label,
      command: commandMap.get(employeeId) || null,
      adminState,
    });
  }
  return workers;
}

function registryFallback(worker) {
  const state = String(worker.adminState || '').toUpperCase();
  if (/PAUSED|RETIRED/.test(state)) {
    return { state: 'paused', status: 'TẠM NGƯNG', detail: 'Tạm ngưng theo Registry' };
  }
  if (/WAIT_KEY|BLOCKED/.test(state)) {
    return { state: 'blocked', status: 'BỊ CHẶN', detail: 'Không sẵn sàng theo Registry' };
  }
  if (/RATE_LIMIT|COOLDOWN|429/.test(state)) {
    return { state: 'waiting', status: 'CHỜ', detail: 'Đang chờ giới hạn tài nguyên' };
  }
  return { state: 'idle', status: 'RẢNH', detail: 'Không có việc GitHub đang chạy' };
}

function runUpdatedAt(run) {
  return Date.parse(run?.updated_at || run?.run_started_at || run?.created_at || 0) || 0;
}

function prUpdatedAt(pr) {
  return Date.parse(pr?.updated_at || pr?.created_at || 0) || 0;
}

function runWorker(run) {
  return workerIdFromText([run?.display_title, run?.name, run?.head_branch].filter(Boolean).join(' '));
}

function prWorker(pr) {
  return workerIdFromText([pr?.title, pr?.head?.ref].filter(Boolean).join(' '));
}

function statusForActiveRun(run) {
  const status = String(run?.status || '').toLowerCase();
  if (['queued', 'waiting', 'requested', 'pending'].includes(status)) return { state: 'waiting', status: 'CHỜ' };
  return { state: 'working', status: 'ĐANG LÀM' };
}

function progressForBranch(runs, branch) {
  const recent = runs.filter((run) => run?.head_branch === branch).sort((a, b) => runUpdatedAt(b) - runUpdatedAt(a));
  const latestByWorkflow = new Map();
  for (const run of recent) {
    const key = String(run?.name || run?.workflow_id || run?.id);
    if (!latestByWorkflow.has(key)) latestByWorkflow.set(key, run);
  }
  const batch = [...latestByWorkflow.values()];
  const passed = batch.filter((run) => run.status === 'completed' && run.conclusion === 'success').length;
  const failed = batch.filter((run) => run.status === 'completed' && !['success', 'skipped', 'neutral'].includes(String(run.conclusion || ''))).length;
  const active = batch.filter((run) => run.status !== 'completed').length;
  return {
    total: batch.length,
    passed,
    failed,
    active,
    percent: batch.length ? Math.round((passed / batch.length) * 100) : null,
  };
}

function sourceFromRun(run, owner, repo) {
  const prNumber = Array.isArray(run?.pull_requests) ? run.pull_requests[0]?.number : null;
  if (prNumber) return { type: 'PR', number: prNumber, url: `https://github.com/${owner}/${repo}/pull/${prNumber}` };
  return { type: 'Workflow', number: run?.run_number || null, url: run?.html_url || null };
}

export async function buildLiveStatus(fetchImpl = fetch) {
  const { owner, repo } = repoParts();
  const [registry, runPayload, pulls] = await Promise.all([
    gh(`/repos/${owner}/${repo}/issues/${REGISTRY_ISSUE}`, fetchImpl),
    gh(`/repos/${owner}/${repo}/actions/runs?per_page=100`, fetchImpl),
    gh(`/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=100`, fetchImpl),
  ]);

  const workers = parseRegistryWorkers(registry.body || '');
  const runs = Array.isArray(runPayload?.workflow_runs) ? runPayload.workflow_runs : [];
  const openPulls = Array.isArray(pulls) ? pulls : [];

  const rows = workers.map((worker) => {
    const workerRuns = runs.filter((run) => runWorker(run) === worker.employeeId).sort((a, b) => runUpdatedAt(b) - runUpdatedAt(a));
    const activeRuns = workerRuns.filter((run) => run?.status !== 'completed');
    const workerPulls = openPulls.filter((pr) => prWorker(pr) === worker.employeeId).sort((a, b) => prUpdatedAt(b) - prUpdatedAt(a));
    const newestActive = activeRuns[0] || null;

    if (newestActive) {
      const state = statusForActiveRun(newestActive);
      const progress = progressForBranch(workerRuns, newestActive.head_branch);
      const source = sourceFromRun(newestActive, owner, repo);
      if (progress.failed > 0 && progress.active === 0) {
        state.state = 'blocked';
        state.status = 'BỊ CHẶN';
      }
      return {
        ...worker,
        ...state,
        job: cleanJobTitle(newestActive.display_title || newestActive.name || 'GitHub workflow', worker.employeeId),
        detail: progress.total
          ? `${progress.passed}/${progress.total} luồng đạt · ${progress.active} đang chạy${progress.failed ? ` · ${progress.failed} lỗi` : ''}`
          : 'Workflow đang chạy',
        updatedAt: newestActive.updated_at || newestActive.run_started_at || newestActive.created_at || null,
        progress,
        source,
      };
    }

    const openPr = workerPulls[0] || null;
    if (openPr) {
      return {
        ...worker,
        state: 'waiting',
        status: 'CHỜ',
        job: cleanJobTitle(openPr.title || 'Pull request đang mở', worker.employeeId),
        detail: `PR #${openPr.number} đang mở · chờ kiểm tra/gộp`,
        updatedAt: openPr.updated_at || openPr.created_at || null,
        progress: null,
        source: { type: 'PR', number: openPr.number, url: openPr.html_url || null },
      };
    }

    const fallback = registryFallback(worker);
    const latest = workerRuns[0] || null;
    return {
      ...worker,
      ...fallback,
      job: fallback.state === 'idle' ? 'Không có việc đang chạy' : fallback.detail,
      detail: fallback.detail,
      updatedAt: latest?.updated_at || registry.updated_at || null,
      progress: null,
      source: latest ? sourceFromRun(latest, owner, repo) : null,
    };
  });

  const order = { working: 0, blocked: 1, waiting: 2, idle: 3, paused: 4 };
  rows.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || a.employeeId.localeCompare(b.employeeId));

  const summary = {
    working: rows.filter((row) => row.state === 'working').length,
    waiting: rows.filter((row) => row.state === 'waiting').length,
    blocked: rows.filter((row) => row.state === 'blocked').length,
    idle: rows.filter((row) => row.state === 'idle').length,
    paused: rows.filter((row) => row.state === 'paused').length,
    total: rows.length,
  };

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    refreshSeconds: 10,
    source: {
      repository: REPO,
      registryIssue: REGISTRY_ISSUE,
      registryUpdatedAt: registry.updated_at || null,
    },
    summary,
    workers: rows,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  try {
    const now = Date.now();
    if (cache.value && now - cache.at < CACHE_MS) return json(res, 200, cache.value);
    const value = await buildLiveStatus();
    cache = { at: now, value };
    return json(res, 200, value);
  } catch (error) {
    return json(res, 200, {
      ok: false,
      generatedAt: new Date().toISOString(),
      reason: String(error instanceof Error ? error.message : error).slice(0, 120),
      summary: { working: 0, waiting: 0, blocked: 0, idle: 0, paused: 0, total: 0 },
      workers: [],
    });
  }
}
