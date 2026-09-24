const REPO = process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab';
const REGISTRY_ISSUE = 335;
const FETCH_TIMEOUT_MS = 5000;
const CACHE_MS = 3000;
const RUNTIME_POINTER_ISSUE = 1402;
const RUNTIME_FETCH_TIMEOUT_MS = 4500;
const POINTER_CACHE_MS = 60000;
const QUEUE_LIMIT = 8;
let pointerCache = { at: 0, url: null };
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

  return buildWorkSections({
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
    liveConnected: false,
  }, fetchImpl, { runs, pulls: openPulls });
}

export function parseRuntimeBridgeUrl(body = '') {
  const match = String(body).match(/^LIVE_STATUS_BRIDGE_URL=(https:\/\/\S+)$/mi);
  if (!match) throw new Error('runtime_bridge_pointer_missing');
  const url = new URL(match[1].trim());
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('runtime_bridge_pointer_invalid');
  const host = url.hostname.toLowerCase();
  if (!(host.endsWith('.trycloudflare.com') || host.endsWith('.ts.net'))) throw new Error('runtime_bridge_host_not_allowed');
  return url.origin;
}

function cleanText(value, max = 220) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sanitizeRuntimeWorker(worker = {}) {
  const allowedStates = new Set(['working', 'waiting', 'blocked', 'idle', 'unknown', 'paused']);
  const employeeId = String(worker.employeeId || '').toUpperCase();
  if (!/^NV\d{2}$/.test(employeeId)) return null;
  const state = allowedStates.has(worker.state) ? worker.state : 'unknown';
  return {
    employeeId,
    label: cleanText(worker.label || employeeId, 80),
    kind: worker.kind === 'ui' ? 'ui' : 'api',
    state,
    status: cleanText(worker.status || 'CHƯA RÕ', 32),
    job: cleanText(worker.job || 'Không có dữ liệu việc hiện tại', 220),
    detail: cleanText(worker.detail || '', 220),
    updatedAt: typeof worker.updatedAt === 'string' ? worker.updatedAt.slice(0, 64) : null,
    heartbeatAt: typeof worker.heartbeatAt === 'string' ? worker.heartbeatAt.slice(0, 64) : null,
    currentJobId: worker.currentJobId ? cleanText(worker.currentJobId, 100) : null,
    prNumber: Number.isInteger(worker.prNumber) ? worker.prNumber : null,
    provider: worker.provider ? cleanText(worker.provider, 64) : null,
    model: worker.model ? cleanText(worker.model, 100) : null,
    cooldownUntil: typeof worker.cooldownUntil === 'string' ? worker.cooldownUntil.slice(0, 64) : null,
    lastError: worker.lastError ? cleanText(worker.lastError, 80) : null,
    source: 'PC01 live runtime',
  };
}


