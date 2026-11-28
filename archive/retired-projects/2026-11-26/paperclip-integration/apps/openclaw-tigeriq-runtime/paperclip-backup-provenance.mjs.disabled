// GH-2054 R03: inspect the *real* Paperclip HOME-mounted SQL backup directory.
// Fixed-scope, read-only verification. No restore, no shell, no log of SQL bytes.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';

export const PAPERCLIP_BACKUP_ROOT =
  'D:\\TigerIQ-Paperclip-Lab\\data\\instances\\default\\data\\backups';
const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_SQL_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_AGE_MS = 4 * 60 * 60 * 1000;
const NAME = /^paperclip-[0-9]{8}-[0-9]{6}\.sql\.gz$/;

export function validatePaperclipBackupGzip(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 64 || bytes.length > MAX_COMPRESSED_BYTES)
    return { verified: false, reason: 'BACKUP_SIZE_INVALID' };
  let sql;
  try { sql = gunzipSync(bytes, { maxOutputLength: MAX_SQL_BYTES }); }
  catch { return { verified: false, reason: 'BACKUP_GZIP_CRC_INVALID' }; }
  // A valid gzip alone is not proof of an actual PostgreSQL logical backup.
  const header = sql.subarray(0, Math.min(8192, sql.length)).toString('utf8');
  const trailer = sql.subarray(Math.max(0, sql.length - 8192)).toString('utf8');
  const postgresHeader = header.includes('PostgreSQL database dump');
  const postgresFooter = trailer.includes('PostgreSQL database dump complete');
  const pgDumpFormat = postgresHeader && postgresFooter;
  // Paperclip's supported JavaScript backup engine writes transactional SQL
  // with its own header and COMMIT footer (not the pg_dump comments).
  // Require the complete paired format, never mix markers across engines.
  const paperclipHeader =
    /^-- Paperclip database backup\r?\n-- Created: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?:\r?\n|$)/.test(header) &&
    /(?:^|\r?\n)BEGIN;(?:\r?\n|$)/.test(header) &&
    header.includes('SET LOCAL session_replication_role = replica;');
  const paperclipFooter = /(?:^|\r?\n)COMMIT;(?=\r?\n|$)/.test(trailer);
  const paperclipJsFormat = paperclipHeader && paperclipFooter;
  if (!pgDumpFormat && !paperclipJsFormat) {
    return { verified: false, reason: 'BACKUP_PG_DUMP_MARKER_MISSING' };
  }
  return {
    verified: true,
    // zlib's successful decompression verifies the gzip CRC32/ISIZE trailer.
    gzipCrcVerified: true,
    backupFormat: pgDumpFormat ? 'pg_dump_plain_sql' : 'paperclip_javascript_sql',
    pgDumpHeaderVerified: pgDumpFormat,
    pgDumpFooterVerified: pgDumpFormat,
    paperclipJsHeaderVerified: paperclipJsFormat,
    paperclipJsFooterVerified: paperclipJsFormat,
    archiveSha256: createHash('sha256').update(bytes).digest('hex'),
    compressedBytes: bytes.length,
    sqlBytes: sql.length,
    restoreTested: false,
  };
}

export async function inspectPaperclipBackupProvenance({
  io = fs,
  now = () => Date.now(),
  backupRoot = PAPERCLIP_BACKUP_ROOT,
} = {}) {
  const reject = reason => ({ verified: false, reason, restoreTested: false });
  const win = path.win32, root = win.resolve(backupRoot);
  try {
    const dir = await io.lstat(root);
    if (!dir.isDirectory() || dir.isSymbolicLink())
      return reject('BACKUP_DIR_UNSAFE');
    // Do not follow a redirected Lab backup root.
    const realRoot = win.resolve(await io.realpath(root));
    if (realRoot.toLowerCase() !== root.toLowerCase())
      return reject('BACKUP_DIR_REDIRECTED');
    const entries = (await io.readdir(root)).filter(name => NAME.test(name)).sort().reverse();
    if (!entries.length) return reject('BACKUP_ARCHIVE_MISSING');
    // Fail closed on the most recent archive; never silently accept an older dump.
    const name = entries[0], full = win.join(root, name);
    const stat = await io.lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink())
      return reject('BACKUP_FILE_UNSAFE');
    const real = win.resolve(await io.realpath(full));
    if (real.toLowerCase() !== full.toLowerCase() || !real.toLowerCase().startsWith(root.toLowerCase() + '\\'))
      return reject('BACKUP_FILE_REDIRECTED');
    const age = now() - stat.mtimeMs;
    if (!Number.isFinite(age) || age < -30_000 || age > MAX_BACKUP_AGE_MS)
      return reject('BACKUP_ARCHIVE_STALE');
    if (!Number.isSafeInteger(stat.size) || stat.size < 64 || stat.size > MAX_COMPRESSED_BYTES)
      return reject('BACKUP_FILE_SIZE_INVALID');
    const bytes = await io.readFile(full);
    if (!Buffer.isBuffer(bytes) || bytes.length !== stat.size)
      return reject('BACKUP_FILE_CHANGED');
    const integrity = validatePaperclipBackupGzip(bytes);
    if (!integrity.verified) return reject(integrity.reason);
    const after = await io.lstat(full);
    if (after.mtimeMs !== stat.mtimeMs || after.size !== stat.size)
      return reject('BACKUP_FILE_CHANGED');
    // Only safe metadata escapes. Never return file contents or credentials.
    return { ...integrity, fileName: name, lastModifiedAt: new Date(stat.mtimeMs).toISOString(),
      ageMs: age, scope: 'paperclip-home-mounted-backups' };
  } catch {
    return reject('BACKUP_IO_UNVERIFIED');
  }
}
