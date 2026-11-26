// Local-only Android batch operations. All target serials are re-validated by app.mjs.
// No shell interpolation, no arbitrary ADB or third-party server calls.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export const MAX_BATCH = 200;
export const FILE_LIMIT = 250 * 1024 * 1024;

export function safeSerial(s) {
  return typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(s);
}
export function safePackage(s) {
  return typeof s === 'string' && s.length <= 160 &&
    /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){1,20}$/.test(s);
}
export function safeFilename(s) {
  return typeof s === 'string' && s.length <= 110 &&
    /^[A-Za-z0-9][A-Za-z0-9 _().-]*\.(?:apk|txt|json|csv|pdf|png|jpg|jpeg|webp|mp4|zip)$/i.test(s) &&
    !s.includes('..') && !s.endsWith(' ') && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\./i.test(s);
}
export function validBatch(b) {
  if (!b || !Array.isArray(b.serials) || b.serials.length < 1 ||
      b.serials.length > MAX_BATCH || !b.serials.every(safeSerial) ||
      new Set(b.serials).size !== b.serials.length) return false;
  if (b.action === 'install' || b.action === 'upload') return safeFilename(b.file) &&
    (b.action !== 'install' || /\.apk$/i.test(b.file));
  if (b.action === 'launch' || b.action === 'forceStop' || b.action === 'uninstall') return safePackage(b.package);
  return false;
}
export function fileInDrop(drop, filename) {
  if (!safeFilename(filename)) throw Error('Tên tệp không hợp lệ');
  const full = path.resolve(drop, filename);
  if (path.dirname(full) !== path.resolve(drop)) throw Error('Tệp nằm ngoài thư mục drop');
  if (!fs.existsSync(full) || !fs.lstatSync(full).isFile()) throw Error('Không tìm thấy tệp thông thường trong drop');
  if (fs.statSync(full).size > FILE_LIMIT) throw Error('Tệp quá lớn');
  return full;
}
async function adbExec(adb, args, timeout = 90000) {
  return exec(adb, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' });
}
export async function executeBatch(adb, b, drop, isConnected) {
  if (!validBatch(b)) throw Error('Yêu cầu nhóm không hợp lệ');
  const attached = await isConnected();
  if (!b.serials.every(s => attached.includes(s))) throw Error('Thiết bị chưa cấp quyền hoặc đã ngắt kết nối');
  const file = ['install','upload'].includes(b.action) ? fileInDrop(drop, b.file) : null;
  let next = 0;
  const results = Array(b.serials.length);
  const runOne = async () => {
    while (next < b.serials.length) {
      const idx = next++, serial = b.serials[idx];
      try {
        let args, timeout = 90000;
        switch (b.action) {
          case 'install':
            args = ['-s',serial,'install','-r',file];
            timeout = 180000;
            break;
          case 'upload':
            await adbExec(adb, ['-s',serial,'shell','mkdir','-p','/sdcard/Download/TigerIQ'],12000);
            args = ['-s',serial,'push',file,'/sdcard/Download/TigerIQ/'+b.file];
            break;
          case 'launch':
            args = ['-s',serial,'shell','monkey','-p',b.package,'-c','android.intent.category.LAUNCHER','1'];
            break;
          case 'forceStop':
            args = ['-s',serial,'shell','am','force-stop',b.package];
            break;
          case 'uninstall':
            args = ['-s',serial,'uninstall',b.package];
            timeout = 120000;
            break;
        }
        const r = await adbExec(adb,args,timeout);
        results[idx] = {serial,ok:true,stdout:String(r.stdout||'').slice(-300)};
      } catch(e) {
        results[idx] = {serial,ok:false,error:String(e.message||e).slice(0,320)};
      }
    }
  };
  await Promise.all(Array.from({length:Math.min(4,b.serials.length)},()=>runOne()));
  return {results};
}
