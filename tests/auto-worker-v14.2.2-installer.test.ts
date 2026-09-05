import { describe, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const p=(x:string)=>path.resolve(x);
const read=(x:string)=>fs.readFileSync(p(x),'utf8');
const cmdPath='artifacts/auto-worker/v14.2.2/TigerIQ_AW_14.2.2.cmd';
const psPath='scripts/pc-worker/TigerIQ_AW_14.2.2_installer.ps1';

describe('TigerIQ Auto Worker V14.2.2 installer repair',()=>{
  it('pins immutable repaired installer source',()=>{const s=read(cmdPath);assert.match(s,/8f0a45c57588a9abb846192517240fb21153f5de/);assert.match(s,/57be6bcfea2cea8afb375842b4b825d13689b7e59afc9bf6e41e7e1b8109fc2e/)});
  it('repairs every concatenated PowerShell return token before dot-source',()=>{const s=read(psPath);assert.match(s,/badReturnPattern='\\breturn\(\?=\[\$@\\\[\]\)'/);assert.match(s,/\[regex\]::Replace\(\$libRaw,\$badReturnPattern,'return '\)/);assert.match(s,/RETURN_TOKEN_FIXUP_FAILED/);assert.match(s,/Management\.Automation\.Language\.Parser/)});
  it('has exact owner-CMD Windows preflight before machine mutation',()=>{const s=read(psPath);const pre=s.indexOf('WINDOWS_OWNER_CMD_PREFLIGHT=PASS');const mutation=s.indexOf('Find-ExtensionPath');assert.ok(pre>0);assert.ok(mutation>pre);assert.match(read(cmdPath),/TIQ_PREFLIGHT_ONLY/)});
  it('preserves preactivation authority and extension identity',()=>{const s=read(psPath);assert.match(s,/leidfhbpdillakmcbijagelghhilbnpc/);assert.match(s,/NV02_PAYLOAD_AUTHORITY_INVALID/);assert.match(s,/NV04_PAYLOAD_AUTHORITY_INVALID/);assert.match(s,/NV05_PAYLOAD_AUTHORITY_INVALID/);assert.match(s,/EXTENSION_KEY_CHANGED_ROLLBACK/)});
  it('keeps Chrome non-destructive install policy',()=>{const s=(read(psPath)+read(cmdPath)).toLowerCase();for(const bad of ['taskkill','stop-process','uninstall','--disable-extensions']) assert.equal(s.includes(bad),false,bad)});
});
