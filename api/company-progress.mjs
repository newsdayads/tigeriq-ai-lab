const REPO = process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab';
const FETCH_TIMEOUT_MS = 5000;
const CENTRAL_ISSUE = 280;
const REGISTRY_ISSUE = 335;
const INITIATIVE_ISSUES = [368, 423, 401, 306];
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
  if (name === 'Merge + Production') return 'Hợp nhất + xuất bản';
  return name;
}

export function projectProgress({ pull, runs = [] }) {
  if (!pull) {
    return {
      active: false,
      progressPct: 100,
      gates: [],
      currentStep: 'Không có PR kỹ thuật đang mở',
      nextStep: 'Tự chọn việc ưu tiên tiếp theo',
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
  else if (pending?.name === 'Merge + Production') currentStep = 'Các điều kiện kỹ thuật đã ĐẠT · chuẩn bị hợp nhất/xuất bản';
  else if (pending) currentStep = `Chuẩn bị: ${pending.label}`;

  return {
    active: true,
    progressPct,
    gates,
    currentStep,
    nextStep: focus?.name === 'Merge + Production' ? 'Hợp nhất → kiểm tra bản xuất bản → tự lấy việc tiếp theo' : `Hoàn thành ${focus?.label || 'điều kiện hiện tại'}`,
  };
}

function stripPrefix(title) {
  return String(title || '')
    .replace(/^\[[^\]]+\](?:\[[^\]]+\])*(?:\s*)/g, '')
    .replace(/^P\d\s*/i, '')
    .trim();
}

function stateToken(body) {
  const text = String(body || '');
  const matches = [...text.matchAll(/(?:State|STATE|Trạng thái|Trạng thái mới|State rule)\s*[:=]\s*`([^`]+)`/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

function registryEmployees(registryBody, centralBody) {
  const fallback = [
    ['NV01', 'Minh', 'Thực thi trực tiếp'],
    ['NV02', 'Khoa', 'Vận hành tự động'],
    ['NV03', 'Huy', 'AI PC01 / Kỹ sư Hệ thống Local'],
    ['NV04', 'Khải', 'Kỹ sư Tích hợp AI/API'],
  ];
  const body = String(registryBody || '');
  const central = String(centralBody || '');
  const employees = fallback.map(([id, defaultName, defaultRole]) => {
    const pattern = new RegExp(`- \\`${id}\\`:\\s*\\*\\*([^*]+)\\*\\*\\s*[—-]\\s*\\`?([^;\\n]+)`, 'i');
    const match = body.match(pattern);
    const name = match?.[1]?.trim() || defaultName;
    const role = match?.[2]?.replace(/`/g, '').trim() || defaultRole;
    let status = 'Chờ';
    if (id === 'NV02' && /chỉ\s+\*\*Khoa|tự chạy duy nhất|only.*NV02/i.test(central)) status = 'Đang vận hành';
    else if (id === 'NV03' && /NV03[^\n]*(?:TẠM NGƯNG|paused)/i.test(central)) status = 'Tạm ngưng';
    else if ((id === 'NV01' || id === 'NV04') && /no foreground|không có phiên foreground/i.test(central)) status = 'Không có phiên trực tiếp';
    return { id, name, role, label: `${name} (${id} — ${role})`, status };
  });
  return [{ id: 'VY', name: 'Vy', role: 'Trợ lý', label: 'Vy (Trợ lý)', status: 'Điều phối' }, ...employees];
}

function initiative(issue) {
  return {
    number: issue.number,
    title: stripPrefix(issue.title),
    state: issue.state === 'closed' ? 'Hoàn tất' : 'Đang mở',
    updatedAt: issue.updated_at || null,
    url: issue.html_url || null,
    stateToken: stateToken(issue.body),
  };
}

function centralManagement(central, initiatives) {
  const body = String(central.body || '');
  const state = stateToken(body);
  const openCount = initiatives.filter((item) => item.state === 'Đang mở').length;
  const ownerActionRequired = /WAITING_OWNER|OWNER_ACTION_REQUIRED|CHỜ_ANH_SƠN/i.test(String(state || ''));
  return {
    doing: 'Khoa/NV02 đang chạy hàng đợi P0 không giám sát (#368 → #423)',
    owner: 'Khoa (NV02 — Vận hành tự động)',
    progress: `${openCount} hạng mục điều hành đang mở · nguồn CENTRAL #280`,
    blocker: ownerActionRequired ? 'Có điều kiện cần anh Sơn theo CENTRAL' : 'Chưa có điều kiện Mức C bắt buộc anh Sơn thao tác',
    ownerAction: {
      required: ownerActionRequired,
      summary: ownerActionRequired ? 'Có việc cần anh Sơn xử lý theo CENTRAL #280.' : 'Chưa cần anh Sơn thao tác; hệ thống tiếp tục tự chạy trong quyền đã cấp.',
    },
    state,
    updatedAt: central.updated_at || null,
  };
}

export async function buildCompanyProgress(fetchImpl = fetch) {
  const { owner, repo } = repoParts();
  const issueNumbers = [CENTRAL_ISSUE, REGISTRY_ISSUE, ...INITIATIVE_ISSUES];
  const rows = await Promise.all(issueNumbers.map((number) => gh(`/repos/${owner}/${repo}/issues/${number}`, fetchImpl)));
  const byNumber = new Map(rows.map((row) => [row.number, row]));
  const central = byNumber.get(CENTRAL_ISSUE);
  const registry = byNumber.get(REGISTRY_ISSUE);
  if (!central || !registry) throw new Error('authoritative_source_missing');
  const initiatives = INITIATIVE_ISSUES.map((number) => byNumber.get(number)).filter(Boolean).map(initiative);
  const management = centralManagement(central, initiatives);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    mode: 'authoritative-read-only',
    source: {
      label: 'CENTRAL #280 + Registry #335',
      centralIssue: CENTRAL_ISSUE,
      registryIssue: REGISTRY_ISSUE,
      updatedAt: central.updated_at || null,
      state: management.state,
    },
    management,
    workforce: registryEmployees(registry.body, central.body),
    initiatives,
    activeWork: {
      active: true,
      number: CENTRAL_ISSUE,
      title: management.doing,
      branch: null,
      headSha: null,
      updatedAt: central.updated_at || null,
      url: central.html_url || null,
      progressPct: null,
      gates: [],
      currentStep: management.doing,
      nextStep: 'Tiếp tục theo hàng đợi CENTRAL và BLOCKED != IDLE',
    },
    activity: initiatives.map((item) => ({ name: `#${item.number} ${item.title}`, status: item.state, at: item.updatedAt, url: item.url })),
    ownerAction: management.ownerAction,
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
      source: { label: 'CENTRAL #280 + Registry #335' },
      management: null,
      workforce: [],
      initiatives: [],
      activeWork: null,
      activity: [],
      ownerAction: { required: false, summary: 'Chưa lấy được nguồn điều hành; không suy đoán trạng thái.' },
      reason: String(error instanceof Error ? error.message : error).slice(0, 96),
    });
  }
}