export function parseIssueNumber(...values) {
  for (const value of values) {
    const text = String(value || '');
    const match = text.match(/(?:GH-|#|issues\/)(\d{1,6})(?!\d)/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function bodyValue(body, key) {
  const escaped = String(key).replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  return String(body || '').match(new RegExp('^' + escaped + '=(.+)$', 'mi'))?.[1]?.trim() || '';
}

function bodyFlag(body, key, value = 'true') {
  return bodyValue(body, key).toLowerCase() === String(value).toLowerCase();
}

function issuePriority(issue) {
  const body = String(issue?.body || '');
  return bodyValue(body, 'PRIORITY').match(/^P[0-3]$/i)?.[0]?.toUpperCase()
    || String(issue?.title || '').match(/^\[(P[0-3])\]/i)?.[1]?.toUpperCase()
    || null;
}

function issueIsTerminal(issue) {
  if (!issue || issue.pull_request || issue.state !== 'open') return true;
  const body = String(issue.body || '');
  const state = bodyValue(body, 'STATE').toUpperCase();
  return ['CLOSED', 'DONE', 'COMPLETED', 'SUPERSEDED', 'CANCELLED'].includes(state)
    || /^SUPERSEDED(?:_BY)?=/mi.test(body)
    || bodyFlag(body, 'TIGERIQ_EXECUTABLE', 'false');
}

function issueIsTerminalOrExcluded(issue) {
  if (issueIsTerminal(issue)) return true;
  const body = String(issue.body || '');
  const state = bodyValue(body, 'STATE').toUpperCase();
  return state === 'EXCLUDED' || bodyFlag(body, 'EXCLUDED') || bodyValue(body, 'AUTO_QUEUE').toUpperCase() === 'EXCLUDED';
}

function queueWaitReason(issue) {
  const body = String(issue?.body || '');
  const state = bodyValue(body, 'STATE').toUpperCase();
  if (bodyFlag(body, 'OWNER_HOLD') || state === 'OWNER_HOLD' || state === 'MANUAL_HOLD') return 'OWNER_HOLD';
  if (state.includes('BLOCKED')) return bodyValue(body, 'BLOCKER') || bodyValue(body, 'BLOCKED_REASON') || state;
  if (/^(?:WAIT|PENDING)/.test(state)) return state;
  return null;
}

function queueDependencies(issue) {
  const raw = bodyValue(issue?.body || '', 'DEPENDS_ON');
  return [...new Set((raw.match(/#?\d+/g) || []).map((value) => Number(value.replace('#', ''))).filter(Boolean))].slice(0, 16);
}

export function parseQueueIssue(issue) {
  if (issueIsTerminalOrExcluded(issue)) return null;
  const body = String(issue.body || '');
  const autoQueue = bodyValue(body, 'AUTO_QUEUE').toUpperCase();
  const ownerPolicy = bodyValue(body, 'OWNER_POLICY').toUpperCase();
  const executable = bodyFlag(body, 'TIGERIQ_EXECUTABLE');
  if (!executable || (autoQueue !== 'INCLUDED' && ownerPolicy !== 'AUTO')) return null;
  const priority = issuePriority(issue) || 'P2';
  const holdReason = queueWaitReason(issue);
  return {
    number: Number(issue.number),
    title: String(issue.title || ''),
    priority,
    ownerDirect: bodyFlag(body, 'OWNER_DIRECT'),
    status: holdReason && /BLOCKED/.test(holdReason) ? 'BLOCKED' : holdReason ? 'WAITING' : 'QUEUED',
    waitReason: holdReason,
    dependencies: queueDependencies(issue),
    updatedAt: issue.updated_at || null,
    url: issue.html_url || null,
  };
}

export function compareQueueRows(a, b) {
  if (Boolean(a?.ownerDirect) !== Boolean(b?.ownerDirect)) return a?.ownerDirect ? -1 : 1;
  const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const delta = (rank[a?.priority] ?? 2) - (rank[b?.priority] ?? 2);
  return delta || Number(a?.number || 0) - Number(b?.number || 0);
}

function runtimeState(state) {
  if (state === 'working') return 'WORKING';
  if (state === 'blocked') return 'BLOCKED';
  if (state === 'waiting') return 'WAITING';
  return null;
}

export function runtimeWorkRows(workers = []) {
  const rows = [];
  const seen = new Set();
  for (const worker of workers) {
    const issueNumber = parseIssueNumber(worker?.currentJobId, worker?.job, worker?.detail);
    const status = runtimeState(worker?.state);
    if (!issueNumber || !status) continue;
    const key = issueNumber + ':' + String(worker?.employeeId || '');
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      issueNumber,
      employeeId: worker.employeeId || null,
      runtimeStatus: status,
      currentStep: cleanText(worker.detail || worker.job || '', 220) || null,
      updatedAt: worker.heartbeatAt || worker.updatedAt || null,
      prNumber: Number.isInteger(worker.prNumber) ? worker.prNumber : null,
      source: 'PC01 live runtime',
    });
  }
  return rows;
}

function pullMentionsIssue(pull, issueNumber) {
  const n = String(issueNumber);
  const text = [pull?.title, pull?.body, pull?.head?.ref].filter(Boolean).join('\n');
  return new RegExp('(?:#|GH-|issue[-_/ ])' + n + '(?!\\d)', 'i').test(text);
}

function summarizeChecks(runs, pull) {
  if (!pull) return null;
  const branch = pull?.head?.ref;
  const branchRuns = (Array.isArray(runs) ? runs : []).filter((run) => run?.head_branch === branch);
  const latest = new Map();
  for (const run of branchRuns.sort((a, b) => runUpdatedAt(b) - runUpdatedAt(a))) {
    const key = String(run?.name || run?.workflow_id || run?.id);
    if (!latest.has(key)) latest.set(key, run);
  }
  const batch = [...latest.values()];
  if (!batch.length) return null;
  const active = batch.filter((run) => run?.status !== 'completed').length;
  const failed = batch.filter((run) => run?.status === 'completed' && !['success', 'neutral', 'skipped'].includes(String(run?.conclusion || ''))).length;
  const passed = batch.filter((run) => run?.status === 'completed' && run?.conclusion === 'success').length;
  return { state: failed ? 'LỖI' : active ? 'ĐANG CHẠY' : 'ĐẠT', passed, total: batch.length, active, failed };
}

async function dependencyStates(rows, owner, repo, fetchImpl) {
  const deps = [...new Set(rows.flatMap((row) => row.dependencies || []))];
  const results = new Map();
  await Promise.all(deps.map(async (number) => {
    try {
      const dep = await gh('/repos/' + owner + '/' + repo + '/issues/' + number, fetchImpl);
      results.set(number, { state: dep?.state || 'unknown', isPull: Boolean(dep?.pull_request) });
    } catch {
      results.set(number, { state: 'unknown' });
    }
  }));
  return results;
}

function githubActiveState(issue) {
  const body = String(issue?.body || '');
  const state = bodyValue(body, 'STATE').toUpperCase();
  const owner = bodyValue(body, 'MUTATION_OWNER') || bodyValue(body, 'ASSIGNED_EXECUTOR') || bodyValue(body, 'ACTIVE_OWNER');
  if (!owner) return null;
  if (['WORKING', 'RUNNING', 'IN_PROGRESS'].includes(state)) return { status: 'WORKING', owner };
  if (['REVIEW', 'VERIFY', 'REVIEWING'].includes(state)) return { status: 'REVIEW', owner };
  if (state.includes('BLOCKED')) return { status: 'BLOCKED', owner };
  if (state === 'WAITING') return { status: 'WAITING', owner };
  return null;
}

async function githubIssue(owner, repo, number, issueMap, fetchImpl) {
  if (issueMap.has(number)) return issueMap.get(number);
  try { return await gh('/repos/' + owner + '/' + repo + '/issues/' + number, fetchImpl); } catch { return null; }
}

async function buildWorkSections(base, fetchImpl = fetch, known = {}) {
  const { owner, repo } = repoParts();
  try {
    const [issues, pulls, runPayload] = await Promise.all([
      gh('/repos/' + owner + '/' + repo + '/issues?state=open&per_page=100&sort=updated&direction=desc', fetchImpl),
      known.pulls ? Promise.resolve(known.pulls) : gh('/repos/' + owner + '/' + repo + '/pulls?state=open&sort=updated&direction=desc&per_page=100', fetchImpl),
      known.runs ? Promise.resolve({ workflow_runs: known.runs }) : gh('/repos/' + owner + '/' + repo + '/actions/runs?per_page=100', fetchImpl),
    ]);
    const openIssues = (Array.isArray(issues) ? issues : []).filter((issue) => !issue?.pull_request);
    const openPulls = Array.isArray(pulls) ? pulls : [];
    const runs = Array.isArray(runPayload?.workflow_runs) ? runPayload.workflow_runs : [];
    const issueMap = new Map(openIssues.map((issue) => [Number(issue.number), issue]));
    const activeRows = [];
    const activeNumbers = new Set();

    for (const row of runtimeWorkRows(base.workers || [])) {
      const issue = await githubIssue(owner, repo, row.issueNumber, issueMap, fetchImpl);
      if (!issue || issue.pull_request || issue.state !== 'open') continue;
      activeNumbers.add(row.issueNumber);
      const pull = row.prNumber
        ? openPulls.find((item) => Number(item.number) === row.prNumber)
        : openPulls.find((item) => pullMentionsIssue(item, row.issueNumber));
      const checks = summarizeChecks(runs, pull);
      const liveStatus = checks?.state === 'LỖI' ? 'BLOCKED' : row.runtimeStatus === 'WAITING' && pull ? 'REVIEW' : row.runtimeStatus;
      activeRows.push({
        number: row.issueNumber,
        title: String(issue.title || ''),
        priority: issuePriority(issue),
        employeeId: row.employeeId,
        status: liveStatus,
        currentStep: row.currentStep,
        prNumber: pull?.number || row.prNumber || null,
        prUrl: pull?.html_url || null,
        checks,
        evidenceUrl: pull?.html_url || issue.html_url || null,
        updatedAt: row.updatedAt || issue.updated_at || null,
        url: issue.html_url || null,
        live: base.liveConnected === true,
      });
    }

    for (const pull of openPulls) {
      const issueNumber = parseIssueNumber(pull?.body, pull?.title, pull?.head?.ref);
      if (!issueNumber || activeNumbers.has(issueNumber)) continue;
      const issue = await githubIssue(owner, repo, issueNumber, issueMap, fetchImpl);
      if (!issue || issue.pull_request || issue.state !== 'open' || issueIsTerminal(issue)) continue;
      const checks = summarizeChecks(runs, pull);
      activeNumbers.add(issueNumber);
      activeRows.push({
        number: issueNumber,
        title: String(issue.title || ''),
        priority: issuePriority(issue),
        employeeId: bodyValue(issue.body || '', 'MUTATION_OWNER') || prWorker(pull) || null,
        status: checks?.state === 'LỖI' ? 'BLOCKED' : 'REVIEW',
        currentStep: checks?.state === 'LỖI' ? 'Kiểm tra PR đang lỗi'
          : checks?.state === 'ĐANG CHẠY' ? 'Đang chạy kiểm tra PR'
            : 'PR đang mở · chờ hoàn tất kiểm tra/rà soát',
        prNumber: pull.number || null,
        prUrl: pull.html_url || null,
        checks,
        evidenceUrl: pull.html_url || issue.html_url || null,
        updatedAt: pull.updated_at || issue.updated_at || null,
        url: issue.html_url || null,
        live: false,
      });
    }

    if (base.liveConnected !== true) {
      for (const issue of openIssues) {
        const issueNumber = Number(issue.number);
        if (!issueNumber || activeNumbers.has(issueNumber) || issueIsTerminal(issue)) continue;
        const explicit = githubActiveState(issue);
        if (!explicit) continue;
        const pull = openPulls.find((item) => pullMentionsIssue(item, issueNumber));
        const checks = summarizeChecks(runs, pull);
        const status = checks?.state === 'LỖI' ? 'BLOCKED' : pull && explicit.status === 'WAITING' ? 'REVIEW' : explicit.status;
        activeNumbers.add(issueNumber);
        activeRows.push({
          number: issueNumber,
          title: String(issue.title || ''),
          priority: issuePriority(issue),
          employeeId: explicit.owner,
          status,
          currentStep: bodyValue(issue.body || '', 'CURRENT_STEP')
            || bodyValue(issue.body || '', 'NEXT_ACTION')
            || 'GitHub STATE=' + bodyValue(issue.body || '', 'STATE'),
          prNumber: pull?.number || null,
          prUrl: pull?.html_url || null,
          checks,
          evidenceUrl: pull?.html_url || issue.html_url || null,
          updatedAt: issue.updated_at || null,
          url: issue.html_url || null,
          live: false,
        });
      }
    }

    if (!activeRows.length && base.liveConnected !== true) {
      for (const worker of base.workers || []) {
        const issueNumber = parseIssueNumber(worker?.job, worker?.source?.url);
        if (!issueNumber || activeNumbers.has(issueNumber) || !['working', 'waiting', 'blocked'].includes(worker?.state)) continue;
        const issue = issueMap.get(issueNumber);
        if (!issue || issue.state !== 'open') continue;
        const pull = openPulls.find((item) => Number(item.number) === Number(worker?.source?.number) || pullMentionsIssue(item, issueNumber));
        const checks = summarizeChecks(runs, pull);
        activeNumbers.add(issueNumber);
        activeRows.push({
          number: issueNumber,
          title: String(issue.title || ''),
          priority: issuePriority(issue),
          employeeId: worker.employeeId || null,
          status: worker.state === 'blocked' || checks?.state === 'LỖI' ? 'BLOCKED' : pull ? 'REVIEW' : worker.state === 'working' ? 'WORKING' : 'WAITING',
          currentStep: cleanText(worker.detail || worker.job || '', 220) || null,
          prNumber: pull?.number || null,
          prUrl: pull?.html_url || null,
          checks,
          evidenceUrl: pull?.html_url || issue.html_url || null,
          updatedAt: worker.updatedAt || issue.updated_at || null,
          url: issue.html_url || null,
          live: false,
        });
      }
    }

    const specs = openIssues.map(parseQueueIssue).filter(Boolean).filter((row) => !activeNumbers.has(row.number)).sort(compareQueueRows);
    const queueCandidates = specs.slice(0, Math.max(QUEUE_LIMIT * 2, 12));
    const depStates = await dependencyStates(queueCandidates, owner, repo, fetchImpl);
    const nextQueue = queueCandidates.map((row) => {
      if (row.status !== 'QUEUED') return row;
      const waiting = (row.dependencies || []).filter((number) => {
        const dep = depStates.get(number);
        return !dep || dep.state !== 'closed' || dep.isPull === true;
      });
      if (!waiting.length) return row;
      const unknown = waiting.filter((number) => depStates.get(number)?.state === 'unknown');
      return {
        ...row,
        status: unknown.length ? 'BLOCKED' : 'WAITING',
        waitReason: unknown.length
          ? 'Chưa xác minh dependency ' + unknown.map((n) => '#' + n).join(', ')
          : 'Chờ ' + waiting.map((n) => '#' + n).join(', '),
      };
    }).slice(0, QUEUE_LIMIT);

    return {
      ...base,
      activeWork: activeRows.sort((a, b) => compareQueueRows(
        { ownerDirect: false, priority: a.priority || 'P2', number: a.number },
        { ownerDirect: false, priority: b.priority || 'P2', number: b.number },
      )),
      nextQueue,
      workProjection: {
        mode: base.liveConnected ? 'pc01-live+github' : 'github-fallback',
        queuePolicy: 'OWNER_DIRECT>P0>P1>P2>P3',
        source: 'PC01 runtime when available + GitHub canonical',
      },
    };
  } catch (error) {
    return {
      ...base,
      activeWork: [],
      nextQueue: [],
      workProjection: {
        mode: 'unavailable',
        queuePolicy: 'OWNER_DIRECT>P0>P1>P2>P3',
        source: 'GitHub unavailable',
        reason: String(error instanceof Error ? error.message : error).slice(0, 120),
      },
    };
  }
}

export function sanitizeRuntimePayload(payload) {
  if (!payload || payload.ok !== true || !Array.isArray(payload.workers)) throw new Error('runtime_bridge_payload_invalid');
  const workers = payload.workers.map(sanitizeRuntimeWorker).filter(Boolean);
  const summary = {
    working: workers.filter((w) => w.state === 'working').length,
    waiting: workers.filter((w) => w.state === 'waiting').length,
    blocked: workers.filter((w) => w.state === 'blocked').length,
    idle: workers.filter((w) => w.state === 'idle').length,
    unknown: workers.filter((w) => w.state === 'unknown').length,
    paused: workers.filter((w) => w.state === 'paused').length,
    total: workers.length,
  };
  return {
    ok: true,
    liveConnected: true,
    mode: 'pc01-live',
    authority: 'PC01 live runtime',
    generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt.slice(0, 64) : new Date().toISOString(),
    refreshSeconds: 5,
    source: {
      runtime: 'PC01 Core + Coding Lane',
      core: payload.source?.core === true,
      coding: payload.source?.coding === true,
      uiAutopilot: payload.source?.uiAutopilot === true,
    },
    summary,
    workers,
    activeWork: runtimeWorkRows(workers),
    nextQueue: [],
  };
}

async function resolveRuntimeBridge(fetchImpl = fetch) {
  const now = Date.now();
  if (pointerCache.url && now - pointerCache.at < POINTER_CACHE_MS) return pointerCache.url;
  const { owner, repo } = repoParts();
  const issue = await gh(`/repos/${owner}/${repo}/issues/${RUNTIME_POINTER_ISSUE}`, fetchImpl);
  const url = parseRuntimeBridgeUrl(issue.body || '');
  pointerCache = { at: now, url };
  return url;
}

export async function fetchPc01Live(fetchImpl = fetch) {
  const base = await resolveRuntimeBridge(fetchImpl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUNTIME_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${base}/status`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`runtime_bridge_http_${response.status}`);
    return buildWorkSections(sanitizeRuntimePayload(await response.json()), fetchImpl);
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  const now = Date.now();
  if (cache.value && now - cache.at < CACHE_MS) return json(res, 200, cache.value);

  let liveError = null;
  try {
    const value = await fetchPc01Live();
    cache = { at: now, value };
    return json(res, 200, value);
  } catch (error) {
    liveError = String(error instanceof Error ? error.message : error).slice(0, 120);
  }

  try {
    const value = await buildLiveStatus();
    value.liveConnected = false;
    value.mode = 'github-fallback';
    value.authority = 'GitHub/Registry fallback';
    value.refreshSeconds = 5;
    value.liveReason = liveError;
    cache = { at: now, value };
    return json(res, 200, value);
  } catch (error) {
    return json(res, 200, {
      ok: false,
      liveConnected: false,
      mode: 'unavailable',
      authority: 'Không có nguồn live',
      generatedAt: new Date().toISOString(),
      reason: liveError || String(error instanceof Error ? error.message : error).slice(0, 120),
      summary: { working: 0, waiting: 0, blocked: 0, idle: 0, unknown: 0, paused: 0, total: 0 },
      workers: [],
      activeWork: [],
      nextQueue: [],
      workProjection: {
        mode: 'unavailable',
        queuePolicy: 'OWNER_DIRECT>P0>P1>P2>P3',
        source: 'Không có nguồn xác minh',
      },
    });
  }
}
