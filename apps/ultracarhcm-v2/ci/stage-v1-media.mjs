// GH-5135: only stage locally authorized assets; never commit APK-extracted media by default.
// Usage: node ci/stage-v1-media.mjs --source <EXTRACTED_APK>/res --target <V2_PROJECT_DIR> [--stage --rights-evidence <file>]
// Default = READ_ONLY verification. --stage intentionally requires a separate rights evidence document.
import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RIGHTS_SCHEMA = 'tigeriq.ultracarhcm-v2.media-rights.v1';
export const RIGHTS_SCOPE = 'PRIVATE_V2_REUSE';

export const media = Object.freeze([
  { from: 'drawable/road_city_day.jpg', to: 'drawable-nodpi/v2_road_city_day.jpg', observedBytes: 504703 },
  { from: 'drawable/road_city_night.jpg', to: 'drawable-nodpi/v2_road_city_night.jpg', observedBytes: 371840 },
  { from: 'drawable/logo_ultracar.png', to: 'drawable-nodpi/v2_logo_ultracar.png', observedBytes: 283212 },
  { from: 'drawable/car_limo_do_parked.webp', to: 'drawable-nodpi/v2_car_limo_do_parked.webp', observedBytes: 82770 },
  { from: 'drawable/car_lambogini_trang_parked.webp', to: 'drawable-nodpi/v2_car_lambogini_trang_parked.webp', observedBytes: 113866 },
  { from: 'raw/ultrabot_glow_packed.mp4', to: 'raw/ultrabot_glow_packed.mp4', observedBytes: 138079 }
]);

const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');

