export const PRODUCT_ACCEPTANCE_SCHEMA = 'TIGERIQ_PRODUCT_ACCEPTANCE_V1';

export const SUPPORTED_PRODUCT_TYPES = Object.freeze(['android', 'frontend', 'backend']);

export const PRODUCT_REQUIRED_CHECKS = Object.freeze({
  android: Object.freeze(['Android Build Verify']),
  frontend: Object.freeze(['Frontend Functional Verify']),
  backend: Object.freeze(['Backend Contract Verify'])
});

const string = x => String(x ?? '').trim();
const safePath = p => /^[A-Za-z0-9._/-]{1,220}$/.test(p) && !p.startsWith('/') && !p.includes('..') && !p.includes('\\');
const isSha = s => /^[a-f0-9]{40}$/i.test(string(s));

// Markdown / documentation-only extensions
const DOC_EXTENSIONS = /\.(md|markdown|txt|rst|adoc)$/i;

// Android required file patterns
const ANDROID_GRADLE_PATTERN = /(^|\/)(build\.gradle(\.kts)?|settings\.gradle(\.kts)?)$/i;
const ANDROID_MANIFEST_PATTERN = /(^|\/)AndroidManifest\.xml$/i;
const ANDROID_KOTLIN_PATTERN = /\.(kt|java)$/i;

// Frontend required file pattern
const FRONTEND_UI_PATTERN = /\.(tsx|jsx|vue|svelte|html|css)$/i;

// Backend required file pattern
const BACKEND_API_PATTERN = /\.(mjs|cjs|js|ts|py|go|rs|java|kt)$/i;

/**
 * Normalizes changes array: [{path: string, content?: string}]
 */
function normalizeChanges(changes = []) {
  if (!Array.isArray(changes)) return [];
  return changes
    .filter(c => c && typeof c === 'object')
    .map(c => ({
      path: string(c.path),
      content: typeof c.content === 'string' ? c.content : ''
    }))
    .filter(c => safePath(c.path));
}

/**
 * Normalizes check runs: [{name: string, status: string, conclusion: string, head_sha?: string}]
 */
function normalizeCheckRuns(checkRuns = []) {
  if (!Array.isArray(checkRuns)) return [];
  return checkRuns
    .filter(Boolean)
    .map(x => {
      if (typeof x === 'string') {
        return { name: string(x), status: 'unknown', conclusion: 'unknown', head_sha: '' };
      }
      return {
        name: string(x.name),
        status: string(x.status),
        conclusion: string(x.conclusion),
        head_sha: string(x.head_sha || x.headSha || x.sha).toLowerCase()
      };
    });
}

/**
 * Normalizes receipts: [{type: string, status: string, conclusion?: string, head_sha: string, url?: string}]
 */
function normalizeReceipts(receipts = []) {
  if (!Array.isArray(receipts)) return [];
  return receipts
    .filter(r => r && typeof r === 'object')
    .map(r => ({
      type: string(r.type || r.name),
      status: string(r.status),
      conclusion: string(r.conclusion || (r.status === 'success' || r.status === 'completed' ? 'success' : '')),
      head_sha: string(r.head_sha || r.headSha || r.sha).toLowerCase(),
      url: string(r.url || r.receipt_url || r.receiptUrl)
    }));
}

/**
 * Verifies whether deliverables contain genuine product source code,
 * enforcing Android (Gradle + Manifest + Kotlin), Frontend (UI code),
 * and Backend (API code), while strictly blocking markdown-only changes.
 */
