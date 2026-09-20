import { strict as assert } from 'assert';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { resolve, join } from 'path';
import os from 'os';
import { createReadStream } from 'fs';
import tar from 'tar';
import Ajv from 'ajv';

const script = resolve('scripts/nv02-release/build-packager.mjs');
const archive = resolve('chrome-controller-src.tar.gz');
const sourceRoot = resolve('apps/chrome-controller');
const manifestPath = join(sourceRoot, 'source-manifest.json');

function execNode(args = []) {
  return new Promise((res, rej) => {
    execFile('node', [script, ...args], (error, stdout, stderr) => {
      if (error) rej({ error, stdout, stderr });
      else res({ stdout, stderr });
    });
  });
}

describe('NV02 Release Package', () => {
  before(async () => {
    // clean previous artifacts
    await Promise.all([
      fs.rm(archive, { force: true }),
      fs.rm(manifestPath, { force: true })
    ]);
    await execNode();
  });

  it('creates archive file', async () => {
    const stat = await fs.stat(archive);
    assert.ok(stat.isFile(), 'Archive should be a file');
    assert.ok(stat.size > 0, 'Archive should not be empty');
  });

  it('produces a valid manifest', async () => {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    const schemaRaw = await fs.readFile(resolve('scripts/nv02-release/manifest-schema.json'), 'utf8');
    const schema = JSON.parse(schemaRaw);
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    assert.ok(validate(manifest), 'Manifest must conform to schema');
    // verify each file hash matches the file on disk
    for (const { path: rel, sha256 } of manifest.files) {
      const abs = resolve(sourceRoot, rel);
      const data = await fs.readFile(abs);
      const actual = createHash('sha256').update(data).digest('hex');
      assert.equal(actual, sha256, `Hash mismatch for ${rel}`);
    }
  });

  it('archive contains exactly the source files listed in manifest', async () => {
    const tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'nv02-test-'));
    await tar.x({ file: archive, cwd: tmpDir, strip: 1 });
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const extractedFiles = [];
    async function walk(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = resolve(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else extractedFiles.push(relative(tmpDir, p).replace(/\\/g, '/'));
      }
    }
    await walk(tmpDir);
    const listed = manifest.files.map(f => f.path).sort();
    const extracted = extractedFiles.sort();
    assert.deepEqual(extracted, listed, 'Extracted files must match manifest list');
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