// lstat is intentional: existsSync() returns false for dangling symbolic links,
// but copyFileSync() follows them and can create/overwrite a target outside V2.
function assertNoDestinationSymlink(projectDir, output, assetName) {
  const projectRoot = resolve(projectDir);
  let segment = output;
  while (true) {
    try {
      if (lstatSync(segment).isSymbolicLink())
        throw new Error('DESTINATION_SYMLINK_FORBIDDEN:' + assetName);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (segment === projectRoot) return;
    const parent = dirname(segment);
    if (parent === segment) throw new Error('DESTINATION_OUTSIDE_PROJECT:' + assetName);
    segment = parent;
  }
}


/**
 * Confine source media to the exact audited resource tree.
 * lstat on a leaf alone misses source directory symlinks that resolve outside
 * sourceRes; even READ_ONLY audit must not hash unexpected external files.
 */
function assertNoSourceSymlink(sourceRes, input, assetName) {
  const sourceRoot = resolve(sourceRes);
  let segment = input;
  while (true) {
    try {
      if (lstatSync(segment).isSymbolicLink())
        throw new Error('SOURCE_SYMLINK_FORBIDDEN:' + assetName);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (segment === sourceRoot) return;
    const parent = dirname(segment);
    if (parent === segment) throw new Error('SOURCE_OUTSIDE_ROOT:' + assetName);
    segment = parent;
  }
}

function isIsoDateTime(value) {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

/**
 * Machine-verifiable receipt contract only. This does not adjudicate copyright
 * ownership; it prevents an arbitrary text file from bypassing the staging gate
 * and binds the asserted grant to the exact six audited source bytes.
 */
export function validateRightsEvidence(rightsEvidence, files) {
  if (!rightsEvidence || !existsSync(rightsEvidence) || !statSync(rightsEvidence).isFile())
    throw new Error('V1_MEDIA_REUSE_RIGHTS_EVIDENCE_REQUIRED');

  let receipt;
  try {
    receipt = JSON.parse(readFileSync(rightsEvidence, 'utf8'));
  } catch {
    throw new Error('V1_MEDIA_REUSE_RIGHTS_EVIDENCE_INVALID_JSON');
  }

  if (receipt?.schema !== RIGHTS_SCHEMA)
    throw new Error('V1_MEDIA_REUSE_RIGHTS_EVIDENCE_SCHEMA_MISMATCH');
  if (receipt?.workOrder !== 'GH-5135')
    throw new Error('V1_MEDIA_REUSE_RIGHTS_EVIDENCE_WORK_ORDER_MISMATCH');
  if (receipt?.scope !== RIGHTS_SCOPE)
    throw new Error('V1_MEDIA_REUSE_RIGHTS_EVIDENCE_SCOPE_MISMATCH');
  if (receipt?.decision !== 'GRANTED')
    throw new Error('V1_MEDIA_REUSE_RIGHTS_EVIDENCE_NOT_GRANTED');
  if (typeof receipt?.grantor !== 'string' || receipt.grantor.trim().length < 3)
    throw new Error('V1_MEDIA_REUSE_RIGHTS_EVIDENCE_GRANTOR_REQUIRED');
  if (typeof receipt?.evidenceRef !== 'string' || receipt.evidenceRef.trim().length < 5)
    throw new Error('V1_MEDIA_REUSE_RIGHTS_EVIDENCE_REF_REQUIRED');
  if (!isIsoDateTime(receipt?.issuedAt))
    throw new Error('V1_MEDIA_REUSE_RIGHTS_EVIDENCE_ISSUED_AT_INVALID');
  if (!Array.isArray(receipt?.assets))
    throw new Error('V1_MEDIA_REUSE_RIGHTS_EVIDENCE_ASSETS_REQUIRED');

  const expected = new Map(files.map(item => [item.from, item.sha256]));
  const seen = new Set();
  for (const asset of receipt.assets) {
    if (!asset || typeof asset.path !== 'string' || !expected.has(asset.path))
      throw new Error('V1_MEDIA_REUSE_RIGHTS_EVIDENCE_UNEXPECTED_ASSET');
    if (seen.has(asset.path))
      throw new Error('V1_MEDIA_REUSE_RIGHTS_EVIDENCE_DUPLICATE_ASSET:' + asset.path);
    if (typeof asset.sha256 !== 'string' || asset.sha256.toLowerCase() !== expected.get(asset.path))
      throw new Error('V1_MEDIA_REUSE_RIGHTS_EVIDENCE_SHA_MISMATCH:' + asset.path);
    seen.add(asset.path);
  }
  if (seen.size !== expected.size)
    throw new Error('V1_MEDIA_REUSE_RIGHTS_EVIDENCE_INCOMPLETE_ASSET_SET');

  return {
    schema: receipt.schema,
    workOrder: receipt.workOrder,
    scope: receipt.scope,
    decision: receipt.decision,
    grantor: receipt.grantor.trim(),
    evidenceRef: receipt.evidenceRef.trim(),
    issuedAt: receipt.issuedAt,
    assetCount: seen.size,
  };
}

export function projectDirFromArgs(args) {
  const option = flag => {
    const at = args.indexOf(flag);
    return at === -1 ? null : (args[at + 1] ?? null);
  };
  // --target is the documented CLI name; --project remains a compatibility alias.
  return option('--target') || option('--project');
}

export function stageMedia({ sourceRes, projectDir, stage = false, rightsEvidence = null }) {
  if (!sourceRes || !projectDir) throw new Error('SOURCE_AND_PROJECT_DIR_REQUIRED');
  const source = resolve(sourceRes);
  const target = resolve(projectDir, 'app/src/main/res');
  const missing = [];
  const badFiles = [];
  const files = media.map(item => {
    const input = join(source, item.from);
    const output = join(target, item.to);
    // Check each source component before stat/hash, including dangling links.
    assertNoSourceSymlink(source, input, item.from);
    if (!existsSync(input)) { missing.push(item.from); return { from: item.from, to: item.to, status: 'MISSING' }; }
    const info = lstatSync(input);
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) {
      badFiles.push(item.from);
      return { from: item.from, to: item.to, status: 'INVALID_SOURCE' };
    }
    // PC01 inventory only establishes observed byte counts, not usage rights or provenance.
    // Refuse to stage differently sized files instead of silently accepting substitutions.
    if (info.size !== item.observedBytes) {
      badFiles.push(item.from);
      return { from: item.from, to: item.to, bytes: info.size,
        observedBytes: item.observedBytes, status: 'SIZE_MISMATCH' };
    }
    return { from: item.from, to: item.to, bytes: info.size, observedBytes: item.observedBytes,
      sha256: hash(input), status: 'AVAILABLE', input, output };
  });
  if (missing.length || badFiles.length) {
    return { ok: false, staged: false, missing, badFiles,
      files: files.map(({ input, output, ...safe }) => safe) };
  }
  if (stage) {
    // Rights must come from an external, explicit receipt. This script only
    // validates the receipt contract and exact asset hashes; it never invents a grant.
    validateRightsEvidence(rightsEvidence, files);
    // Preflight all destinations first; a late conflict must never leave partial copies.
    for (const item of files) {
      assertNoDestinationSymlink(projectDir, item.output, item.to);
      if (existsSync(item.output) && hash(item.output) !== item.sha256)
        throw new Error('DESTINATION_ALREADY_EXISTS_DIFFERENT_BYTES:' + item.to);
    }
    for (const item of files) {
      if (existsSync(item.output)) continue;
      mkdirSync(dirname(item.output), { recursive: true });
      assertNoDestinationSymlink(projectDir, item.output, item.to);
      // COPYFILE_EXCL prevents another writer or a newly created link being overwritten.
      copyFileSync(item.input, item.output, constants.COPYFILE_EXCL);
      if (hash(item.output) !== item.sha256) throw new Error('STAGE_SHA256_MISMATCH:' + item.to);
    }
  }
  return { ok: true, staged: stage, missing: [], badFiles: [],
    files: files.map(({ input, output, ...safe }) => safe) };
}

const self = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (self) {
  const args = process.argv.slice(2);
  const option = flag => {
    const at = args.indexOf(flag);
    return at === -1 ? null : args[at + 1];
  };
  try {
    const sourceRes = option('--source');
    const projectDir = projectDirFromArgs(args);
    const stage = args.includes('--stage');
    const rightsEvidence = option('--rights-evidence');
    const report = stageMedia({ sourceRes, projectDir, stage, rightsEvidence });
    console.log(JSON.stringify({ workOrder: 'GH-5135', mode: stage ? 'PRIVATE_STAGE' : 'READ_ONLY', ...report }, null, 2));
    if (!report.ok) process.exitCode = 2;
  } catch (error) {
    console.error('GH5135_ASSET_STAGE_BLOCKED:', error.message);
    process.exitCode = 3;
  }
}
