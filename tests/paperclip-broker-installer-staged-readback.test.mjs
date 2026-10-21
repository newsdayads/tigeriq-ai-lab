import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = await readFile(
  new URL('../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs', import.meta.url),
  'utf8',
);
const install = source.slice(
  source.indexOf('async function installInteractiveWslBroker('),
  source.indexOf('async function runBrokerRequest('),
);
const installerGuard = /if \(await fs\.readFile\(safeInstaller, 'utf8'\) !== installerSource\) \{\s*throw new Error\('TIGERIQ_PAPERCLIP_LAB_WSL_BROKER_INSTALLER_SOURCE_DRIFT'\);\s*\}/g;

describe('GH-2054 Paperclip broker installer provenance', () => {
  it('checks the exact installer bytes after staging and before the scheduled-task mutation', () => {
    const staged = install.indexOf("await fs.writeFile(safeInstaller, installerSource, 'utf8')");
    const launch = install.indexOf('const result = await runFixed(');
    const guards = [...install.matchAll(installerGuard)].map((match) => match.index);
    expect(staged).toBeGreaterThan(-1);
    expect(launch).toBeGreaterThan(staged);
    expect(guards).toHaveLength(2);
    expect(guards[0]).toBeGreaterThan(staged);
    expect(guards[0]).toBeLessThan(launch);
  });

  it('rechecks installer bytes after the scheduled-task launch before reporting installed', () => {
    const launch = install.indexOf('const result = await runFixed(');
    const returnInstalled = install.indexOf('    installed: true,');
    const guards = [...install.matchAll(installerGuard)].map((match) => match.index);
    expect(guards).toHaveLength(2);
    expect(guards[1]).toBeGreaterThan(launch);
    expect(guards[1]).toBeLessThan(returnInstalled);
    expect(install).toContain("if (await fs.readFile(safeBroker, 'utf8') !== brokerSource)");
  });
});
