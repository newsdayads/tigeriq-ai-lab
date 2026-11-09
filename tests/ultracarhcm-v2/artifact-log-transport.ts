import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const GH5135_BRANCH_PREFIX = 'nv02/gh5135-';
const ULTRACAR_PATH_PREFIXES = [
  'apps/ultracarhcm-v2/',
  'tests/ultracarhcm-v2/',
] as const;

function changedPaths(event: Record<string, unknown>): string[] {
  const commits = Array.isArray(event.commits) ? event.commits : [];
  const paths: string[] = [];
  for (const raw of commits) {
    if (!raw || typeof raw !== 'object') continue;
    const commit = raw as Record<string, unknown>;
    for (const key of ['added', 'modified', 'removed'] as const) {
      const entries = Array.isArray(commit[key]) ? commit[key] : [];
      for (const entry of entries) if (typeof entry === 'string') paths.push(entry);
    }
  }
  return paths;
}

export function shouldExportGh5135ArtifactViaCiLog(
  workflow: string | undefined,
  eventName: string | undefined,
  event: Record<string, unknown>,
  headRef: string | undefined,
): boolean {
  if (workflow !== 'CI') return false;
  if (eventName === 'pull_request') {
    return typeof headRef === 'string' && headRef.startsWith(GH5135_BRANCH_PREFIX);
  }
  if (eventName !== 'push' || event.ref !== 'refs/heads/main') return false;
  const scopedPathChanged = changedPaths(event).some(path =>
    ULTRACAR_PATH_PREFIXES.some(prefix => path.startsWith(prefix)),
  );
  if (scopedPathChanged) return true;
  const headCommit = event.head_commit;
  if (!headCommit || typeof headCommit !== 'object') return false;
  const message = (headCommit as Record<string, unknown>).message;
  return typeof message === 'string' && /(?:GH-5135|#5135)/.test(message);
}

export type ArtifactLogReceipt = {
  fileName: string;
  bytes: number;
  sha256: string;
  chunks: number;
};

export function writeArtifactToCiLog(
  filePath: string,
  fileName: string,
  logger: (line: string) => void = console.log,
  chunkChars = 24_000,
): ArtifactLogReceipt {
  if (!/^[A-Za-z0-9._-]{1,240}$/.test(fileName)) throw new Error('GH5135_ARTIFACT_NAME_INVALID');
  if (!Number.isInteger(chunkChars) || chunkChars < 4_000 || chunkChars > 32_000 || chunkChars % 4 !== 0) {
    throw new Error('GH5135_ARTIFACT_CHUNK_SIZE_INVALID');
  }
  const bytes = readFileSync(filePath);
  if (bytes.length === 0) throw new Error('GH5135_ARTIFACT_EMPTY');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const encoded = bytes.toString('base64');
  const chunks = Math.ceil(encoded.length / chunkChars);
  logger(
    'GH5135_ARTIFACT_B64_BEGIN|name=' + fileName +
    '|bytes=' + bytes.length + '|sha256=' + sha256 + '|chunks=' + chunks,
  );
  for (let index = 0; index < chunks; index += 1) {
    const sequence = String(index + 1).padStart(6, '0');
    logger(
      'GH5135_ARTIFACT_B64_CHUNK|' + sequence + '|' +
      encoded.slice(index * chunkChars, (index + 1) * chunkChars),
    );
  }
  logger(
    'GH5135_ARTIFACT_B64_END|name=' + fileName +
    '|bytes=' + bytes.length + '|sha256=' + sha256 + '|chunks=' + chunks,
  );
  return {fileName, bytes: bytes.length, sha256, chunks};
}
