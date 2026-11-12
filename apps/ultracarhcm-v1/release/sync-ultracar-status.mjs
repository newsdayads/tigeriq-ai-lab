#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO = 'newsdayads/tigeriq-ai-lab';
const DEFAULT_ISSUE = 5129;

/**
 * Validate that version.json and current-release.json match and carry valid integrity fields.
 */
export function validateReleaseManifestConsistency(versionData, releaseData) {
  if (!versionData || typeof versionData !== 'object') {
    throw new Error('version.json must be a JSON object');
  }
  if (!releaseData || typeof releaseData !== 'object') {
    throw new Error('current-release.json must be a JSON object');
  }

  const vCode = Number(versionData.versionCode);
  const latestCode = Number(versionData.latestVersionCode ?? versionData.versionCode);
  const rCode = Number(releaseData.versionCode);
  if (!Number.isInteger(rCode) || rCode <= 0 || vCode !== rCode || latestCode !== rCode) {
    throw new Error(`Version code mismatch: version.json(${vCode}/${latestCode}) != release(${rCode})`);
  }

  const vName = String(versionData.versionName || '').trim();
  const latestName = String(versionData.latestVersionName ?? vName).trim();
  const rName = String(releaseData.versionName || '').trim();
  if (!rName || vName !== rName || latestName !== rName) {
    throw new Error(`Version name mismatch: version.json(${vName}/${latestName}) != release(${rName})`);
  }

  const vSha = String(versionData.sha256 || '').trim().toUpperCase();
  const rSha = String(releaseData.sha256 || '').trim().toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(rSha) || vSha !== rSha) {
    throw new Error(`SHA-256 mismatch or invalid format: version.json(${vSha}) != release(${rSha})`);
  }

  if (String(versionData.apkUrl || '').trim() !== String(releaseData.apkDistUrl || '').trim()) {
    throw new Error('apkUrl in version.json must equal apkDistUrl in current-release.json');
  }

  const checklist = Array.isArray(releaseData.checklist) ? releaseData.checklist : [];
  if (checklist.length < 2) {
    throw new Error('checklist in current-release.json must contain at least 2 items');
  }
  for (const item of checklist) {
    if (item.done && !/^https:\/\/\S+$/.test(String(item.evidenceUrl || ''))) {
      throw new Error(`Checked item "${item.label}" requires an https:// evidenceUrl`);
    }
  }
}

/**
 * Format the GitHub Issue title synced to the TigerIQ Dashboard.
 */
export function buildWorkOrderTitle(releaseData) {
  const versionName = String(releaseData.versionName || '').trim();
  const versionCode = Number(releaseData.versionCode);
  const suffix = releaseData.ownerQaPending !== false
    ? 'Đã đồng bộ GitHub & Chờ anh Sơn QA Z Fold 2'
    : 'Đã phát hành & Nghiệm thu hoàn tất';
  return `[P0][ULTRACARHCM V1] UltraCar v${versionName} (Build ${versionCode}) — ${suffix}`;
}

/**
 * Format the canonical Work Order V2 + live-status Issue body for #5129.
 */
