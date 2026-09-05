const REPO = process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab';
const FETCH_TIMEOUT_MS = 5000;
const CENTRAL_ISSUE = 280;
const REGISTRY_ISSUE = 335;
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
  if (name === 'Merge + Production') return 'Merge + Production';
  return name;
}

// Compatibility helper: unit tests and internal callers still rely on this
// evidence-gate calculation. The public projection below no longer uses PR
// recency as its source of truth.
export function projectProgress({ pull, runs = [] }) {
  if (!pull) {
    return {
      active: false,
      progressPct: 100,
      gates: [],
      currentStep: 'Không có PR kỹ thuật đang mở',
      nextStep: 'Chief sẽ tự chọn việc ưu tiên tiếp theo',
    };
  }

  const names = [...BASE_GATES];
  const text = `${pull.title || ''}\n${pull.body || ''}`.toLowerCase();
  if (text.includes('android worker') || text.includes('android')) names.push('Android Worker');

  const gates = [
    { name: 'Code / PR', status: 'pass' },
    ...names.map((name) => ({ name, status: runState(latestRunByName(runs, name)) })),
    { name: 'Merge + Production', status: 'pending' },
  ].map((gate) => ({ ...gate, label: vietnameseGate(gate.name) }));

  const passed = gates.filter((gate) => gate.status === 'pass').length;
  const progressPct = Math.round((passed / gates.length) * 100);
  const blocking = gates.find((gate) => gate.status === 'fail');
  const running = gates.find((gate) => gate.status === 'running');
  const pending = gates.find((gate) => gate.status === 'pending');
  const focus = blocking || running || pending;

  let currentStep = 'Đang hoàn thiện';
  if (blocking) currentStep = `Đang sửa lỗi: ${blocking.label}`;
  else if (running) currentStep = `Đang chạy: ${running.label}`;
  else if (pending?.name === 'Merge + Production') currentStep = 'Các gate kỹ thuật đã PASS · chuẩn bị merge/Production';
  else if (pending) currentStep = `Chuẩn bị: ${pending.label}`;

  return {
    active: true,
    progressPct,
    gates,
    currentStep,
    nextStep: focus?.name === 'Merge + Production' ? 'Merge → kiểm tra Production → tự lấy việc tiếp theo' : `Hoàn thành ${focus?.label || 'gate hiện tại'}`,
  };
}

function cleanTitle(value = '') {
  return String(value).replace(/^\[[^\]]+\]\s*/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function firstLine(value = '') {
  return String(value).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

export function parseCentralPriorities(body = '') {
  const rows = [];
  const seen = new Set();
  const regex = /###\s+\d+\.\s+(P[0-2])\s+#(\d+)\s+—\s+([^\n]+)/g;
  for (const match of String(body).matchAll(regex)) {
    const number = Number(match[2]);
    if (!number || seen.has(number)) continue;
    seen.add(number);
    rows.push({ priority: match[1], number, label: cleanTitle(match[3]) });
  }
  return rows;
}

export function parseEmployees(body = '') {
  const rows = [];
  const regex = /\|\s*`(\d+)`\s*\|\s*`(NV\d+)`\s*\|[^|]*\|[^|]*\|[^|]*\|\s*`([^`]+)`\s*\|\s*([^|]+)\|/g;
  for (const match of String(body).matchAll(regex)) {
    const enabledRaw = match[4].replace(/\*/g, '').trim().toLowerCase();
    rows.push({
      command: Number(match[1]),
      employeeId: match[2],
      label: match[3].trim(),
      active: enabledRaw.startsWith('true'),
      state: enabledRaw.startsWith('true') ? 'Sẵn sàng theo danh mục' : 'Tạm ngưng',
    });
  }
  return rows;
}

export function inferOwnerAction(text = '') {
  const normalized = String(text).toUpperCase();
  const required = /(^|\n)\s*(?:[-*]\s*)?(?:STATE\s*[:=]\s*)?(?:CHỜ ANH SƠN|OWNER[_ ]ACTION[_ ]REQUIRED)\b/m.test(normalized);
  return {
    required,
    summary: required ? 'Có hạng mục đang chờ anh Sơn theo Nguồn Sự Thật.' : 'Không có việc bắt buộc anh Sơn thao tác ở ưu tiên hiện tại.',
  };
}

function issueStatus(issue) {
  return issue?.state === 'closed' ? 'HOÀN TẤT' : 'ĐANG XỬ LÝ';
}

async function issue(number, owner, repo, fetchImpl) {
  return gh(`/repos/${owner}/${repo}/issues/${number}`, fetchImpl);
}

async function comments(number, owner, repo, fetchImpl) {
  try {
    const rows = await gh(`/repos/${owner}/${repo}/issues/${number}/comments?per_page=8`, fetchImpl);
    return (Array.isArray(rows) ? rows : []).slice(-6).reverse().map((row) => ({
      name: firstLine(row.body).replace(/^#+\s*/, '').slice(0, 160) || `Cập nhật #${number}`,
      status: 'ĐÃ GHI NHẬN',
      at: row.created_at || row.updated_at || null,
      url: row.html_url || null,
    }));
  } catch {
    return [];
  }
}

