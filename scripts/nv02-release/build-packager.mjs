import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { resolve, relative, join } from 'path';
import { pipeline } from 'stream';
import { createGzip } from 'zlib';
import { tar } from 'tar';
import Ajv from 'ajv';

const SOURCE_ROOT = resolve('apps/chrome-controller');
const OUTPUT_ARCHIVE = process.argv[2] ?? 'chrome-controller-src.tar.gz';
const MANIFEST_PATH = join(SOURCE_ROOT, 'source-manifest.json');

async function hashFile(filePath) {
  const hash = createHash('sha256');
  const data = await fs.readFile(filePath);
  hash.update(data);
  return hash.digest('hex');
}

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

async function buildManifest() {
  const pkgPath = join(SOURCE_ROOT, 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  const filePaths = await collectFiles(SOURCE_ROOT);
  // deterministic order
  filePaths.sort();
  const files = [];
  for (const fp of filePaths) {
    const rel = relative(SOURCE_ROOT, fp).replace(/\\/g, '/');
    const sha = await hashFile(fp);
    files.push({ path: rel, sha256: sha });
  }
  const manifest = {
    name: pkg.name ?? 'chrome-controller',
    version: pkg.version ?? '0.0.0',
    files,
  };
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

async function verifyManifest(manifest) {
  const schema = JSON.parse(await fs.readFile(resolve('scripts/nv02-release/manifest-schema.json'), 'utf8'));
  const ajv = new Ajv();
  const validate = ajv.compile(schema);
  if (!validate(manifest)) {
    console.error('Manifest validation failed:', validate.errors);
    process.exit(1);
  }
  // verify each file hash
  for (const { path: rel, sha256 } of manifest.files) {
    const abs = resolve(SOURCE_ROOT, rel);
    const actual = await hashFile(abs);
    if (actual !== sha256) {
      console.error(`Hash mismatch for ${rel}: expected ${sha256}, got ${actual}`);
      process.exit(1);
    }
  }
}

async function createArchive() {
  // deterministic tar: sort entries, set mtime to 0, uid/gid to 0, mode to 0o644
  await tar.c(
    {
      gzip: true,
      file: OUTPUT_ARCHIVE,
      cwd: SOURCE_ROOT,
      portable: true,
      noMtime: true,
      // tar's portable flag already normalises uid/gid, mode, mtime
    },
    ['.']
  );
}

async function main() {
  const manifest = await buildManifest();
  await verifyManifest(manifest);
  await createArchive();
  console.log(`Package created at ${OUTPUT_ARCHIVE}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
