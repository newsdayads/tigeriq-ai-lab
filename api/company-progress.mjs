const REPO = process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab';
const FETCH_TIMEOUT_MS = 5000;
const CENTRAL_ISSUE = 280;
const BASE_GATES = ['CI', 'WO-014 Queue Hygiene', 'WO-012/013 Vercel Online Verify'];

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
    'user-agent': 'tigeriq-company-progress',
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

function runState(run) {
  if (!run) return 'pending';
  if (run.status !== 'completed') return 'running';
  return run.conclusion === 'success' ? 'pass' : 'fail';
}

function latestRunByName(runs, name) {
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => run?.name === name)
    .sort((a, b) => Date.parse(b.updated_at || b.created_at || 0) - Date.parse(a.updated_at || a.created_at || 0))[0] || null;
}

function vietnameseGate(name) {
  if (name === 'Code / PR') return 'Code / PR';
  if (name === 'CI') return 'Kiểm thử tự động (CI)';
  if (name === 'WO-014 Queue Hygiene') return 'Kiểm tra hàng đợi';
  if (name === 'WO-012/013 Vercel Online Verify') return 'Kiểm tra Web/Vercel';
  if (name === 'Android Worker') return 'Build Android Worker';
  if (name === 'Independent Review') return 'Rà soát độc lập';
  if (name === 'Merge + Production') return 'Merge + Production';
  return name;
}

function statusLabel(status) {
  return ({ pass: 'ĐẠT', running: 'ĐANG XỬ LÝ', fail: 'BỊ CHẶN', pending: 'CHỜ' })[status] || 'CHỜ';
}

function reviewState(reviews) {
  const rows = Array.isArray(reviews) ? reviews : [];
  if (rows.some((review) => String(review?.state || '').toUpperCase() === 'CHANGES_REQUESTED')) return 'fail';
  if (rows.some((review) => String(review?.state || '').toUpperCase() === 'APPROVED')) return 'pass';
  return 'pending';
}

function section(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(body || '').match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i'));
  return (match?.[1] || '').trim();
}