export function verifyProductArtifacts({ productType, changes = [] } = {}) {
  const type = string(productType).toLowerCase();
  if (!SUPPORTED_PRODUCT_TYPES.includes(type)) {
    return {
      pass: false,
      status: 'BLOCKED',
      code: 'PRODUCT_TYPE_UNSUPPORTED',
      reasons: [`PRODUCT_TYPE_UNSUPPORTED:${type}`],
      missingArtifacts: []
    };
  }

  const normalized = normalizeChanges(changes);
  if (normalized.length === 0) {
    return {
      pass: false,
      status: 'BLOCKED',
      code: 'PRODUCT_CHANGES_EMPTY',
      reasons: ['NO_SOURCE_CHANGES_PROVIDED'],
      missingArtifacts: ['source_files']
    };
  }

  // Anti-cheat: Markdown or documentation-only is never product delivery
  const nonDocChanges = normalized.filter(c => !DOC_EXTENSIONS.test(c.path));
  if (nonDocChanges.length === 0) {
    return {
      pass: false,
      status: 'BLOCKED',
      code: 'DOCUMENTATION_ONLY_NOT_PRODUCT',
      reasons: ['MARKDOWN_DESCRIPTION_NOT_PRODUCT_DONE'],
      missingArtifacts: ['executable_product_code']
    };
  }

  const paths = normalized.map(c => c.path);
  const missing = [];

  if (type === 'android') {
    const hasGradle = paths.some(p => ANDROID_GRADLE_PATTERN.test(p));
    const hasManifest = paths.some(p => ANDROID_MANIFEST_PATTERN.test(p));
    const hasKotlin = paths.some(p => ANDROID_KOTLIN_PATTERN.test(p));

    if (!hasGradle) missing.push('ANDROID_GRADLE_MISSING');
    if (!hasManifest) missing.push('ANDROID_MANIFEST_MISSING');
    if (!hasKotlin) missing.push('ANDROID_KOTLIN_MISSING');
  } else if (type === 'frontend') {
    const hasUI = paths.some(p => FRONTEND_UI_PATTERN.test(p));
    if (!hasUI) missing.push('FRONTEND_UI_CODE_MISSING');
  } else if (type === 'backend') {
    const hasApi = paths.some(p => BACKEND_API_PATTERN.test(p));
    if (!hasApi) missing.push('BACKEND_API_CODE_MISSING');
  }

  if (missing.length > 0) {
    return {
      pass: false,
      status: 'BLOCKED',
      code: 'PRODUCT_ARTIFACTS_INCOMPLETE',
      reasons: missing,
      missingArtifacts: missing
    };
  }

  return {
    pass: true,
    status: 'ACCEPTED',
    code: 'PRODUCT_ARTIFACTS_VERIFIED',
    reasons: [],
    missingArtifacts: [],
    artifactCount: normalized.length
  };
}

/**
 * Verifies execution receipts and required checks against the exact source head SHA.
 * Enforces real build verification for Android, functional test for Frontend,
 * and contract test for Backend. Blocks missing, failed, or SHA-mismatched receipts.
 */
export function verifyProductExecutionReceipts({
  productType,
  sourceHeadSha,
  checkRuns = [],
  receipts = []
} = {}) {
  const type = string(productType).toLowerCase();
  if (!SUPPORTED_PRODUCT_TYPES.includes(type)) {
    return {
      pass: false,
      status: 'BLOCKED',
      code: 'PRODUCT_TYPE_UNSUPPORTED',
      reasons: [`PRODUCT_TYPE_UNSUPPORTED:${type}`]
    };
  }

  const targetSha = string(sourceHeadSha).toLowerCase();
  if (!isSha(targetSha)) {
    return {
      pass: false,
      status: 'BLOCKED',
      code: 'SOURCE_HEAD_SHA_INVALID',
      reasons: ['SOURCE_HEAD_SHA_MUST_BE_40_HEX_CHARACTERS']
    };
  }

  const normalizedChecks = normalizeCheckRuns(checkRuns);
  const normalizedReceipts = normalizeReceipts(receipts);
  const requiredChecks = PRODUCT_REQUIRED_CHECKS[type] || [];
  const reasons = [];

  // Check required checks against checkRuns and receipts
  for (const checkName of requiredChecks) {
    const matchingCheck = normalizedChecks.find(c => c.name === checkName);
    const matchingReceipt = normalizedReceipts.find(r => r.type === checkName);

    if (!matchingCheck && !matchingReceipt) {
      const missingReasonMap = {
        android: 'ANDROID_REAL_BUILD_MISSING',
        frontend: 'FRONTEND_FUNCTIONAL_TEST_MISSING',
        backend: 'BACKEND_CONTRACT_TEST_MISSING'
      };
      reasons.push(missingReasonMap[type] || `REQUIRED_CHECK_MISSING:${checkName}`);
      continue;
    }

    if (matchingCheck) {
      if (matchingCheck.status !== 'completed' || matchingCheck.conclusion !== 'success') {
        reasons.push(`CHECK_NOT_SUCCEEDED:${checkName}:${matchingCheck.status}/${matchingCheck.conclusion}`);
      }
      if (matchingCheck.head_sha && matchingCheck.head_sha !== targetSha) {
        reasons.push(`CHECK_SHA_MISMATCH:${checkName}:expected=${targetSha},actual=${matchingCheck.head_sha}`);
      }
    }

    if (matchingReceipt) {
      if (matchingReceipt.status !== 'completed' && matchingReceipt.conclusion !== 'success') {
        reasons.push(`RECEIPT_NOT_SUCCEEDED:${checkName}:${matchingReceipt.status}/${matchingReceipt.conclusion}`);
      }
      if (matchingReceipt.head_sha && matchingReceipt.head_sha !== targetSha) {
        reasons.push(`RECEIPT_SHA_MISMATCH:${checkName}:expected=${targetSha},actual=${matchingReceipt.head_sha}`);
      }
    }
  }

  // Anti-cheat: Check if only generic CI runs are present without product checks
  const genericCiNames = new Set(['CI Verify', 'Queue Hygiene Verify', 'Vercel Online Verify', 'lint', 'build']);
  const onlyGenericCi = normalizedChecks.length > 0 &&
    normalizedChecks.every(c => genericCiNames.has(c.name)) &&
    !normalizedChecks.some(c => requiredChecks.includes(c.name));

  if (onlyGenericCi) {
    reasons.push('GENERIC_CI_CANNOT_SUBSTITUTE_PRODUCT_ACCEPTANCE');
  }

  if (reasons.length > 0) {
    const hasShaMismatch = reasons.some(r => r.includes('SHA_MISMATCH'));
    const code = hasShaMismatch
      ? 'ACCEPTANCE_BLOCKED_SHA_MISMATCH'
      : (reasons.some(r => r.includes('MISSING')) ? 'ACCEPTANCE_BLOCKED_MISSING_VERIFICATION' : 'ACCEPTANCE_BLOCKED_EXECUTION_UNVERIFIED');

    return {
      pass: false,
      status: 'BLOCKED',
      code,
      reasons,
      sourceHeadSha: targetSha
    };
  }

  return {
    pass: true,
    status: 'ACCEPTED',
    code: 'PRODUCT_EXECUTION_RECEIPTS_VERIFIED',
    reasons: [],
    sourceHeadSha: targetSha,
    verifiedChecks: requiredChecks
  };
}

