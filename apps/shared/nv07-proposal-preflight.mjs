import { isAppChromeLocalOnlyPath, isProtectedControlPlanePath } from './control-plane-lock.mjs';

// Static, fail-closed scope check only. Core must independently verify identity, lease and capability.
// On PC01, NV07 may propose changes; source mutation/build/test/PR remain GitHub/CI duties.
const REPO = 'newsdayads/tigeriq-ai-lab';
const ACTIONS = new Set(['READ_METADATA', 'PROPOSE_CHANGE']);
const HOST = 'PC01';
const REPO_SHA = /^[a-f0-9]{40}$/i;
const BAD_FILE_PARTS = /(^|\/)(\.git|\.env(?:\.[^/]*)?|\.ssh|\.aws|\.npmrc|node_modules|secrets?|credentials?|private[_-]?keys?|tokens?)(\/|$)/i;
const BAD_EXTENSIONS = /\.(?:pem|p12|pfx|key|kdbx)$/i;
const BLOCKED_FLAGS = /(?:^|\s)["']?--(?:dangerously-skip-permissions|yolo|allow-all)(?=[\s="' ]|$)|(?:^|\s)["']?--approval-mode(?:\s*=\s*|\s+)["']?yolo(?=[\s"'=]|$)/i;

function reject(code) { return Object.freeze({ allowed: false, code, mode: 'DENY' }); }

export function nv07CanonicalRepoPath(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()) return null;
  const path = value.replace(/\\/g, '/');
  if (/[\x00-\x1f\x7f]/.test(path) || path.startsWith('/') || path.startsWith('//') || /^[a-z]:/i.test(path)) return null;
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return null;
  return path;
}

export function nv07ProposalPreflight(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return reject('NV07_TASK_INVALID');
  if (task.employeeId !== 'NV07') return reject('NV07_EMPLOYEE_MISMATCH');
  if (task.executionHost !== HOST || task.repository !== REPO) return reject('NV07_RUNTIME_SCOPE_DENIED');
  if (!/^P[1-5]$/.test(String(task.priority || ''))) return reject('NV07_P0_OR_PRIORITY_DENIED');
  if (!ACTIONS.has(task.action)) return reject('NV07_PC01_WRITE_OR_UNKNOWN_ACTION_DENIED');
  if (typeof task.jobId !== 'string' || !/^[a-z0-9:_-]{6,128}$/i.test(task.jobId)) return reject('NV07_JOB_ID_REQUIRED');
  if (!REPO_SHA.test(String(task.sourceSha || ''))) return reject('NV07_PINNED_SOURCE_REQUIRED');
  if (task.paid === true || task.credentialChange === true || task.securityBoundaryChange === true || task.productionRelease === true || task.destructive === true || task.osAdmin === true) return reject('NV07_HARD_GATE_DENIED');
  if (typeof task.cliFlags !== 'undefined' && (typeof task.cliFlags !== 'string' || BLOCKED_FLAGS.test(task.cliFlags))) return reject('NV07_CLI_PERMISSION_BYPASS_DENIED');
  if (!Array.isArray(task.paths) || !task.paths.length || task.paths.length > 30) return reject('NV07_PATH_SCOPE_REQUIRED');
  const paths = [];
  for (const input of task.paths) {
    const path = nv07CanonicalRepoPath(input);
    if (!path) return reject('NV07_PATH_TRAVERSAL_DENIED');
    if (isAppChromeLocalOnlyPath(path)) return reject('NV07_APP_CHROME_DENIED');
    if (isProtectedControlPlanePath(path)) return reject('NV07_PROTECTED_CONTROL_DENIED');
    if (BAD_FILE_PARTS.test(path) || BAD_EXTENSIONS.test(path)) return reject('NV07_SECRET_PATH_DENIED');
    paths.push(path);
  }
  return Object.freeze({
    allowed: true, code: 'NV07_PROPOSAL_SCOPE_ACCEPTED', mode: 'PROPOSAL_ONLY',
    repository: REPO, sourceSha: task.sourceSha, paths: Object.freeze([...new Set(paths)]),
    note: 'Preflight only: must separately verify live lease, user session, CLI auth, receipt and GitHub executor gate.',
  });
}
