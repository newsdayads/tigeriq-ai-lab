const REPO = process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab';
const FETCH_TIMEOUT_MS = 5000;
const CENTRAL_ISSUE = 280;
const REGISTRY_ISSUE = 335;

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
  // Chỉ nhận marker trạng thái rõ ràng; không coi câu mô tả UI kiểu
  // "có cần anh Sơn làm gì không" là một yêu cầu thao tác thật.
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

// Giữ export cũ để không phá các kiểm thử/unit đã dùng helper này.
export function projectProgress({ pull }) {
  if (!pull) return { active: false, progressPct: null, gates: [], currentStep: 'Không có PR kỹ thuật đang mở', nextStep: 'Đọc CENTRAL để chọn việc tiếp theo' };
  return { active: true, progressPct: null, gates: [], currentStep: 'Đang xử lý theo Nguồn Sự Thật', nextStep: 'Tiếp tục tới điều kiện chốt có bằng chứng' };
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
