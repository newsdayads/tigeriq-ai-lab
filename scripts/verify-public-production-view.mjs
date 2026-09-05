import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE = 'https://tigeriq-ai-lab.vercel.app';
const REQUIRED_ROOT = ['TigerIQ · Bảng điều hành', 'View quản trị chỉ xem', 'Cần anh Sơn', 'CHỈ XEM'];
const FORBIDDEN_ROOT = ['Giao việc cho Vy', 'id="instruction"', 'id="dispatch"', '/api/owner-auth', "operation:'work-order'", 'operation:"work-order"'];

export function verifyRoot(html = '') {
  const text = String(html);
  const errors = [];
  for (const marker of REQUIRED_ROOT) if (!text.includes(marker)) errors.push(`missing_root_marker:${marker}`);
  for (const marker of FORBIDDEN_ROOT) if (text.includes(marker)) errors.push(`forbidden_root_marker:${marker}`);
  return errors;
}

export function verifyProgress(data, { expectedIssue = null } = {}) {
  const errors = [];
  if (!data || data.ok !== true) errors.push('progress_not_ok');
  if (data?.mode !== 'authoritative-central-registry') errors.push('progress_mode_not_authoritative');
  if (data?.source?.centralIssue !== 280) errors.push('central_source_mismatch');
  if (data?.source?.registryIssue !== 335) errors.push('registry_source_mismatch');
  const nv02 = Array.isArray(data?.employees) ? data.employees.find((x) => x?.command === 2 && x?.employeeId === 'NV02') : null;
  if (!nv02 || nv02.active !== true) errors.push('nv02_projection_missing_or_inactive');
  if (expectedIssue !== null) {
    const n = Number(expectedIssue);
    const found = data?.activeWork?.number === n || (Array.isArray(data?.priorityIssues) && data.priorityIssues.some((x) => x?.number === n));
    if (!found) errors.push(`expected_issue_missing:${n}`);
  }
  return errors;
}

async function fetchChecked(url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(url, { cache: 'no-store', signal: controller.signal });
    if (response.status !== 200) throw new Error(`http_${response.status}:${url}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyProduction({ base = DEFAULT_BASE, expectedIssue = null, fetchImpl = fetch } = {}) {
  const rootUrl = new URL('/', base).toString();
  const progressUrl = new URL('/api/company-progress', base).toString();
  const [rootResponse, progressResponse] = await Promise.all([
    fetchChecked(rootUrl, fetchImpl),
    fetchChecked(progressUrl, fetchImpl),
  ]);
  const root = await rootResponse.text();
  const progress = await progressResponse.json();
  const errors = [...verifyRoot(root), ...verifyProgress(progress, { expectedIssue })];
  return { ok: errors.length === 0, base, expectedIssue, errors, mode: progress?.mode || null };
}

function args(argv) {
  let base = DEFAULT_BASE;
  let expectedIssue = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') base = argv[++i];
    else if (argv[i] === '--expected-issue') expectedIssue = Number(argv[++i]);
    else throw new Error(`unknown_arg:${argv[i]}`);
  }
  if (!/^https:\/\//i.test(base)) throw new Error('base_must_be_https');
  if (expectedIssue !== null && (!Number.isInteger(expectedIssue) || expectedIssue <= 0)) throw new Error('invalid_expected_issue');
  return { base, expectedIssue };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = await verifyProduction(args(process.argv.slice(2)));
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
    else console.log('PUBLIC_PRODUCTION_READONLY_ACCEPTANCE_PASS');
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  }
}
