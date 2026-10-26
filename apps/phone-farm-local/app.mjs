// TigerIQ Phone Farm • local-only controller • zero third-party Node dependencies
// This is independent software. It does not import LAIXI binaries, services, or credentials.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { executeBatch, validBatch, safePackage, safeFilename, FILE_LIMIT } from './farm-ops.mjs';
import { MacroRuns, validMacro } from './macro-engine.mjs';
import { LocalScheduler } from './schedule-engine.mjs';
import { Recordings, validRecordRequest } from './recording.mjs';

const exec = promisify(execFile);
const base = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.TIGERIQ_PHONE_FARM_PORT || 8765);
const bind = '127.0.0.1';
const adb = process.env.TIGERIQ_ADB || 'D:\\TigerIQ\\Tools\\platform-tools\\adb.exe';
const scrcpy = process.env.TIGERIQ_SCRCPY || 'D:\\TigerIQ\\Tools\\scrcpy\\scrcpy-win64-v4.1\\scrcpy.exe';
const storePath = path.join(base, 'device-labels.json');
const dropPath = path.join(base, 'drop');
const windows = new Map();
const macros = new MacroRuns();
const recordings = new Recordings(scrcpy, path.join(base, 'recordings'));
const now = () => new Date().toISOString();
export function privateWifiAddress(input) {
  if(typeof input!=='string')return false;
  const match=input.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/);
  if(!match)return false;
  const p=match.slice(1,5).map(Number),port=Number(match[5]);
  if(p.some(x=>x<0||x>255)||port<1024||port>65535)return false;
  return p[0]===10||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168);
}