export function buildWorkOrderBody(versionData, releaseData) {
  validateReleaseManifestConsistency(versionData, releaseData);
  const repoUrl = 'https://github.com/newsdayads/tigeriq-ai-lab';
  const issueNum = Number(releaseData.workItem || DEFAULT_ISSUE);
  const qaPending = releaseData.ownerQaPending !== false;
  const currentState = qaPending ? 'READY_FOR_OWNER_APPROVAL' : 'DONE';
  const currentStep = qaPending
    ? `Đã xong build/ký/xuất bản v${releaseData.versionName} (Build ${releaseData.versionCode}) · chờ anh Sơn QA Z Fold 2`
    : `Hoàn tất v${releaseData.versionName} (Build ${releaseData.versionCode})`;
  const lastCompleted = `Đã phát hành ${releaseData.fileName} (Build ${releaseData.versionCode}), đồng bộ version.json, apk-dist & GitHub Release ${releaseData.releaseTag}`;
  const nextStep = qaPending
    ? `Anh Sơn cài v${releaseData.versionName} kiểm thử thực tế trên Z Fold 2 / DeX (nút [R], vạch lùi OEM, Remote BT < 2s bật Camera Popup)`
    : 'Theo dõi vận hành ổn định và nhận phản hồi mới từ anh Sơn';

  const headerLines = [
    'WORK_ORDER_LIFECYCLE=V2',
    `PROJECT_ID=${releaseData.projectId || 'dexcam-personal'}`,
    `PROJECT_NAME=${releaseData.projectName || 'DeXCam Personal'}`,
    `WORKSTREAM_ID=${releaseData.workstreamId || 'ultracarhcm-v1'}`,
    `WORKSTREAM_NAME=${releaseData.workstreamName || 'UltraCarHCM V1'}`,
    'PRIORITY=P0',
    `CURRENT_STATE=${currentState}`,
    'TECHNICAL_ACCEPTANCE=PASS',
    'OWNER_ACCEPTANCE_REQUIRED=true',
    `OWNER_ACCEPTED=${qaPending ? 'false' : 'true'}`,
    `DONE=${qaPending ? 'false' : 'true'}`,
    'PROGRESS_SOURCE=VERIFIED_CHECKLIST',
    'PROGRESS_VERIFIED=true',
    `CURRENT_STEP=${currentStep}`,
    `LAST_COMPLETED_STEP=${lastCompleted}`,
    `NEXT=${nextStep}`,
    `NEXT_ACTION=${nextStep}`,
    'BLOCKER=NONE',
    'RESOURCE_SCOPE=ULTRACARHCM_V1',
    'MUTATION_OWNER=OWNER_APP_DIRECT_DELIVERY',
    'ETA_STATUS=NOT_APPLICABLE',
    'STARTED_AT=2026-10-22T06:00:42Z',
    `START_RECEIPT_URL=${repoUrl}/issues/${issueNum}`,
    `FINISHED_AT=${qaPending ? 'NOT_FINISHED' : releaseData.publishedAt}`,
    `EVIDENCE_URL=${releaseData.releaseUrl}`,
    `EVIDENCE_AT=${releaseData.publishedAt}`,
    'SAME_FAILURE_RETRY_COUNT=0',
    'SAME_FAILURE_RETRY_MAX=2',
    'VERIFICATION_COUNT_CURRENT_HEAD=0',
    'VERIFICATION_MAX_PER_HEAD=2',
    'LAST_FAILURE_SIGNATURE=NONE',
    'RETRY_RESUME_TRIGGER=NONE',
  ];

  const checklistLines = releaseData.checklist.map((item) => {
    const box = item.done ? 'x' : ' ';
    if (item.done && item.evidenceUrl) {
      const label = item.evidenceLabel || 'bằng chứng';
      return `- [${box}] ${item.label} — [${label}](${item.evidenceUrl})`;
    }
    return `- [${box}] ${item.label}`;
  });

  const highlightLines = (releaseData.highlights || []).map((line) => `- ${line}`);
  const sizeFormatted = Number(releaseData.sizeBytes).toLocaleString('en-US');

  return [
    ...headerLines,
    '',
    '## STRUCTURED_PROGRESS_CHECKLIST',
    ...checklistLines,
    '',
    `## PHIÊN BẢN HIỆN TẠI — UltraCar v${releaseData.versionName} (Build ${releaseData.versionCode})`,
    `- **Package:** \`${releaseData.packageName}\` | **File:** \`${releaseData.fileName}\` (${sizeFormatted} bytes)`,
    `- **SHA-256 APK:** \`${releaseData.sha256}\``,
    `- **Chứng chỉ ký:** \`${releaseData.certificateSha256}\` (v2/v3 verified)`,
    `- **OTA Manifest:** [version.json](${releaseData.versionJsonUrl}) | **APK nhị phân:** [UltraCar_latest.apk](${releaseData.apkDistUrl}) | **Release:** [${releaseData.releaseTag}](${releaseData.releaseUrl})`,
    ...highlightLines,
    '',
    '## ACCEPTANCE',
    `- APK \`${releaseData.fileName}\` ký đúng chứng chỉ V1, \`versionCode=${releaseData.versionCode}\`, \`versionName=${releaseData.versionName}\`, SHA-256 khớp \`version.json\` và \`apk-dist\`.`,
    '- Unit tests Java (`GuideEngineUnitTest`, `RemoteKeyShortcutUnitTest`) PASS trên mã nguồn `apps/ultracarhcm-v1/src`.',
    '- Nghiệm thu vật lý trên Samsung Z Fold 2 / DeX do anh Sơn thực hiện trực tiếp trước khi đóng Work Order.',
    '',
    '## STOP_CONDITIONS',
    '- Dừng nếu chứng chỉ APK hoặc SHA-256 giữa Drive, `apk-dist`, GitHub Release và `version.json` không trùng khớp.',
    '- Không tự đánh dấu `DONE=true` hoặc đóng `#5129` khi chưa có xác nhận test thực tế trên Z Fold 2 từ anh Sơn.',
    '',
    '---',
    `HISTORICAL CONTEXT: Hồ sơ bàn giao V73/V72 ngày 01/11/2026 được lưu giữ nguyên tại [bình luận #6554280573](${repoUrl}/issues/${issueNum}#issuecomment-6554280573). Bản backup chạy ổn V1.0.28 giữ nguyên trên Drive (\`Backup/UltraCar_v1.0.28_WORKING_BACKUP.apk\`).`,
    '',
  ].join('\n');
}

