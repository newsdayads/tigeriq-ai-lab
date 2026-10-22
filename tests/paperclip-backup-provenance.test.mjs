import { describe, it, expect, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PAPERCLIP_BACKUP_ROOT, validatePaperclipBackupGzip, inspectPaperclipBackupProvenance,
} from '../apps/openclaw-tigeriq-runtime/paperclip-backup-provenance.mjs';

const name='paperclip-20261022-060828.sql.gz';
const pgDump=[
  '--',
  '-- PostgreSQL database dump',
  '--',
  '',
  'CREATE TABLE example (id INTEGER NOT NULL);',
  'INSERT INTO example VALUES (1);',
  '',
  '--',
  '-- PostgreSQL database dump complete',
  '--',
  '',
].join('\n');
const archive=()=>gzipSync(Buffer.from(pgDump.repeat(3),'utf8'));
const root=PAPERCLIP_BACKUP_ROOT, full=path.win32.join(root,name);
const now=Date.parse('2026-10-22T06:43:00.000Z'), modified=Date.parse('2026-10-22T06:08:29.977Z');
function fakeIo({bytes=archive(),files=[name],symlink='',mtimeMs=modified,changed=false}={}){
  const lstat=vi.fn(async p=>{
    if (p===root)return {isDirectory:()=>true,isFile:()=>false,isSymbolicLink:()=>symlink==='dir'};
    if (p===full)return {isDirectory:()=>false,isFile:()=>true,isSymbolicLink:()=>symlink==='file',
      size:bytes.length,mtimeMs:changed?mtimeMs+(lstat.mock.calls.filter(a=>a[0]===full).length>1?500:0):mtimeMs};
    throw new Error('unknown location');
  });
  const io={lstat,readdir:vi.fn(async()=>files),realpath:vi.fn(async p=>p),
    readFile:vi.fn(async()=>bytes)};
  return io;
}
describe('GH-2054: actual Paperclip HOME-mounted PostgreSQL backup provenance',()=>{
  it('Core local-only backup diagnostics are bounded, read-only and do not expose dump bytes',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    const from=core.indexOf("url.pathname==='/api/pc01/paperclip-backup-integrity'");
    const to=core.indexOf("if(req.method==='POST'&&url.pathname==='/api/github-event')",from);
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const route=core.slice(from,to);
    expect(route).toContain('if(!localSelf(req)&&!auth(req))');
    expect(route).toContain('const backup=await inspectPaperclipBackupProvenance()');
    expect(route).toContain('JSON.stringify({ok:backup.verified===true,backup})');
    expect(route).not.toContain('runBrokerRequest');
    expect(route).not.toContain('writeFile');
    expect(route).not.toContain('startProcess');
  });
  it('exposes safe backup reason only within the existing read-only preflight',()=>{
    const source=readFileSync(new URL('../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs',import.meta.url),'utf8');
    const section=source.slice(source.indexOf('async function preflight(signal = null) {'),
      source.indexOf('function redactPaperclipDiagnosticText(',source.indexOf('async function preflight(signal = null) {')));
    expect(section).toContain('await paperclipReadOnlyPreflight({ signal })');
    expect(section).toContain('await inspectPaperclipBackupProvenance()');
    expect(section).not.toContain('runBrokerRequest(');
    expect(section).not.toContain('runDockerViaBroker(');
  });

  it('uses the mounted /paperclip home, not the unrelated empty Lab backup directory',()=>{
    expect(PAPERCLIP_BACKUP_ROOT).toBe('D:\\TigerIQ-Paperclip-Lab\\data\\instances\\default\\data\\backups');
  });
  it('verifies gzip CRC and PG dump header/footer without exposing SQL contents',()=>{
    const r=validatePaperclipBackupGzip(archive());
    expect(r).toMatchObject({verified:true,gzipCrcVerified:true,
      pgDumpHeaderVerified:true,pgDumpFooterVerified:true,restoreTested:false});
    expect(r.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(r)).not.toContain('CREATE TABLE');
  });
  it('rejects truncated gzip even when the name looks like a normal archive',()=>{
    const bytes=archive(),broken=bytes.subarray(0,bytes.length-7);
    expect(validatePaperclipBackupGzip(broken).verified).toBe(false);
  });
  it('rejects a non-PostgreSQL gzip, not only a bad extension',()=>{
    const invalid=gzipSync(Buffer.from('fake-not-postgres '.repeat(100)));
    expect(validatePaperclipBackupGzip(invalid).verified).toBe(false);
  });
  it('accepts the freshest nonzero non-symlinked real archive, read only',async()=>{
    const io=fakeIo();
    const value=await inspectPaperclipBackupProvenance({io,now:()=>now});
    expect(value).toMatchObject({verified:true,fileName:name,gzipCrcVerified:true,scope:'paperclip-home-mounted-backups',restoreTested:false});
    expect(value.ageMs).toBeGreaterThan(0);
    expect(value.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(io.readFile).toHaveBeenCalledExactlyOnceWith(full);
    expect(JSON.stringify(value)).not.toContain('CREATE TABLE');
    expect(Object.keys(io).sort()).toEqual(['lstat','readFile','readdir','realpath']);
  });
  it('fails closed on missing directory, missing archives, symlink, stale file and changed file',async()=>{
    const cases=[
      [fakeIo({files:[]}), 'BACKUP_ARCHIVE_MISSING'],
      [fakeIo({symlink:'dir'}), 'BACKUP_DIR_UNSAFE'],
      [fakeIo({symlink:'file'}), 'BACKUP_FILE_UNSAFE'],
      [fakeIo({mtimeMs:now-5*60*60*1000}), 'BACKUP_ARCHIVE_STALE'],
      [fakeIo({changed:true}), 'BACKUP_FILE_CHANGED'],
    ];
    for(const [io,reason] of cases) {
      const value=await inspectPaperclipBackupProvenance({io,now:()=>now});
      expect(value).toMatchObject({verified:false,reason,restoreTested:false});
    }
  });
  it('refuses older good backup if newer archive fails integrity',async()=>{
    const older='paperclip-20261022-050828.sql.gz';
    const io=fakeIo({files:[older,name],bytes:archive().subarray(0,archive().length-4)});
    const value=await inspectPaperclipBackupProvenance({io,now:()=>now});
    expect(value.verified).toBe(false);
    expect(io.readFile).toHaveBeenCalledOnce();
  });
});
