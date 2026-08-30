const REPO = process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab';
const FETCH_TIMEOUT_MS = 5000;
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
  const pulls = await gh(`/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=20`, fetchImpl);
  const activePull = (Array.isArray(pulls) ? pulls : []).find((pull) => /^WO-\d+/i.test(String(pull.title || ''))) || null;
  let runs = [];
  if (activePull?.head?.sha) {
    const response = await gh(`/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(activePull.head.sha)}&per_page=50`, fetchImpl);
    runs = Array.isArray(response?.workflow_runs) ? response.workflow_runs : [];
  }
  const progress = projectProgress({ pull: activePull, runs });
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    mode: 'evidence-based',
    activeWork: activePull ? {
      number: activePull.number,
      title: String(activePull.title || '').slice(0, 160),
      branch: activePull.head?.ref || null,
      headSha: activePull.head?.sha || null,
      updatedAt: activePull.updated_at || null,
      url: activePull.html_url || null,
      ...progress,
    } : progress,
    activity: recentActivity(runs),
    ownerAction: {
      required: false,
      summary: 'Không có việc cần Sếp thao tác ở gate kỹ thuật hiện tại',
    },
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
      activity: [],
      ownerAction: { required: false, summary: 'Chưa lấy được tiến độ GitHub; không suy đoán trạng thái.' },
      reason: String(error instanceof Error ? error.message : error).slice(0, 96),
    });
  }
}