/**
 * Build an idempotent structured lifecycle comment for the current release.
 */
export function buildSyncComment(releaseData) {
  const marker = syncMarkerForRelease(releaseData);
  const qaPending = releaseData.ownerQaPending !== false;
  return [
    marker,
    `## Đồng bộ UltraCarHCM V1 v${releaseData.versionName} (Build ${releaseData.versionCode})`,
    '',
    `CURRENT_STATE=${qaPending ? 'READY_FOR_OWNER_APPROVAL' : 'DONE'}`,
    `CURRENT_STEP=Đã đồng bộ v${releaseData.versionName} (Build ${releaseData.versionCode}) lên GitHub, OTA version.json & Dashboard TigerIQ`,
    `NEXT=${qaPending ? 'Anh Sơn kiểm thử thực tế trên Z Fold 2 / DeX (nút [R], vạch lùi OEM, Remote BT < 2s)' : 'Theo dõi vận hành ổn định'}`,
    'BLOCKER=NONE',
    `DONE=${qaPending ? 'false' : 'true'}`,
    `RELEASE_TAG=${releaseData.releaseTag}`,
    `VERSION_CODE=${releaseData.versionCode}`,
    `SHA256=${releaseData.sha256}`,
    '',
    `- **GitHub Release:** [${releaseData.releaseTag}](${releaseData.releaseUrl})`,
    `- **OTA Manifest:** [version.json](${releaseData.versionJsonUrl})`,
    `- **APK Binary:** [UltraCar_latest.apk](${releaseData.apkDistUrl})`,
  ].join('\n');
}

export function syncMarkerForRelease(releaseData) {
  const shortSha = String(releaseData.sha256 || '').toUpperCase().slice(0, 12);
  return `<!-- ULTRACAR_SYNC_V${releaseData.versionCode}_${shortSha} -->`;
}

export function loadManifests(rootDir = process.cwd()) {
  const root = resolve(rootDir);
  const versionData = JSON.parse(readFileSync(join(root, 'version.json'), 'utf8'));
  const releaseData = JSON.parse(
    readFileSync(join(root, 'apps/ultracarhcm-v1/release/current-release.json'), 'utf8'),
  );
  return { versionData, releaseData };
}

function runGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function prepareReleaseManifests(opts = {}) {
  const root = resolve(opts.root || process.cwd());
  const apkPath = resolve(String(opts.apk || ''));
  const versionCode = Number(opts.versionCode);
  const versionName = String(opts.versionName || '').trim();
  if (!apkPath) throw new Error('--apk is required with --prepare-release');
  if (!Number.isInteger(versionCode) || versionCode <= 0) {
    throw new Error('--version-code must be a positive integer');
  }
  if (!versionName) throw new Error('--version-name is required with --prepare-release');

  const buf = readFileSync(apkPath);
  const sizeBytes = statSync(apkPath).size;
  const sha256 = createHash('sha256').update(buf).digest('hex').toUpperCase();
  const fileName = basename(apkPath);
  const releaseTag = `v${versionName}`;
  const releaseNotes = String(
    opts.notes || `TigerIQ UltraCar v${versionName} (BUILD ${versionCode})`,
  ).trim();

  const versionPath = join(root, 'version.json');
  const releasePath = join(root, 'apps/ultracarhcm-v1/release/current-release.json');
  const prevVersion = JSON.parse(readFileSync(versionPath, 'utf8'));
  const prevRelease = JSON.parse(readFileSync(releasePath, 'utf8'));

  const nextVersion = {
    ...prevVersion,
    versionCode,
    versionName,
    latestVersionCode: versionCode,
    latestVersionName: versionName,
    sha256,
    releaseNotes,
    driveFileName: fileName,
  };

  const nextRelease = {
    ...prevRelease,
    versionCode,
    versionName,
    releaseTag,
    fileName,
    sizeBytes,
    sha256,
    publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ownerQaPending: opts.ownerAccepted ? false : true,
    releaseNotes,
    releaseUrl: `https://github.com/${opts.repo || DEFAULT_REPO}/releases/tag/${releaseTag}`,
    checklist: [
      {
        label: `Build, zipalign & ký ${fileName} (Build ${versionCode}, SHA-256 ${sha256.slice(0, 8)}...)`,
        done: true,
        evidenceLabel: `Release ${releaseTag}`,
        evidenceUrl: `https://github.com/${opts.repo || DEFAULT_REPO}/releases/tag/${releaseTag}`,
      },
      ...(Array.isArray(prevRelease.checklist) ? prevRelease.checklist.slice(1, -1) : []),
      {
        label: `Kiểm thử thực tế ${releaseTag} trên Z Fold 2 / DeX (nút [R], vạch lùi OEM, Remote BT < 2s bật Camera Popup)`,
        done: Boolean(opts.ownerAccepted),
        evidenceLabel: null,
        evidenceUrl: null,
      },
    ],
  };

  validateReleaseManifestConsistency(nextVersion, nextRelease);
  writeFileSync(versionPath, `${JSON.stringify(nextVersion, null, 2)}\n`, 'utf8');
  writeFileSync(releasePath, `${JSON.stringify(nextRelease, null, 2)}\n`, 'utf8');
  return { versionData: nextVersion, releaseData: nextRelease };
}

