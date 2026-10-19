import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

// P01 fallback PRE-FLIGHT, not actual UltraCar APK/REA or USB/R acceptance.
// Keep expensive native-tool smoke opt-in, except on this one scoped PR.
const targetedBranch = 'test/dexcam-jadx-public-preflight-20261019-nv02';
const authorizedPrRun = process.env.GITHUB_ACTIONS === 'true' &&
  process.env.GITHUB_WORKFLOW === 'CI' &&
  process.env.GITHUB_HEAD_REF === targetedBranch;
const enabled = process.env.DEXCAM_JADX_PUBLIC_SMOKE === '1' || authorizedPrRun;
const execFile = promisify(execFileCallback);

const publicApkUrl =
  'https://raw.githubusercontent.com/androguard/androguard/3ea3da38e74b4d74579463d0688ab513786c4750/tests/data/APK/TestActivity.apk';
const publicApkGitBlob = 'b43a1d3da7b68c8a3aa94bed8534ea3bfce80e1b';
const jadxUrl = 'https://github.com/skylot/jadx/releases/download/v1.5.5/jadx-1.5.5.zip';
// Independent binary hash published for upstream release by Chocolatey:
// https://community.chocolatey.org/packages/jadx/1.5.5
const jadxZipSha256 = '38a5766d3c8170c41566b4b13ea0ede2430e3008421af4927235c2880234d51a';

async function getPinnedBytes(url: string, limit: number): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error('PUBLIC_FIXTURE_DOWNLOAD_FAILED');
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit) throw new Error('PUBLIC_ARTIFACT_TOO_LARGE');
  const chunks: Buffer[] = [];
  let total = 0;
  if (!response.body) throw new Error('PUBLIC_ARTIFACT_EMPTY');
  for await (const chunk of response.body) {
    const b = Buffer.from(chunk);
    total += b.length;
    if (total > limit) {
      await response.body.cancel().catch(() => undefined);
      throw new Error('PUBLIC_ARTIFACT_TOO_LARGE');
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks, total);
}

it.skipIf(!enabled)('P01 fallback runs pinned real JADX on exact public APK in isolated CI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dexcam-public-jadx-'));
  try {
    const apk = await getPinnedBytes(publicApkUrl, 2 * 1024 * 1024);
    expect(apk.length).toBe(174896);
    const blob = createHash('sha1').update('blob ' + apk.length + '\0').update(apk).digest('hex');
    expect(blob).toBe(publicApkGitBlob);
    const archive = await getPinnedBytes(jadxUrl, 100 * 1024 * 1024);
    expect(createHash('sha256').update(archive).digest('hex')).toBe(jadxZipSha256);

    const apkPath = join(root, 'public-sample.apk');
    const archivePath = join(root, 'verified-jadx.zip');
    const executableDir = join(root, 'jadx');
    const decodedDir = join(root, 'out');
    await Promise.all([writeFile(apkPath, apk), writeFile(archivePath, archive), mkdir(executableDir)]);
    await execFile('unzip', ['-q', archivePath, '-d', executableDir], { timeout: 30_000 });
    const binary = join(executableDir, 'bin', 'jadx');
    // The real upstream JADX CLI is executed, NOT REA or private APK tooling.
    // Execute the verified upstream bash launcher as a script; ZIP mode bits may not survive unpack.
    await execFile('bash', [binary, '--threads-count', '1', '--output-dir', decodedDir, apkPath],
      { timeout: 120_000, maxBuffer: 3 * 1024 * 1024 });
    const manifest = await readFile(join(decodedDir, 'resources', 'AndroidManifest.xml'), 'utf8');
    expect(manifest).toMatch(/<manifest\b/);
    expect((await stat(join(decodedDir, 'sources'))).isDirectory()).toBe(true);
    console.log('PUBLIC_JADX_SOURCE_AND_MANIFEST_VERIFIED; P01_REA=false; DEVICE=false');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 300_000);