export async function buildCompanyProgress(fetchImpl = fetch) {
  const { owner, repo } = repoParts();
  const [central, registry] = await Promise.all([
    issue(CENTRAL_ISSUE, owner, repo, fetchImpl),
    issue(REGISTRY_ISSUE, owner, repo, fetchImpl),
  ]);

  const declared = parseCentralPriorities(central.body);
  const priorityIssues = [];
  for (const row of declared.slice(0, 6)) {
    try {
      const live = await issue(row.number, owner, repo, fetchImpl);
      priorityIssues.push({
        ...row,
        title: cleanTitle(live.title || row.label),
        status: issueStatus(live),
        open: live.state === 'open',
        updatedAt: live.updated_at || null,
        url: live.html_url || null,
      });
    } catch {
      priorityIssues.push({ ...row, title: row.label, status: 'CHƯA XÁC MINH', open: null, updatedAt: null, url: null });
    }
  }

  const active = priorityIssues.find((row) => row.open === true) || null;
  let activeIssue = null;
  if (active) {
    try { activeIssue = await issue(active.number, owner, repo, fetchImpl); } catch { activeIssue = null; }
  }
  const activity = active ? await comments(active.number, owner, repo, fetchImpl) : [];
  const employees = parseEmployees(registry.body);
  const ownerAction = inferOwnerAction(`${central.body}\n${activeIssue?.body || ''}`);
  const openCount = priorityIssues.filter((row) => row.open === true).length;
  const closedCount = priorityIssues.filter((row) => row.open === false).length;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    mode: 'authoritative-central-registry',
    source: { centralIssue: CENTRAL_ISSUE, registryIssue: REGISTRY_ISSUE, centralUpdatedAt: central.updated_at || null, registryUpdatedAt: registry.updated_at || null },
    activeWork: active ? {
      active: true,
      number: active.number,
      title: active.title,
      priority: active.priority,
      status: active.status,
      progressPct: null,
      progressText: 'Đang xử lý · chỉ chốt khi đủ bằng chứng',
      currentStep: cleanTitle(activeIssue?.body?.match(/## Trạng thái[^\n]*\n([^\n]+)/i)?.[1] || active.label || active.title),
      nextStep: 'Tiếp tục theo điều kiện ĐẠT của issue hiện hành',
      updatedAt: active.updatedAt,
      url: active.url,
    } : {
      active: false,
      number: null,
      title: 'Không có P0/P1/P2 mở trong danh sách ưu tiên CENTRAL đã đọc',
      status: 'CHỜ VIỆC TIẾP THEO',
      progressPct: null,
      progressText: 'Không suy đoán',
      currentStep: 'Đọc CENTRAL để chọn việc tiếp theo',
      nextStep: 'Tự rà việc an toàn theo chính sách hiện hành',
    },
    priorityIssues,
    summary: { total: priorityIssues.length, open: openCount, completed: closedCount },
    employees,
    employeeSummary: { total: employees.length, active: employees.filter((x) => x.active).length, paused: employees.filter((x) => !x.active).length },
    activity,
    ownerAction,
    systems: [
      { name: 'Vercel View', state: 'TRỰC TUYẾN', detail: 'API công khai đang phản hồi' },
      { name: 'GitHub', state: 'TRỰC TUYẾN', detail: `Đã đọc CENTRAL #${CENTRAL_ISSUE} + danh mục #${REGISTRY_ISSUE}` },
      { name: 'PC01', state: 'CHƯA CÓ DỮ LIỆU', detail: 'View công khai không suy đoán trạng thái máy nội bộ' },
    ],
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
      priorityIssues: [],
      employees: [],
      activity: [],
      ownerAction: { required: false, summary: 'Chưa lấy được Nguồn Sự Thật; hệ thống không suy đoán trạng thái.' },
      reason: String(error instanceof Error ? error.message : error).slice(0, 96),
    });
  }
}