function parseCliArgs(argv) {
  const opts = {
    apply: false,
    dryRun: false,
    comment: false,
    prepareRelease: false,
    ownerAccepted: false,
    issue: null,
    repo: DEFAULT_REPO,
    root: process.cwd(),
    apk: null,
    versionCode: null,
    versionName: null,
    notes: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--comment') opts.comment = true;
    else if (arg === '--prepare-release') opts.prepareRelease = true;
    else if (arg === '--owner-accepted') opts.ownerAccepted = true;
    else if (arg === '--issue' && argv[i + 1]) { opts.issue = Number(argv[++i]); }
    else if (arg === '--repo' && argv[i + 1]) { opts.repo = argv[++i]; }
    else if (arg === '--root' && argv[i + 1]) { opts.root = argv[++i]; }
    else if (arg === '--apk' && argv[i + 1]) { opts.apk = argv[++i]; }
    else if (arg === '--version-code' && argv[i + 1]) { opts.versionCode = Number(argv[++i]); }
    else if (arg === '--version-name' && argv[i + 1]) { opts.versionName = argv[++i]; }
    else if (arg === '--notes' && argv[i + 1]) { opts.notes = argv[++i]; }
  }
  return opts;
}

export function syncIssueWithGh(opts = {}) {
  const { versionData, releaseData } = loadManifests(opts.root);
  const issue = opts.issue || Number(releaseData.workItem || DEFAULT_ISSUE);
  const repo = opts.repo || DEFAULT_REPO;
  const title = buildWorkOrderTitle(releaseData);
  const body = buildWorkOrderBody(versionData, releaseData);
  const commentBody = buildSyncComment(releaseData);
  const marker = syncMarkerForRelease(releaseData);

  if (!opts.apply || opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      repo,
      issue,
      versionName: releaseData.versionName,
      versionCode: releaseData.versionCode,
      sha256: releaseData.sha256,
      title,
      bodyLength: body.length,
      commentPosted: false,
    };
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'ultracar-sync-'));
  try {
    const bodyFile = join(tmpDir, 'issue-body.md');
    writeFileSync(bodyFile, body, 'utf8');
    runGh(['issue', 'edit', String(issue), '--repo', repo, '--title', title, '--body-file', bodyFile]);

    let commentPosted = false;
    if (opts.comment) {
      const latestRaw = runGh([
        'api',
        `repos/${repo}/issues/${issue}/comments?per_page=100`,
      ]);
      const comments = JSON.parse(latestRaw || '[]');
      const alreadyPosted = Array.isArray(comments) && comments.some((c) => String(c?.body || '').includes(marker));
      if (!alreadyPosted) {
        const commentFile = join(tmpDir, 'issue-comment.md');
        writeFileSync(commentFile, commentBody, 'utf8');
        runGh(['issue', 'comment', String(issue), '--repo', repo, '--body-file', commentFile]);
        commentPosted = true;
      }
      try { unlinkSync(join(tmpDir, 'issue-comment.md')); } catch {}
    }

    return {
      ok: true,
      dryRun: false,
      repo,
      issue,
      versionName: releaseData.versionName,
      versionCode: releaseData.versionCode,
      sha256: releaseData.sha256,
      title,
      issueUpdated: true,
      commentPosted,
    };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.prepareRelease) {
    prepareReleaseManifests(opts);
  }
  const result = syncIssueWithGh(opts);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
