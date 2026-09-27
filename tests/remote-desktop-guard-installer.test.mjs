import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRemoteDesktopGuard } from '../apps/remote-desktop-guard/install-runtime.mjs';
import { authorizeRemoteCall } from '../apps/remote-desktop-guard/policy.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(repoRoot, 'apps', 'remote-desktop-guard');

const serverFixture = `import path from 'path';
function setCurrentCallIsRemote() {}
export async function handler(allTools, shouldIncludeTool, isRemoteCall, name, args) {
        const filteredTools = allTools.filter(tool => shouldIncludeTool(tool.name));
        setCurrentCallIsRemote(isRemoteCall);
        return filteredTools;
}
`;
const launcherFixture = `$app="fixture"
$log="fixture.log"
Set-Location $app
`;

async function fixture(version = '0.2.51') {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'tigeriq-rdc-'));
  const packageRoot = path.join(runtimeRoot, 'app-0.2.51', 'node_modules', '@wonderwhy-er', 'desktop-commander');
  const distRoot = path.join(packageRoot, 'dist');
  await mkdir(distRoot, { recursive: true });
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ version }), 'utf8');
  await writeFile(path.join(distRoot, 'server.js'), serverFixture, 'utf8');
  await writeFile(path.join(runtimeRoot, 'start-desktop-commander-remote.ps1'), launcherFixture, 'utf8');
  return { runtimeRoot, packageRoot, distRoot };
}

test('runtime installer is idempotent and exposes owner authorizer source', async () => {
  const f = await fixture();
  try {
    const first = await installRemoteDesktopGuard({ runtimeRoot: f.runtimeRoot, sourceDir });
    assert.equal(first.ok, true);
    assert.equal(first.changed, true);
    assert.equal(first.authorizer, 'tigeriq_authorize_mutation');

    const policy = await readFile(path.join(f.distRoot, 'tigeriq-remote-guard', 'policy.mjs'), 'utf8');
    const gate = await readFile(path.join(f.distRoot, 'tigeriq-remote-guard', 'runtime-gate.mjs'), 'utf8');
    const server = await readFile(path.join(f.distRoot, 'server.js'), 'utf8');
    const launcher = await readFile(path.join(f.runtimeRoot, 'start-desktop-commander-remote.ps1'), 'utf8');
    assert.match(policy, /tigeriq_authorize_mutation/);
    assert.match(gate, /installOwnerLeaseFromAuthorization/);
    assert.match(server, /TIGERIQ_REMOTE_GUARD_LIST_V3/);
    assert.match(launcher, /TIGERIQ_REMOTE_GUARD_LAUNCHER_V3/);

    const second = await installRemoteDesktopGuard({ runtimeRoot: f.runtimeRoot, sourceDir });
    assert.equal(second.ok, true);
    assert.equal(second.changed, false);
  } finally {
    await rm(f.runtimeRoot, { recursive: true, force: true });
  }
});

test('runtime installer fails closed on version drift', async () => {
  const f = await fixture('0.2.52');
  try {
    await assert.rejects(
      installRemoteDesktopGuard({ runtimeRoot: f.runtimeRoot, sourceDir }),
      /RDC_VERSION_MISMATCH/
    );
    assert.equal(await readFile(path.join(f.distRoot, 'server.js'), 'utf8'), serverFixture);
  } finally {
    await rm(f.runtimeRoot, { recursive: true, force: true });
  }
});

test('runtime installer rolls back partial writes', async () => {
  const f = await fixture();
  const policyPath = path.join(f.distRoot, 'tigeriq-remote-guard', 'policy.mjs');
  try {
    await assert.rejects(
      installRemoteDesktopGuard({ runtimeRoot: f.runtimeRoot, sourceDir, failAfterWrites: 1 }),
      /RDC_GUARD_INSTALL_ROLLED_BACK/
    );
    assert.equal(await readFile(path.join(f.distRoot, 'server.js'), 'utf8'), serverFixture);
    assert.equal(await readFile(path.join(f.runtimeRoot, 'start-desktop-commander-remote.ps1'), 'utf8'), launcherFixture);
    await assert.rejects(access(policyPath));
  } finally {
    await rm(f.runtimeRoot, { recursive: true, force: true });
  }
});

test('mutation still fails closed without an owner lease', () => {
  const result = authorizeRemoteCall({
    tool: 'start_process',
    args: { command: 'cmd /c echo test' },
    now: Date.now(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'OWNER_AUTH_REQUIRED');
});