export function parseDevices(text) {
  return String(text).split(/\r?\n/).slice(1).map(s => {
    const m = s.trim().match(/^([^\s]+)\s+(device|offline|unauthorized|recovery|bootloader)(?:\s+(.*))?$/);
    if (!m) return null;
    const fields = Object.fromEntries((m[3] || '').split(/\s+/).filter(x => x.includes(':')).map(x => {
      const i = x.indexOf(':'); return [x.slice(0, i), x.slice(i + 1)];
    }));
    return { serial: m[1], state: m[2], model: fields.model || '', product: fields.product || '' };
  }).filter(Boolean);
}
export function safeSerial(s) {
  return typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(s);
}
export function validInput(body) {
  if (!body || !Array.isArray(body.serials) || body.serials.length === 0 || body.serials.length > 200
      || new Set(body.serials).size !== body.serials.length || !body.serials.every(safeSerial)) return false;
  if (body.action === 'tap')
    return [body.x, body.y].every(n => Number.isInteger(n) && n >= 0 && n <= 10000);
  if (body.action === 'swipe')
    return [body.x, body.y, body.toX, body.toY].every(n => Number.isInteger(n) && n >= 0 && n <= 10000)
      && Number.isInteger(body.ms) && body.ms >= 100 && body.ms <= 3000;
  if (body.action === 'key') return ['HOME','BACK','APP_SWITCH','POWER','VOLUME_UP','VOLUME_DOWN'].includes(body.key);
  if (body.action === 'text') return typeof body.text === 'string' && body.text.length > 0
      && body.text.length <= 200 && /^[\x20-\x7e]+$/.test(body.text);
  return false;
}
export function mirrorOptions(body={}) {
  const maxFps=body.maxFps ?? 25, maxSize=body.maxSize ?? 1080, videoBitRateMbps=body.videoBitRateMbps ?? 4;
  if(![15,25,30,60].includes(maxFps) || ![720,1080,1440,2160].includes(maxSize) ||
     ![2,4,8,12].includes(videoBitRateMbps)) return null;
  return {maxFps,maxSize,videoBitRateMbps};
}
async function run(args, extra = {}) {
  return exec(adb, args, { timeout: 18000, windowsHide: true, maxBuffer: 20 * 1024 * 1024, ...extra });
}
async function devices() {
  const { stdout } = await run(['devices', '-l'], { encoding: 'utf8' });
  return parseDevices(stdout);
}
function labels() {
  try { return JSON.parse(fs.readFileSync(storePath, 'utf8')); } catch { return {}; }
}
function reply(res, status, payload, type = 'application/json; charset=utf-8') {
  const data = type.startsWith('application/json') ? JSON.stringify(payload) : payload;
  res.writeHead(status, {
    'Content-Type': type, 'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
    'Referrer-Policy': 'no-referrer'
  });
  res.end(data);
}
function json(res, status, body) { reply(res, status, body); }
async function bodyJson(req) {
  let parts = [], size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw Error('Nội dung quá lớn');
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
}
async function inputOne(serial, b) {
  let args;
  switch (b.action) {
    case 'tap': args = ['input', 'tap', String(b.x), String(b.y)]; break;
    case 'swipe': args = ['input', 'swipe', String(b.x), String(b.y), String(b.toX), String(b.toY), String(b.ms)]; break;
    case 'key': {
      const map = {HOME:3, BACK:4, APP_SWITCH:187, POWER:26, VOLUME_UP:24, VOLUME_DOWN:25};
      args = ['input', 'keyevent', String(map[b.key])]; break;
    }
    case 'text': args = ['input', 'text', b.text.replaceAll(' ', '%s')]; break;
    default: throw Error('Thao tác không hợp lệ');
  }
  await run(['-s', serial, 'shell', ...args], { encoding: 'utf8' });
}
function errorText(e) { return String(e?.message || e).slice(0,350); }
let busyScreens = 0;
const scheduler = new LocalScheduler(path.join(base,'schedules.json'),async(steps,serials)=>{
  const attached=(await devices()).filter(x=>x.state==='device').map(x=>x.serial);
  if(!serials.every(x=>attached.includes(x)))throw Error('Thiết bị ngoại tuyến');
  return macros.start(steps,serials,inputOne);
});
const server = http.createServer(async (req, res) => {
  try {
    const allowedOrigins = ['http://127.0.0.1:' + port, 'http://localhost:' + port];
    if (!allowedOrigins.some(x => req.headers.host === new URL(x).host)) return json(res, 403, { error: 'Chỉ truy cập nội bộ' });
    const url = new URL(req.url, 'http://127.0.0.1:' + port);
    const fileUpload = req.method === 'POST' && url.pathname === '/api/drop/upload';
    const expectedContentType = fileUpload ? 'application/vnd.android.package-archive' : 'application/json';
    if (req.method === 'POST' && ((req.headers.origin && !allowedOrigins.includes(req.headers.origin)) ||
        (req.headers['content-type'] || '').split(';')[0] !== expectedContentType))
      return json(res, 403, { error: 'Yêu cầu khác nguồn hoặc sai định dạng bị từ chối' });
    if (req.method === 'GET' && url.pathname === '/') {
      return reply(res, 200, fs.readFileSync(path.join(base, 'index.html')), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/ui.js') {
      return reply(res, 200, fs.readFileSync(path.join(base, 'ui.js')), 'text/javascript; charset=utf-8');
    }
    if (fileUpload) {
      let filename;
      try { filename = decodeURIComponent(req.headers['x-tigeriq-filename'] || ''); }
      catch { return json(res, 400, { error: 'Tên APK không hợp lệ' }); }
      if (!safeFilename(filename) || !/\.apk$/i.test(filename))
        return json(res, 400, { error: 'Chỉ nhận tệp APK tên hợp lệ' });
      const size = Number(req.headers['content-length']);
      if (!Number.isSafeInteger(size) || size < 4 || size > FILE_LIMIT)
        return json(res, 413, { error: 'APK thiếu kích thước hoặc vượt giới hạn' });
      fs.mkdirSync(dropPath, { recursive: true });
      const target = path.join(dropPath, filename);
      let handle = null, created = false, total = 0;
      try {
        handle = await fs.promises.open(target, 'wx', 0o600);
        created = true;
        let first = true;
        for await (const chunk of req) {
          total += chunk.length;
          if (total > FILE_LIMIT || total > size) throw Error('APK vượt giới hạn khai báo');
          if (first) {
            first = false;
            if (chunk.length < 4 || !chunk.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])))
              throw Error('Tệp không phải ZIP/APK');
          }
          let offset = 0;
          while (offset < chunk.length) {
            const written = await handle.write(chunk, offset, chunk.length - offset);
            if (written.bytesWritten <= 0) throw Error('Không ghi được APK');
            offset += written.bytesWritten;
          }
        }
        if (total !== size) throw Error('APK chưa được truyền đủ');
        await handle.close(); handle = null;
        return json(res, 201, { stored: filename, bytes: total });
      } catch (e) {
        await handle?.close().catch(() => {});
        if (created) await fs.promises.unlink(target).catch(() => {});
        return json(res, e.code === 'EEXIST' ? 409 : 400,
          { error: e.code === 'EEXIST' ? 'Tệp cùng tên đã tồn tại trong drop' : errorText(e) });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/wifi/connect') {
      const b=await bodyJson(req);
      if(!privateWifiAddress(b.address))return json(res,400,{error:'Chỉ hỗ trợ địa chỉ IPv4 LAN riêng và cổng hợp lệ'});
      try {
        const r=await run(['connect',b.address],{encoding:'utf8',timeout:12000});
        const output=String(r.stdout||'').trim();
        if(!/connected to|already connected/i.test(output))return json(res,409,{error:output.slice(0,250)||'ADB chưa kết nối'});
        return json(res,200,{connected:true,address:b.address,result:output});
      }catch(e){return json(res,409,{error:errorText(e)})}
    }
    if (req.method === 'GET' && url.pathname === '/api/health')
      return json(res, 200, { ok: true, localOnly: true, time: now(), adbExists: fs.existsSync(adb), scrcpyExists: fs.existsSync(scrcpy) });
    if (req.method === 'GET' && url.pathname === '/api/devices') {
      const xs = await devices(), ls = labels();
      return json(res, 200, { devices: xs.map(x => ({ ...x, label: ls[x.serial] || '' })), count: xs.length, time: now() });
    }
    if (req.method === 'GET' && url.pathname === '/api/screen') {
      const serial = url.searchParams.get('serial');
      if (!safeSerial(serial)) return json(res, 400, { error: 'Mã thiết bị không hợp lệ' });
      if (busyScreens >= 3) return json(res, 429, { error: 'Đang xử lý ảnh khác' });
      if (!(await devices()).some(x => x.serial === serial && x.state === 'device')) return json(res, 404, { error: 'Thiết bị chưa sẵn sàng' });
      busyScreens++;
      try {
        const { stdout } = await run(['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', timeout: 12000 });
        return reply(res, 200, stdout, 'image/png');
      } finally { busyScreens--; }
    }
    if (req.method === 'GET' && url.pathname === '/api/size') {
      const serial = url.searchParams.get('serial');
      if (!safeSerial(serial)) return json(res, 400, { error: 'Thiết bị không hợp lệ' });
      const { stdout } = await run(['-s', serial, 'shell', 'wm', 'size'], { encoding: 'utf8' });
      const m = String(stdout).match(/(?:Override|Physical) size:\s*(\d+)x(\d+)/);
      return json(res, m ? 200 : 502, m ? { width: Number(m[1]), height: Number(m[2]) } : { error: 'Không đọc được kích thước' });
    }
    if (req.method === 'POST' && url.pathname === '/api/input') {
      const b = await bodyJson(req);
      if (!validInput(b)) return json(res, 400, { error: 'Thao tác không hợp lệ' });
      const attached = await devices();
      if (!b.serials.every(s => attached.some(x => x.serial === s && x.state === 'device')))
        return json(res, 409, { error: 'Một số thiết bị đã ngắt kết nối' });
      const results = await Promise.all(b.serials.map(async serial => {
        try { await inputOne(serial, b); return { serial, ok: true }; }
        catch (e) { return { serial, ok: false, error: errorText(e) }; }
      }));
      return json(res, 200, { results });
    }
    if (req.method === 'POST' && url.pathname === '/api/label') {
      const b = await bodyJson(req);
      if (!safeSerial(b.serial) || typeof b.label !== 'string' || b.label.length > 50)
        return json(res, 400, { error: 'Nhãn không hợp lệ' });
      const state = labels(); state[b.serial] = b.label;
      fs.writeFileSync(storePath, JSON.stringify(state, null, 2));
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/record/start') {
      const b=await bodyJson(req);
      if(!validRecordRequest(b))return json(res,400,{error:'Thiết bị hoặc thời lượng không hợp lệ (5-120 giây)'});
      if(!fs.existsSync(scrcpy))return json(res,424,{error:'Thiếu scrcpy'});
      if(!(await devices()).some(x=>x.serial===b.serial && x.state==='device'))return json(res,409,{error:'Thiết bị chưa sẵn sàng'});
      try {return json(res,202,recordings.start(b));}
      catch(e){return json(res,409,{error:errorText(e)})}
    }
    if (req.method === 'GET' && url.pathname === '/api/record/status') {
      const id=url.searchParams.get('id');
      if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))return json(res,400,{error:'Mã phiên không hợp lệ'});
      const r=recordings.status(id);
      return json(res,r?200:404,r||{error:'Không tìm thấy bản ghi'});
    }
    if (req.method === 'POST' && url.pathname === '/api/record/stop') {
      const b=await bodyJson(req);
      if(typeof b.id!=='string'||!/^[a-f0-9-]{36}$/.test(b.id))return json(res,400,{error:'Mã phiên không hợp lệ'});
      return json(res,200,{stopRequested:recordings.stop(b.id)});
    }
    if (req.method === 'GET' && url.pathname === '/api/packages') {
      const serial = url.searchParams.get('serial');
      if (!safeSerial(serial)) return json(res, 400, {error:'Mã thiết bị không hợp lệ'});
      if (!(await devices()).some(x => x.serial === serial && x.state === 'device')) return json(res, 409, {error:'Thiết bị chưa sẵn sàng'});
      const { stdout } = await run(['-s', serial, 'shell', 'pm', 'list', 'packages', '-3'], {encoding:'utf8'});
      return json(res, 200, {serial, packages:String(stdout).split(/\r?\n/).filter(s => s.startsWith('package:')).map(s => s.slice(8)).filter(safePackage)});
    }
    if (req.method === 'POST' && url.pathname === '/api/batch') {
      const b = await bodyJson(req);
      if (!validBatch(b)) return json(res, 400, {error:'Yêu cầu nhóm không hợp lệ'});
      fs.mkdirSync(dropPath, {recursive:true});
      const outcome = await executeBatch(adb, b, dropPath, async () => (await devices()).filter(x => x.state === 'device').map(x => x.serial));
      return json(res, 200, outcome);
    }
    if (req.method === 'GET' && url.pathname === '/api/schedules')
      return json(res,200,{schedules:scheduler.list()});
    if (req.method === 'POST' && url.pathname === '/api/schedules') {
      const b=await bodyJson(req);
      try{return json(res,201,scheduler.add(b));}
      catch(e){return json(res,400,{error:errorText(e)});}
    }
    if (req.method === 'POST' && url.pathname === '/api/schedules/delete') {
      const b=await bodyJson(req);
      if(typeof b.id!=='string'||!/^[a-f0-9-]{36}$/.test(b.id))return json(res,400,{error:'Mã lịch không hợp lệ'});
      return json(res,200,{removed:scheduler.remove(b.id)});
    }
    if (req.method === 'POST' && url.pathname === '/api/macro/start') {
      const b = await bodyJson(req);
      if (!b || !Array.isArray(b.serials) || !b.serials.length || b.serials.length>200 ||
          !b.serials.every(safeSerial) || new Set(b.serials).size!==b.serials.length ||
          !validMacro(b.steps)) return json(res,400,{error:'Kịch bản không hợp lệ'});
      const available=(await devices()).filter(x=>x.state==='device').map(x=>x.serial);
      if (!b.serials.every(s=>available.includes(s))) return json(res,409,{error:'Thiết bị chưa sẵn sàng'});
      try {const id=macros.start(b.steps,b.serials,inputOne);return json(res,202,{id,state:'running'});}
      catch(e){return json(res,409,{error:errorText(e)});}
    }
    if (req.method === 'GET' && url.pathname === '/api/macro/status') {
      const r=macros.status(url.searchParams.get('id'));
      return json(res,r?200:404,r||{error:'Không tìm thấy phiên'});
    }
    if (req.method === 'POST' && url.pathname === '/api/macro/stop') {
      const b=await bodyJson(req);
      if(typeof b.id!=='string'||!/^[a-f0-9-]{36}$/.test(b.id))return json(res,400,{error:'Mã phiên không hợp lệ'});
      return json(res,200,{stopped:macros.stop(b.id)});
    }
    if (req.method === 'POST' && url.pathname === '/api/open') {
      const b = await bodyJson(req);
      if (!safeSerial(b.serial)) return json(res, 400, { error: 'Thiết bị không hợp lệ' });
      const mirror=mirrorOptions(b);
      if (!mirror) return json(res, 400, { error: 'Thiết lập mirror không hợp lệ' });
      if (!(await devices()).some(x => x.serial === b.serial && x.state === 'device')) return json(res, 409, { error: 'Thiết bị không khả dụng' });
      if (!fs.existsSync(scrcpy)) return json(res, 424, { error: 'Không tìm thấy scrcpy.exe' });
      if (windows.has(b.serial) && !windows.get(b.serial).killed) return json(res, 200, { ok: true, already: true });
      const args = ['--serial', b.serial, '--no-audio', '--max-fps='+mirror.maxFps, '--max-size='+mirror.maxSize,
        '--video-bit-rate='+mirror.videoBitRateMbps+'M', '--window-title=TigerIQ - ' + b.serial];
      const child = spawn(scrcpy, args, { cwd: path.dirname(scrcpy), windowsHide: false, detached: false, stdio: 'ignore' });
      windows.set(b.serial, child);
      child.on('exit', () => windows.delete(b.serial));
      child.on('error', () => windows.delete(b.serial));
      return json(res, 200, { ok: true, pid: child.pid || null });
    }
    json(res, 404, { error: 'Không tìm thấy' });
  } catch (e) { json(res, 500, { error: errorText(e) }); }
});
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, bind, () => console.log('TigerIQ Phone Farm: http://' + bind + ':' + port));
  const timer=setInterval(()=>scheduler.tick().catch(e=>console.error('Local schedule:',e.message)),15000);
  timer.unref();
  void scheduler.tick().catch(e=>console.error('Local schedule:',e.message));
}
export { server };