/**
 * Unified gate function for product acceptance.
 * Evaluates source artifacts, execution receipts, and blocks all prohibited shortcuts
 * (closed issues without independent verification, markdown-only, generic CI only, SHA mismatch).
 */
export function evaluateProductAcceptance({
  productType,
  sourceHeadSha,
  changes = [],
  checkRuns = [],
  receipts = [],
  issue = null,
  externallyVerified = false
} = {}) {
  const type = string(productType).toLowerCase();
  const targetSha = string(sourceHeadSha).toLowerCase();

  if (!SUPPORTED_PRODUCT_TYPES.includes(type)) {
    return {
      pass: false,
      status: 'BLOCKED',
      code: 'PRODUCT_TYPE_UNSUPPORTED',
      reasons: [`PRODUCT_TYPE_UNSUPPORTED:${type}`],
      deliverableType: type,
      sourceHeadSha: targetSha
    };
  }

  // Anti-cheat: Closed issue inspection. If an issue is passed and marked closed,
  // it cannot be treated as accepted delivery unless independently verified.
  if (issue && typeof issue === 'object') {
    const issueState = string(issue.state).toLowerCase();
    if (issueState === 'closed' && externallyVerified !== true) {
      return {
        pass: false,
        status: 'BLOCKED',
        code: 'CLOSED_ISSUE_NOT_ACCEPTANCE',
        reasons: ['CLOSED_ISSUE_CANNOT_SUBSTITUTE_PRODUCT_ACCEPTANCE'],
        deliverableType: type,
        sourceHeadSha: targetSha
      };
    }
  }

  // Gate 1: Artifact validation
  const artifactResult = verifyProductArtifacts({ productType: type, changes });
  if (!artifactResult.pass) {
    return {
      pass: false,
      status: 'BLOCKED',
      code: artifactResult.code,
      reasons: artifactResult.reasons,
      deliverableType: type,
      sourceHeadSha: targetSha,
      details: { artifactResult }
    };
  }

  // Gate 2: Execution receipts and exact SHA validation
  const executionResult = verifyProductExecutionReceipts({
    productType: type,
    sourceHeadSha: targetSha,
    checkRuns,
    receipts
  });
  if (!executionResult.pass) {
    return {
      pass: false,
      status: 'BLOCKED',
      code: executionResult.code,
      reasons: executionResult.reasons,
      deliverableType: type,
      sourceHeadSha: targetSha,
      details: { artifactResult, executionResult }
    };
  }

  return {
    pass: true,
    status: 'ACCEPTED',
    code: 'PRODUCT_ACCEPTANCE_PASSED',
    reasons: [],
    deliverableType: type,
    sourceHeadSha: targetSha,
    details: {
      schema: PRODUCT_ACCEPTANCE_SCHEMA,
      artifactCount: artifactResult.artifactCount,
      verifiedChecks: executionResult.verifiedChecks
    }
  };
}

/**
 * Asserts product acceptance; throws typed Error if BLOCKED.
 */
export function assertProductAcceptance(params) {
  const result = evaluateProductAcceptance(params);
  if (!result.pass) {
    const err = new Error(`PRODUCT_ACCEPTANCE_BLOCKED: ${result.code} - ${result.reasons.join('; ')}`);
    err.code = result.code;
    err.reasons = result.reasons;
    err.status = result.status;
    err.details = result.details;
    throw err;
  }
  return result;
}
