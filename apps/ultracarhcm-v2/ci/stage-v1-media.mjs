// GH-5135: only stage locally authorized assets; never commit APK-extracted media by default.
// Usage: node ci/stage-v1-media.mjs --source <EXTRACTED_APK>/res --target <V2_PROJECT_DIR> [--stage --rights-evidence <file>]
// Default = READ_ONLY verification. --stage intentionally requires a separate rights evidence document.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const media = Object.freeze([
  { from: 'drawable/road_city_day.jpg', to: 'drawable-nodpi/v2_road_city_day.jpg', observedBytes: 504703 },
  { from: 'drawable/road_city_night.jpg', to: 'drawable-nodpi/v2_road_city_night.jpg', observedBytes: 371840 },
  { from: 'drawable/logo_ultracar.png', to: 'drawable-nodpi/v2_logo_ultracar.png', observedBytes: 420199 },
  { from: 'drawable/car_limo_do_parked.webp', to: 'drawable-nodpi/v2_car_limo_do_parked.webp', observedBytes: 82770 },
  { from: 'drawable/car_lambogini_trang_parked.webp', to: 'drawable-nodpi/v2_car_lambogini_trang_parked.webp', observedBytes: 113866 },
  { from: 'raw/ultrabot_glow_packed.mp4', to: 'raw/ultrabot_glow_packed.mp4', observedBytes: 138079 }
]);

const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');

export function stageMedia({ sourceRes, projectDir, stage = false, rightsEvidence = null }) {
  if (!sourceRes || !projectDir) throw new Error('SOURCE_AND_PROJECT_DIR_REQUIRED');
  const source = resolve(sourceRes);
  const target = resolve(projectDir, 'app/src/main/res');
  const missing = [];
  const badFiles = [];
  const files = media.map(item => {
    const input = join(source, item.from);
    const output = join(target, item.to);
    if (!existsSync(input)) { missing.push(item.from); return { from: item.from, to: item.to, status: 'MISSING' }; }
    const info = lstatSync(input);
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) {
      badFiles.push(item.from);
      return { from: item.from, to: item.to, status: 'INVALID_SOURCE' };
    }
    return { from: item.from, to: item.to, bytes: info.size, observedBytes: item.observedBytes,
      sha256: hash(input), status: 'AVAILABLE', input, output };
  });
  if (missing.length || badFiles.length) {
    return { ok: false, staged: false, missing, badFiles,
      files: files.map(({ input, output, ...safe }) => safe) };
  }
  if (stage) {
    // A license grant / rights receipt must be supplied externally; this script does not invent one.
    if (!rightsEvidence || !existsSync(rightsEvidence) || !statSync(rightsEvidence).isFile() ||
        readFileSync(rightsEvidence, 'utf8').trim().length < 20) {
      throw new Error('V1_MEDIA_REUSE_RIGHTS_EVIDENCE_REQUIRED');
    }
    // Preflight all destinations first; a late conflict must never leave partial copies.
    for (const item of files) {
      if (existsSync(item.output) && hash(item.output) !== item.sha256)
        throw new Error('DESTINATION_ALREADY_EXISTS_DIFFERENT_BYTES:' + item.to);
    }
    for (const item of files) {
      if (existsSync(item.output)) continue;
      mkdirSync(dirname(item.output), { recursive: true });
      copyFileSync(item.input, item.output);
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
    const projectDir = option('--project');
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