function compact(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function parentIssueNumber(pull) {
  const body = String(pull?.body || '');
  const title = String(pull?.title || '');
  const explicit = body.match(/\bParent\s+#(\d+)\b/i);
  if (explicit) return Number(explicit[1]);
  const titled = title.match(/^#(\d+)\s*:/);
  return titled ? Number(titled[1]) : null;
}

function issueGoal(issue) {
  return compact(section(issue?.body, 'Mục tiêu') || issue?.title || 'Mục tiêu chưa được ghi rõ', 360);
}

function laneStatusFromText(text) {
  const value = String(text || '');
  if (/BỊ CHẶN|KHÔNG ĐẠT|\bLỖI\b/i.test(value)) return 'fail';
  if (/ĐANG XỬ LÝ|IN PROGRESS|STATE=ACTIVE/i.test(value)) return 'running';
  if (/\bCHỜ\b|\bCHƯA\b|không mở|cần explicit|cần Owner|authorization/i.test(value)) return 'pending';
  if (/\bĐẠT\b|\bHOÀN TẤT\b/i.test(value)) return 'pass';
  return 'pending';
}

export function projectCentralLanes({ centralBody = '', activeWork = null, parentIssue = null } = {}) {
  const p0 = section(centralBody, 'P0 hiện hành');
  const lanes = [];
  const pattern = /^###\s+#(\d+)\s+[—-]\s+([^\n]+)\n([\s\S]*?)(?=^###\s+#|$)/gm;
  for (const match of p0.matchAll(pattern)) {
    const number = Number(match[1]);
    const detail = String(match[3] || '').trim();
    const status = laneStatusFromText(detail);
    lanes.push({
      number,
      priority: 'P0',
      title: compact(match[2], 120),
      status,
      statusLabel: statusLabel(status),
      current: false,
      reason: compact(detail.split('\n').find((line) => line.trim().startsWith('-')) || detail, 180),
    });
  }

  const parentNumber = Number(activeWork?.parentIssueNumber || 0);
  if (parentNumber) {
    const status = activeWork.statusKey || 'pending';
    const existing = lanes.find((lane) => lane.number === parentNumber);
    if (existing) {
      existing.status = status;
      existing.statusLabel = statusLabel(status);
      existing.current = true;
      existing.reason = compact(activeWork.currentStep, 180);
    } else {
      const title = compact(parentIssue?.title || activeWork.initiative || `#${parentNumber}`, 120);
      const priority = title.match(/\[(P\d+)\]/i)?.[1]?.toUpperCase() || 'HIỆN TẠI';
      lanes.unshift({
        number: parentNumber,
        priority,
        title,
        status,
        statusLabel: statusLabel(status),
        current: true,
        reason: compact(activeWork.currentStep, 180),
      });
    }
  }
  return lanes.slice(0, 8);
}

export function projectProgress({ pull, runs = [], reviews = [] }) {
  if (!pull) {
    return {
      active: false,
      progressPct: 0,
      progressMode: 'ước lượng quản trị',
      progressBasis: 'Chưa có lane kỹ thuật có bằng chứng đang mở',
      gates: [],
      statusKey: 'pending',
      statusLabel: statusLabel('pending'),
      currentStep: 'Chưa có lane kỹ thuật có bằng chứng đang mở',
      nextStep: 'Chief sẽ tự chọn việc ưu tiên tiếp theo',
    };
  }

  const names = [...BASE_GATES];
  const text = `${pull.title || ''}\n${pull.body || ''}`.toLowerCase();
  if (text.includes('android worker') || text.includes('android')) names.push('Android Worker');

  const gates = [
    { name: 'Code / PR', status: 'pass' },
    ...names.map((name) => ({ name, status: runState(latestRunByName(runs, name)) })),
    { name: 'Independent Review', status: reviewState(reviews) },
    { name: 'Merge + Production', status: 'pending' },
  ].map((gate) => ({ ...gate, label: vietnameseGate(gate.name) }));

  const passed = gates.filter((gate) => gate.status === 'pass').length;
  const progressPct = Math.round((passed / gates.length) * 100);
  const blocking = gates.find((gate) => gate.status === 'fail');
  const running = gates.find((gate) => gate.status === 'running');
  const pending = gates.find((gate) => gate.status === 'pending');
  const focus = blocking || running || pending;
  const statusKey = blocking ? 'fail' : running ? 'running' : pending ? 'pending' : 'pass';

  let currentStep = 'Đang hoàn thiện';
  if (blocking) currentStep = `Đang xử lý blocker: ${blocking.label}`;
  else if (running) currentStep = `Đang chạy: ${running.label}`;
  else if (pending?.name === 'Independent Review') currentStep = 'Chờ rà soát độc lập';
  else if (pending?.name === 'Merge + Production') currentStep = 'Các gate kỹ thuật đã ĐẠT · chờ gate merge/Production';
  else if (pending) currentStep = `Chuẩn bị: ${pending.label}`;

  return {
    active: true,
    progressPct,
    progressMode: 'ước lượng quản trị',
    progressBasis: `${passed}/${gates.length} mốc kiểm chứng đã có bằng chứng; các mốc được tính trọng số ngang nhau`,
    gates,
    statusKey,
    statusLabel: statusLabel(statusKey),
    currentStep,
    nextStep: focus?.name === 'Merge + Production' ? 'Qua gate merge/Production khi có quyền phù hợp' : `Hoàn thành ${focus?.label || 'gate hiện tại'}`,
  };
}

function recentActivity(runs) {
  return (Array.isArray(runs) ? runs : [])
    .slice()
    .sort((a, b) => Date.parse(b.updated_at || b.created_at || 0) - Date.parse(a.updated_at || a.created_at || 0))
    .slice(0, 8)
    .map((run) => ({
      name: vietnameseGate(run.name),
      status: runState(run),
      at: run.updated_at || run.created_at || null,
      url: run.html_url || null,
    }));
}

export async function buildCompanyProgress(fetchImpl = fetch) {
  const { owner, repo } = repoParts();
  const [pullsRaw, central] = await Promise.all([
    gh(`/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=30`, fetchImpl),
    gh(`/repos/${owner}/${repo}/issues/${CENTRAL_ISSUE}`, fetchImpl),
  ]);
  const pulls = Array.isArray(pullsRaw) ? pullsRaw : [];
  const activePull = pulls
    .filter((pull) => parentIssueNumber(pull) || /^WO-\d+/i.test(String(pull?.title || '')))
    .sort((a, b) => Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0))[0] || null;

  let runs = [];
  let reviews = [];
  let parentIssue = null;
  const parentNumber = parentIssueNumber(activePull);
  if (activePull) {
    const requests = [
      activePull.head?.sha
        ? gh(`/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(activePull.head.sha)}&per_page=50`, fetchImpl)
        : Promise.resolve({ workflow_runs: [] }),
      activePull.number
        ? gh(`/repos/${owner}/${repo}/pulls/${activePull.number}/reviews?per_page=50`, fetchImpl)
        : Promise.resolve([]),
      parentNumber
        ? gh(`/repos/${owner}/${repo}/issues/${parentNumber}`, fetchImpl)
        : Promise.resolve(null),
    ];
    const [runResponse, reviewResponse, issueResponse] = await Promise.all(requests);
    runs = Array.isArray(runResponse?.workflow_runs) ? runResponse.workflow_runs : [];
    reviews = Array.isArray(reviewResponse) ? reviewResponse : [];
    parentIssue = issueResponse;
  }

  const progress = projectProgress({ pull: activePull, runs, reviews });
  const activeWork = activePull ? {
    number: activePull.number,
    title: String(activePull.title || '').slice(0, 160),
    branch: activePull.head?.ref || null,
    headSha: activePull.head?.sha || null,
    updatedAt: activePull.updated_at || null,
    url: activePull.html_url || null,
    parentIssueNumber: parentNumber,
    goal: issueGoal(parentIssue),
    initiative: parentIssue ? `#${parentIssue.number} · ${compact(parentIssue.title, 180)}` : compact(activePull.title, 180),
    source: parentIssue ? `CENTRAL #${CENTRAL_ISSUE} + issue #${parentIssue.number} + PR #${activePull.number}` : `CENTRAL #${CENTRAL_ISSUE} + PR #${activePull.number}`,
    ...progress,
  } : progress;
  const lanes = projectCentralLanes({ centralBody: central?.body || '', activeWork, parentIssue });
  const ownerGateReady = Boolean(activePull && !activePull.draft && progress.gates.length && progress.gates.every((gate) => gate.name === 'Merge + Production' || gate.status === 'pass'));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    mode: 'authoritative-github',
    activeWork,
    lanes,
    activity: recentActivity(runs),
    ownerAction: ownerGateReady
      ? { required: true, summary: 'Đã tới gate merge/Production; cần quyền phát hành phù hợp.' }
      : { required: false, summary: 'Chưa có thao tác bắt buộc từ anh Sơn ở gate hiện tại.' },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  try {
    return json(res, 200, await buildCompanyProgress());
  } catch (error) {
    return json(res, 200, {
      ok: false,
      generatedAt: new Date().toISOString(),
      mode: 'unavailable',
      activeWork: null,
      lanes: [],
      activity: [],
      ownerAction: { required: false, summary: 'Chưa lấy được tiến độ GitHub; không suy đoán trạng thái.' },
      reason: String(error instanceof Error ? error.message : error).slice(0, 96),
    });
  }
}